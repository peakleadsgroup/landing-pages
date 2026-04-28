/**
 * GET /api/twilio/token
 * Returns a Twilio Voice Access Token for browser softphone use.
 *
 * Required env:
 * - TWILIO_ACCOUNT_SID
 * - TWILIO_API_KEY_SID
 * - TWILIO_API_KEY_SECRET
 * - TWILIO_TWIML_APP_SID
 */
function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signHs256(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

export async function onRequest(context) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (message, details = {}) =>
    console.log(`[api/twilio/token][${requestId}] ${message}`, details);
  const logError = (message, err, details = {}) =>
    console.error(`[api/twilio/token][${requestId}] ${message}`, {
      ...details,
      error: err?.message || String(err || ""),
      stack: err?.stack || null,
    });

  if (context.request.method !== "GET") {
    log("method_not_allowed", { method: context.request.method });
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const accountSid = context.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = context.env.TWILIO_API_KEY_SID;
  const apiKeySecret = context.env.TWILIO_API_KEY_SECRET;
  const twimlAppSid = context.env.TWILIO_TWIML_APP_SID;

  log("request_received", {
    hasAccountSid: Boolean(accountSid),
    hasApiKeySid: Boolean(apiKeySid),
    hasApiKeySecret: Boolean(apiKeySecret),
    hasTwimlAppSid: Boolean(twimlAppSid),
  });

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    log("missing_config");
    return new Response(
      JSON.stringify({
        error:
          "Missing config: TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 hour
    const identity = `sales-vm-${crypto.randomUUID().slice(0, 8)}`;
    const header = { alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" };
    const payload = {
      jti: `${apiKeySid}-${now}`,
      iss: apiKeySid,
      sub: accountSid,
      nbf: now - 1,
      exp,
      grants: {
        identity,
        voice: {
          incoming: { allow: false },
          outgoing: { application_sid: twimlAppSid },
        },
      },
    };

    const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
    const signature = await signHs256(apiKeySecret, unsigned);
    const token = `${unsigned}.${signature}`;
    log("token_created", { identity, exp });

    return new Response(JSON.stringify({ token, identity, exp }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logError("token_create_failed", err);
    return new Response(
      JSON.stringify({ error: err.message || "Failed to create token" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

