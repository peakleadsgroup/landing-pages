/**
 * GET /api/recordings/:sid/audio
 * Proxies Twilio recording media (MP3). Requires env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 */
export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const sid = context.env.TWILIO_ACCOUNT_SID;
  const token = context.env.TWILIO_AUTH_TOKEN;
  const recordingSid = context.params.sid;

  if (!sid || !token) {
    return new Response("Server configuration error", { status: 500 });
  }

  const auth = btoa(`${sid}:${token}`);
  const mediaUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/${recordingSid}.mp3`;

  try {
    const res = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ error: `Twilio: ${res.status} - ${text}` }), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.arrayBuffer();
    const contentType = res.headers.get("Content-Type") || "audio/mpeg";

    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to fetch recording" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
