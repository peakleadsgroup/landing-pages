/**
 * POST /api/call
 * Body: { to: "+19193634740" }
 * Places an outbound Twilio call from TWILIO_VOICEMAIL_NUMBER.
 */
export async function onRequest(context) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (message, details = {}) =>
    console.log(`[api/call][${requestId}] ${message}`, details);
  const logError = (message, err, details = {}) =>
    console.error(`[api/call][${requestId}] ${message}`, {
      ...details,
      error: err?.message || String(err || ""),
      stack: err?.stack || null,
    });

  if (context.request.method !== "POST") {
    log("method_not_allowed", { method: context.request.method });
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sid = context.env.TWILIO_ACCOUNT_SID;
  const token = context.env.TWILIO_AUTH_TOKEN;
  const from = context.env.TWILIO_VOICEMAIL_NUMBER;
  log("request_received", {
    hasAccountSid: Boolean(sid),
    hasAuthToken: Boolean(token),
    hasFromNumber: Boolean(from),
  });

  if (!sid || !token || !from) {
    log("missing_config");
    return new Response(
      JSON.stringify({
        error:
          "Missing config: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICEMAIL_NUMBER",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await context.request.json();
    const toRaw = String(body.to || "").trim();
    const toDigits = toRaw.replace(/\D/g, "");
    log("parsed_request_body", { toRaw, digitsLength: toDigits.length });
    if (toDigits.length < 10) {
      log("invalid_destination_phone", { toRaw });
      return new Response(JSON.stringify({ error: "Invalid destination phone number" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const to = toRaw.startsWith("+") ? toRaw : `+1${toDigits.slice(-10)}`;
    const twimlUrl = "http://twimlets.com/message?Message%5B0%5D=PeakLeads%20callback%20test";
    const apiUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`;
    const auth = btoa(`${sid}:${token}`);
    const form = new URLSearchParams();
    form.set("To", to);
    form.set("From", from);
    form.set("Url", twimlUrl);
    log("calling_twilio_api", { apiUrl, from, to, twimlUrl });

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { raw: text };
    }

    if (!res.ok) {
      log("twilio_call_create_failed", { status: res.status, response: data });
      return new Response(
        JSON.stringify({
          error: data.message || `Twilio call create failed (${res.status})`,
          code: data.code,
          details: data,
        }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    log("twilio_call_created", { sid: data.sid, status: data.status, to: data.to, from: data.from });
    return new Response(
      JSON.stringify({
        ok: true,
        sid: data.sid,
        status: data.status,
        to: data.to,
        from: data.from,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    logError("call_request_failed", err);
    return new Response(
      JSON.stringify({ error: err.message || "Failed to place call" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

