const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TRANSCRIBE_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

export function getOpenRouterKey(env) {
  return env.AD_TOOL_OPENROUTER_KEY || null;
}

export function modelFor(env, kind) {
  const defaults = {
    transcribe: "google/gemini-2.5-flash",
    analyze: "google/gemini-2.5-flash",
    generate: "openai/gpt-4o-mini",
  };
  const key = `AD_TOOL_OPENROUTER_MODEL_${kind.toUpperCase()}`;
  return env[key] || defaults[kind] || defaults.generate;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function fetchVideoBase64(videoUrl, maxBytes = 8 * 1024 * 1024) {
  const res = await fetch(videoUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "video/*,*/*;q=0.8",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`Video fetch failed: ${res.status} ${res.statusText}`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`Video too large (${contentLength} bytes, max ${maxBytes})`);
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Video too large (${buffer.byteLength} bytes, max ${maxBytes})`);
  }

  return {
    base64: arrayBufferToBase64(buffer),
    byteLength: buffer.byteLength,
    contentType: res.headers.get("content-type") || "video/mp4",
  };
}

function buildDebug(meta, request, response, startedAt) {
  return {
    ...meta,
    durationMs: Date.now() - startedAt,
    request,
    response,
  };
}

export async function openRouterChat(apiKey, payload, meta = {}) {
  const startedAt = Date.now();
  const request = {
    ...payload,
  };

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "HTTP-Referer": "https://peakleadsgroup.com",
      "X-Title": "PeakLeads Ads Tool",
    },
    body: JSON.stringify(request),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      (typeof data?.raw === "string" ? data.raw : null) ||
      `OpenRouter chat failed (${res.status})`;
    const err = new Error(msg);
    err.debug = buildDebug(meta, request, { status: res.status, body: data }, startedAt);
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  return {
    content: typeof content === "string" ? content : JSON.stringify(content ?? ""),
    usage: data?.usage || null,
    model: data?.model || request.model,
    debug: buildDebug(meta, request, data, startedAt),
  };
}

export async function openRouterTranscribe(apiKey, audioBase64, format, meta = {}) {
  const startedAt = Date.now();
  const request = {
    model: "openai/whisper-large-v3",
    input_audio: {
      data: audioBase64,
      format: format || "mp4",
    },
  };

  const res = await fetch(OPENROUTER_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "HTTP-Referer": "https://peakleadsgroup.com",
      "X-Title": "PeakLeads Ads Tool",
    },
    body: JSON.stringify(request),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      `OpenRouter transcription failed (${res.status})`;
    const err = new Error(msg);
    err.debug = buildDebug(meta, request, { status: res.status, body: data }, startedAt);
    throw err;
  }

  const transcript = data?.text || data?.transcript || "";
  return {
    transcript: String(transcript).trim(),
    usage: data?.usage || null,
    debug: buildDebug(meta, request, data, startedAt),
  };
}

export async function transcribeVideo(apiKey, videoUrl, adMeta, env) {
  const model = modelFor(env, "transcribe");
  const steps = [];

  let videoDebug = null;
  try {
    const video = await fetchVideoBase64(videoUrl);
    steps.push({ step: "fetch_video", byteLength: video.byteLength });

    try {
      const whisper = await openRouterTranscribe(apiKey, video.base64, "mp4", {
        action: "transcribe_whisper",
        model: "openai/whisper-large-v3",
        videoUrl,
        videoByteLength: video.byteLength,
      });
      steps.push({ step: "whisper", ok: true });
      if (whisper.transcript) {
        return {
          transcript: whisper.transcript,
          source: "whisper",
          steps,
          debug: { whisper: whisper.debug },
        };
      }
    } catch (whisperErr) {
      steps.push({ step: "whisper", ok: false, error: whisperErr.message });
    }

    const chat = await openRouterChat(
      apiKey,
      {
        model,
        temperature: 0,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Transcribe every spoken word in this video advertisement verbatim. Output only the transcript text with no commentary, labels, or markdown.",
              },
              {
                type: "video_url",
                video_url: {
                  url: `data:video/mp4;base64,${video.base64}`,
                },
              },
            ],
          },
        ],
      },
      {
        action: "transcribe_gemini_video",
        model,
        videoUrl,
        videoByteLength: video.byteLength,
      }
    );

    steps.push({ step: "gemini_video", ok: true });
    return {
      transcript: chat.content.trim(),
      source: "gemini_video",
      steps,
      debug: { gemini: chat.debug },
    };
  } catch (videoErr) {
    steps.push({ step: "video_pipeline", ok: false, error: videoErr.message });
    videoDebug = videoErr.debug || null;
  }

  const fallbackParts = [
    adMeta?.bodyText,
    adMeta?.caption,
    adMeta?.ctaText,
  ].filter(Boolean);

  if (fallbackParts.length) {
    return {
      transcript: fallbackParts.join("\n\n").trim(),
      source: "ad_copy_fallback",
      steps,
      debug: { videoError: videoDebug, note: "Used on-ad copy because video transcription failed" },
    };
  }

  const err = new Error("Could not transcribe video and no ad copy fallback available");
  err.debug = { steps, videoError: videoDebug };
  throw err;
}

export function parseJsonFromModel(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model did not return valid JSON");
  }
}
