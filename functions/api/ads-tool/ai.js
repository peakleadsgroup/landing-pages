/**
 * POST /api/ads-tool/ai
 * Body: { action, devMode, ...actionFields }
 */
import {
  getOpenRouterKey,
  modelFor,
  openRouterChat,
  parseJsonFromModel,
  transcribeVideo,
} from "./openrouter.js";
import { getNicheContext } from "./niche-context/index.js";

const GENERATE_DEFAULTS = {
  temperature: 0.85,
  top_p: 0.95,
  max_tokens: 1200,
  frequency_penalty: 0.2,
  presence_penalty: 0.1,
};

const ANALYZE_DEFAULTS = {
  temperature: 0.2,
  top_p: 1,
  max_tokens: 2000,
};

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = getOpenRouterKey(context.env);
  if (!apiKey) {
    return json({ error: "Missing AD_TOOL_OPENROUTER_KEY" }, 503);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = String(body.action || "").trim();
  const devMode = body.devMode === true;
  const debugTrail = [];

  try {
    if (action === "transcribe") {
      const videoUrl = String(body.videoUrl || body.videoHdUrl || body.videoSdUrl || "").trim();
      if (!videoUrl) {
        return json({ error: "videoUrl is required" }, 400);
      }

      const result = await transcribeVideo(apiKey, videoUrl, body.adMeta || {}, context.env);
      if (devMode && result.debug) debugTrail.push(result.debug);

      return json({
        ok: true,
        transcript: result.transcript,
        source: result.source,
        steps: result.steps,
        debug: devMode ? { steps: result.steps, trail: debugTrail, whisperOrGemini: result.debug } : undefined,
      });
    }

    if (action === "analyze") {
      const transcript = String(body.transcript || "").trim();
      if (!transcript) {
        return json({ error: "transcript is required" }, 400);
      }

      const model = modelFor(context.env, "analyze");
      const system = `You are an expert direct-response video ad copywriter. Break scripts into hook, body, and CTA.
Return ONLY valid JSON with this exact shape:
{
  "hook": "string — opening attention grabber, first ~1-3 sentences",
  "body": "string — main pitch / story / proof",
  "cta": "string — closing call to action",
  "notes": "string — brief notes on structure, pacing, or persuasion tactics"
}`;

      const chat = await openRouterChat(
        apiKey,
        {
          model,
          ...ANALYZE_DEFAULTS,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: `Analyze this ad transcript and split into hook, body, and CTA:\n\n${transcript}`,
            },
          ],
        },
        { action: "analyze", model, settings: ANALYZE_DEFAULTS }
      );

      if (devMode) debugTrail.push(chat.debug);

      const structure = parseJsonFromModel(chat.content);
      return json({
        ok: true,
        structure,
        usage: chat.usage,
        model: chat.model,
        debug: devMode ? { analyze: chat.debug, trail: debugTrail } : undefined,
      });
    }

    if (action === "generate_hooks") {
      const niche = String(body.niche || "").trim();
      const sourceHook = String(body.sourceHook || "").trim();
      const transcript = String(body.transcript || "").trim();
      const structure = body.structure || {};

      if (!niche) return json({ error: "niche is required" }, 400);
      if (!sourceHook && !transcript) {
        return json({ error: "sourceHook or transcript is required" }, 400);
      }

      const nicheContext = getNicheContext(niche);
      const model = modelFor(context.env, "generate");

      const system = `You write high-converting short-form video ad hooks for home-services offers.
Use the niche context to match audience, tone, and compliance.
Return ONLY valid JSON: { "ideas": ["hook 1", "hook 2", "hook 3", "hook 4", "hook 5"] }
Each hook should be 1-3 sentences, speakable, distinct in angle, same general intent as the reference hook.`;

      const user = `NICHE CONTEXT:
${nicheContext || "(No niche context file — use general home-services best practices)"}

REFERENCE HOOK FROM SWIPE AD:
${sourceHook || "(extract hook from transcript below)"}

FULL TRANSCRIPT (for tone reference):
${transcript || "(none)"}

STRUCTURE BREAKDOWN:
${JSON.stringify(structure, null, 2)}

Generate 5 new hook options for niche: ${niche}`;

      const chat = await openRouterChat(
        apiKey,
        {
          model,
          ...GENERATE_DEFAULTS,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        {
          action: "generate_hooks",
          model,
          settings: GENERATE_DEFAULTS,
          niche,
          nicheContextLength: nicheContext.length,
          prompts: { system, user },
        }
      );

      if (devMode) debugTrail.push(chat.debug);

      const parsed = parseJsonFromModel(chat.content);
      const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.map(String) : [];
      if (ideas.length < 1) {
        throw new Error("Model returned no hook ideas");
      }

      return json({
        ok: true,
        ideas: ideas.slice(0, 5),
        usage: chat.usage,
        model: chat.model,
        debug: devMode ? { generate_hooks: chat.debug, trail: debugTrail } : undefined,
      });
    }

    if (action === "generate_variants") {
      const niche = String(body.niche || "").trim();
      const scriptSoFar = String(body.scriptSoFar || "").trim();
      const transcript = String(body.transcript || "").trim();
      const structure = body.structure || {};
      const focusSection = String(body.focusSection || "").trim();

      if (!niche) return json({ error: "niche is required" }, 400);
      if (!scriptSoFar) return json({ error: "scriptSoFar is required" }, 400);

      const nicheContext = getNicheContext(niche);
      const model = modelFor(context.env, "generate");

      const system = `You help writers iterate on direct-response short-form video ad scripts for home services.
The user builds a working script by pulling in reference copy and typing instructions (e.g. "change this hook for bathroom remodels").
Return ONLY valid JSON: { "ideas": ["option 1", "option 2", "option 3", "option 4", "option 5"] }
Each option is a speakable script chunk (1-4 sentences) that follows the user's latest instruction while staying on-brand for the niche.
Options must be distinct in angle. Never delete or rewrite what the user already wrote — each option is NEW copy to append below their working script.
Follow niche terminology rules strictly (e.g. never say "acrylic" for bathrooms — use "solid surface").`;

      const user = `NICHE CONTEXT:
${nicheContext || "(No niche context file)"}

WORKING SCRIPT (user's draft + their notes/instructions — honor the latest instruction):
${scriptSoFar}

${focusSection ? `FOCUS: User is iterating on the "${focusSection}" section from the swipe ad.\n` : ""}
ORIGINAL SWIPE TRANSCRIPT:
${transcript || "(none)"}

SWIPE AD STRUCTURE (hook / body / CTA from reference ad):
${JSON.stringify(structure, null, 2)}

Generate 5 options the user can append below their working script. Niche: ${niche}`;

      const chat = await openRouterChat(
        apiKey,
        {
          model,
          ...GENERATE_DEFAULTS,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        {
          action: "generate_variants",
          model,
          settings: GENERATE_DEFAULTS,
          niche,
          nicheContextLength: nicheContext.length,
          prompts: { system, user },
        }
      );

      if (devMode) debugTrail.push(chat.debug);

      const parsed = parseJsonFromModel(chat.content);
      const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.map(String) : [];
      if (ideas.length < 1) {
        throw new Error("Model returned no variant ideas");
      }

      return json({
        ok: true,
        ideas: ideas.slice(0, 5),
        usage: chat.usage,
        model: chat.model,
        debug: devMode ? { generate_variants: chat.debug, trail: debugTrail } : undefined,
      });
    }

    if (action === "generate_next") {
      const niche = String(body.niche || "").trim();
      const scriptSoFar = String(body.scriptSoFar || "").trim();
      const transcript = String(body.transcript || "").trim();
      const structure = body.structure || {};

      if (!niche) return json({ error: "niche is required" }, 400);
      if (!scriptSoFar) return json({ error: "scriptSoFar is required" }, 400);

      const nicheContext = getNicheContext(niche);
      const model = modelFor(context.env, "generate");

      const system = `You continue direct-response video ad scripts one sentence at a time.
Return ONLY valid JSON: { "ideas": ["next sentence 1", "next sentence 2", "next sentence 3", "next sentence 4", "next sentence 5"] }
Each idea is exactly ONE speakable sentence that could follow the script so far. Vary angle but stay coherent.`;

      const user = `NICHE CONTEXT:
${nicheContext || "(No niche context file)"}

SCRIPT SO FAR (write the NEXT sentence after this):
${scriptSoFar}

ORIGINAL SWIPE TRANSCRIPT (reference):
${transcript || "(none)"}

STRUCTURE BREAKDOWN:
${JSON.stringify(structure, null, 2)}

Generate 5 options for the next sentence. Niche: ${niche}`;

      const chat = await openRouterChat(
        apiKey,
        {
          model,
          ...GENERATE_DEFAULTS,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        {
          action: "generate_next",
          model,
          settings: GENERATE_DEFAULTS,
          niche,
          nicheContextLength: nicheContext.length,
          prompts: { system, user },
        }
      );

      if (devMode) debugTrail.push(chat.debug);

      const parsed = parseJsonFromModel(chat.content);
      const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.map(String) : [];
      if (ideas.length < 1) {
        throw new Error("Model returned no next-sentence ideas");
      }

      return json({
        ok: true,
        ideas: ideas.slice(0, 5),
        usage: chat.usage,
        model: chat.model,
        debug: devMode ? { generate_next: chat.debug, trail: debugTrail } : undefined,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json(
      {
        ok: false,
        error: err.message || "AI request failed",
        debug: devMode ? err.debug || null : undefined,
      },
      200
    );
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
