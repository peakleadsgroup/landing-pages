/**
 * POST /api/system-offer/confirm
 * After Stripe redirects back with session_id, confirm the payment.
 *
 * Body JSON: { sessionId }
 */
import { stripeGet } from "../stripe/stripe-lib.js";
import { json, corsFor, PRODUCT, formatUsdFromCents, TIERS } from "./offer-lib.js";

const MAKE_PAYMENT_WEBHOOK_URL =
  "https://hook.us2.make.com/lnb3ggrqony2qi5l5s7r2c6x68hxhd5l";

async function notifyPaymentWebhook(payload, waitUntil) {
  const promise = fetch(MAKE_PAYMENT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn("[system-offer/confirm] webhook failed", err && err.message);
  });
  if (typeof waitUntil === "function") waitUntil(promise);
  else await promise;
}

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

    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
      return json({ error: "Invalid sessionId" }, 400, cors);
    }

    const session = await stripeGet(
      context.env,
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`
    );

    const meta = session.metadata || {};
    if (meta.product !== PRODUCT) {
      return json({ error: "This checkout session is not a System Offer payment" }, 400, cors);
    }

    const paid =
      session.payment_status === "paid" ||
      session.status === "complete";

    if (!paid) {
      return json({ error: "Payment is not complete yet", paid: false }, 400, cors);
    }

    const tier = Number(meta.tier);
    const tierInfo = TIERS[tier] || { name: meta.tier_name || "", kicker: "" };
    const priceCents = Number(meta.price_cents) || Number(session.amount_total) || 0;

    const offer = {
      id: meta.offer_id || "",
      company: meta.company || "",
      contact: meta.contact || "",
      email: meta.email || session.customer_email || "",
      phone: meta.phone || "",
      vertical: meta.vertical || "",
      tier,
      tierName: tierInfo.name,
      tierKicker: tierInfo.kicker || `Tier ${tier}`,
      priceCents,
      priceLabel: formatUsdFromCents(priceCents),
      signerName: meta.signer_name || "",
      signerTitle: meta.signer_title || "",
      signedAt: meta.signed_at || "",
    };

    await notifyPaymentWebhook(
      {
        product: PRODUCT,
        mode: "live",
        business_name: offer.company,
        contact_name: offer.contact,
        email: offer.email,
        tier: offer.tier,
        tier_name: offer.tierName,
        amount_cents: priceCents,
        signer_name: offer.signerName,
        stripe_session_id: sessionId,
        stripe_customer_id:
          typeof session.customer === "string" ? session.customer : session.customer?.id || "",
        payment_intent_id:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || "",
        offer_id: offer.id,
      },
      context.waitUntil
    );

    return json({ ok: true, paid: true, offer }, 200, cors);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    return json({ error: msg }, 500, cors);
  }
}
