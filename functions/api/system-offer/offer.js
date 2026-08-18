/**
 * GET /api/system-offer/offer?t=TOKEN
 * Verifies a unique offer link and returns the public deal (company, tier, price).
 */
import { json, corsFor, signingSecret, verifyToken, publicOffer } from "./offer-lib.js";

export async function onRequest(context) {
  const cors = corsFor(context.request);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (context.request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const secret = signingSecret(context.env);
    if (!secret) {
      return json({ error: "Offer signing is not configured" }, 503, cors);
    }

    const url = new URL(context.request.url);
    const token = (url.searchParams.get("t") || url.searchParams.get("token") || "").trim();
    if (!token) return json({ error: "Missing offer token" }, 400, cors);

    const payload = await verifyToken(secret, token);
    return json({ offer: publicOffer(payload) }, 200, cors);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    const status = /Missing|Invalid|tampered|Unsupported|required/i.test(msg) ? 400 : 500;
    return json({ error: msg }, status, cors);
  }
}
