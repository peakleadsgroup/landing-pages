/**
 * POST/GET /api/twilio/voice
 * TwiML endpoint used by TWILIO_TWIML_APP_SID for browser-originated calls.
 */
function xmlEscape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  let to = url.searchParams.get("To") || "";

  if (!to && req.method === "POST") {
    try {
      const form = await req.formData();
      to = String(form.get("To") || "");
    } catch (_) {}
  }

  const digits = to.replace(/\D/g, "");
  const e164 = digits.length >= 10 ? `+1${digits.slice(-10)}` : "";

  let twiml = "";
  if (!e164) {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid destination number.</Say>
</Response>`;
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${xmlEscape(context.env.TWILIO_VOICEMAIL_NUMBER || "")}">
    <Number>${xmlEscape(e164)}</Number>
  </Dial>
</Response>`;
  }

  return new Response(twiml, {
    headers: { "Content-Type": "text/xml; charset=UTF-8" },
  });
}

