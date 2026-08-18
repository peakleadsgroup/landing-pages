/**
 * POST /api/system-offer/create-link
 * Salesperson creates a signed unique buyer link.
 *
 * Body JSON:
 * { company, contact, email, phone?, vertical?, tier: 1|2|3, price }
 *
 * Signing secret: SYSTEM_OFFER_SECRET (preferred) or STRIPE_SECRET_KEY.
 */
import {
  json,
  corsFor,
  signingSecret,
  signToken,
  validateCreateBody,
  publicOffer,
  offerUrl,
} from "./offer-lib.js";

export async function onRequest(context) {
  const cors = corsFor(context.request);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const secret = signingSecret(context.env);
    if (!secret) {
      return json({ error: "SYSTEM_OFFER_SECRET or STRIPE_SECRET_KEY is not configured" }, 503, cors);
    }

    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const payload = validateCreateBody(body || {});
    const token = await signToken(secret, payload);
    const origin = new URL(context.request.url).origin;
    const url = offerUrl(origin, token);

    return json({ url, token, offer: publicOffer(payload) }, 200, cors);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    const details = e && Array.isArray(e.details) ? e.details : undefined;
    const status = /required|valid|Select|Price|Invalid/i.test(msg) ? 400 : 500;
    return json(details ? { error: msg, details } : { error: msg }, status, cors);
  }
}
