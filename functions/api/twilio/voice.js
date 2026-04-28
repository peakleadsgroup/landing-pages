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
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (message, details = {}) =>
    console.log(`[api/twilio/voice][${requestId}] ${message}`, details);
  const logError = (message, err, details = {}) =>
    console.error(`[api/twilio/voice][${requestId}] ${message}`, {
      ...details,
      error: err?.message || String(err || ""),
      stack: err?.stack || null,
    });

  const req = context.request;
  const url = new URL(req.url);
  let to = url.searchParams.get("To") || "";
  log("request_received", {
    method: req.method,
    hasToQuery: Boolean(to),
    userAgent: req.headers.get("User-Agent") || "",
  });

  if (!to && req.method === "POST") {
    try {
      const form = await req.formData();
      to = String(form.get("To") || "");
      log("parsed_post_form", { hasToForm: Boolean(to) });
    } catch (err) {
      logError("failed_to_parse_post_form", err);
    }
  }

  const digits = to.replace(/\D/g, "");
  const e164 = digits.length >= 10 ? `+1${digits.slice(-10)}` : "";
  log("normalized_destination", {
    provided: to,
    digitsLength: digits.length,
    e164,
    hasCallerId: Boolean(context.env.TWILIO_VOICEMAIL_NUMBER),
  });

  let twiml = "";
  if (!e164) {
    log("invalid_destination_number");
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Invalid destination number.</Say>
</Response>`;
  } else {
    log("dialing_number");
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${xmlEscape(context.env.TWILIO_VOICEMAIL_NUMBER || "")}">
    <Number>${xmlEscape(e164)}</Number>
  </Dial>
</Response>`;
  }

  log("twiml_response_ready");
  return new Response(twiml, {
    headers: { "Content-Type": "text/xml; charset=UTF-8" },
  });
}

