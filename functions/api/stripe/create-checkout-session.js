/**
 * POST /api/stripe/create-checkout-session
 * Body JSON: { "recordId": "rec…" }
 * Requires env: STRIPE_SECRET_KEY, AIRTABLE_API_KEY
 * Optional: STRIPE_AGREEMENT_PATH (default "/agreement.html") — path only, origin from request
 *
 * Creates a Stripe Checkout Session for onboarding = Leads Sold Upfront × Price Per Lead (USD).
 * Lead must already be signed (Signer Name / Signed Date).
 */
import {
  json,
  corsFor,
  airtableGetRecord,
  onboardingAmountCents,
  isLeadSigned,
  stripePostForm,
  F,
  B2B_LEADS_TABLE_ID,
} from "./stripe-lib.js";

export async function onRequest(context) {
  const cors = corsFor(context.request);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    const stripeKey = context.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return json({ error: "STRIPE_SECRET_KEY not configured" }, 503, cors);
    }
    if (!context.env.AIRTABLE_API_KEY) {
      return json({ error: "AIRTABLE_API_KEY not configured" }, 503, cors);
    }

    let body;
    try {
      body = await context.request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const recordId = typeof body.recordId === "string" ? body.recordId.trim() : "";
    if (!/^rec[a-zA-Z0-9]{14,}$/.test(recordId)) {
      return json({ error: "Invalid recordId" }, 400, cors);
    }

    const lead = await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, recordId);
    const fields = lead.fields || {};

    if (!isLeadSigned(fields)) {
      return json({ error: "Agreement must be signed before checkout" }, 400, cors);
    }

    const cents = onboardingAmountCents(fields);
    if (cents == null || cents <= 0) {
      return json({ error: "Could not compute payment amount from Leads Sold Upfront and Price Per Lead" }, 400, cors);
    }

    const origin = new URL(context.request.url).origin;
    const path = (context.env.STRIPE_AGREEMENT_PATH || "/agreement.html").trim() || "/agreement.html";
    const q = `recordID=${encodeURIComponent(recordId)}`;
    const successUrl = `${origin}${path.startsWith("/") ? path : `/${path}`}?${q}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}${path.startsWith("/") ? path : `/${path}`}?${q}&checkout=cancel`;

    const businessName = fields[F.BUSINESS_NAME] != null ? String(fields[F.BUSINESS_NAME]).slice(0, 250) : "Onboarding";

    const params = {
      mode: "payment",
      "customer_creation": "always",
      "client_reference_id": recordId,
      "metadata[b2b_lead_id]": recordId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(cents),
      "line_items[0][price_data][product_data][name]": `Onboarding — ${businessName}`.slice(0, 250),
    };

    const session = await stripePostForm(context.env, "/v1/checkout/sessions", params);

    if (!session.url) {
      return json({ error: "Stripe did not return a checkout URL" }, 502, cors);
    }

    return json({ url: session.url, sessionId: session.id }, 200, cors);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    return json({ error: msg }, 500, cors);
  }
}
