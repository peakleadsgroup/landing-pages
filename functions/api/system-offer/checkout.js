/**
 * POST /api/system-offer/checkout
 * After the buyer signs, create a Stripe Checkout Session for the token amount.
 *
 * Body JSON: { token, signerName, signerTitle?, consent: true }
 *
 * Requires: STRIPE_SECRET_KEY, and SYSTEM_OFFER_SECRET or STRIPE_SECRET_KEY for HMAC.
 */
import {
  stripeCreateAgreementCheckoutSession,
} from "../stripe/stripe-lib.js";
import {
  json,
  corsFor,
  signingSecret,
  verifyToken,
  publicOffer,
  clean,
  clientIp,
  PRODUCT,
  AGREEMENT_PATH,
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
    if (!context.env.STRIPE_SECRET_KEY) {
      return json({ error: "STRIPE_SECRET_KEY not configured" }, 503, cors);
    }
    const secret = signingSecret(context.env);
    if (!secret) {
      return json({ error: "Offer signing is not configured" }, 503, cors);
    }

    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const token = clean(body.token, 4000);
    const signerName = clean(body.signerName, 250);
    const signerTitle = clean(body.signerTitle, 120);
    const consent = body.consent === true || body.consent === "true";

    if (!token) return json({ error: "Missing offer token" }, 400, cors);
    if (!signerName || signerName.length < 2) {
      return json({ error: "Please enter your full legal name" }, 400, cors);
    }
    if (!consent) {
      return json({ error: "Electronic signature consent is required" }, 400, cors);
    }

    const payload = await verifyToken(secret, token);
    const offer = publicOffer(payload);
    const signedAt = new Date().toISOString();
    const ip = clientIp(context.request);

    const origin = new URL(context.request.url).origin;
    const q = `t=${encodeURIComponent(token)}`;
    const successUrl = `${origin}${AGREEMENT_PATH}?${q}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}${AGREEMENT_PATH}?${q}&checkout=cancel`;

    const productName = `Peak Leads System — ${offer.tierKicker}: ${offer.tierName}`.slice(0, 250);
    const description = `${offer.company} · ${offer.priceLabel}`.slice(0, 500);

    const meta = {
      product: PRODUCT,
      offer_id: payload.id,
      company: payload.company,
      contact: payload.contact,
      email: payload.email,
      phone: payload.phone || "",
      vertical: payload.vertical || "",
      tier: String(payload.tier),
      tier_name: offer.tierName,
      price_cents: String(payload.priceCents),
      signer_name: signerName,
      signer_title: signerTitle,
      signed_at: signedAt,
      signer_ip: ip.slice(0, 80),
    };

    const sessionParams = {
      customer_creation: "always",
      customer_email: payload.email,
      client_reference_id: payload.id.slice(0, 200),
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(payload.priceCents),
      "line_items[0][price_data][product_data][name]": productName,
      "line_items[0][price_data][product_data][description]": description,
    };
    for (const [k, v] of Object.entries(meta)) {
      if (v == null || v === "") continue;
      const val = String(v).slice(0, 500);
      sessionParams[`metadata[${k}]`] = val;
      sessionParams[`payment_intent_data[metadata][${k}]`] = val;
    }

    const session = await stripeCreateAgreementCheckoutSession(context.env, sessionParams);
    if (!session.url) {
      return json({ error: "Stripe did not return a checkout URL" }, 502, cors);
    }

    return json(
      {
        url: session.url,
        sessionId: session.id,
        offer,
        signedAt,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    const status = /Missing|Invalid|tampered|required|consent|name/i.test(msg) ? 400 : 500;
    return json({ error: msg }, status, cors);
  }
}
