/**
 * POST /api/stripe/finalize-checkout
 * Body JSON: { "sessionId": "cs_…" }
 * Requires env: STRIPE_SECRET_KEY, AIRTABLE_API_KEY
 * Optional: AIRTABLE_CUSTOMER_TABLE_ID (defaults to Customer table in this repo)
 * Optional: AIRTABLE_CUSTOMER_NAME_FIELD (default "Name") — primary / display name on Customer table
 *
 * After return from Stripe Checkout: retrieves session, verifies paid + metadata,
 * writes Stripe Customer ID + Payment Method ID to linked Customer row (or creates one + links).
 */
import {
  json,
  corsFor,
  airtableGetRecord,
  airtableCreateRecord,
  airtablePatchRecord,
  stripeGet,
  F,
  B2B_LEADS_TABLE_ID,
  DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID,
} from "./stripe-lib.js";

function extractPaymentMethodId(paymentIntent) {
  if (!paymentIntent || typeof paymentIntent !== "object") return null;
  const pm = paymentIntent.payment_method;
  if (typeof pm === "string") return pm;
  if (pm && typeof pm === "object" && pm.id) return pm.id;
  return null;
}

export async function onRequest(context) {
  const cors = corsFor(context.request);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  const customerTableId =
    (context.env.AIRTABLE_CUSTOMER_TABLE_ID || "").trim() || DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID;

  const nameField = (context.env.AIRTABLE_CUSTOMER_NAME_FIELD || "Name").trim() || "Name";

  try {
    if (!context.env.STRIPE_SECRET_KEY || !context.env.AIRTABLE_API_KEY) {
      return json({ error: "STRIPE_SECRET_KEY and AIRTABLE_API_KEY required" }, 503, cors);
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

    const expand =
      "expand[]=customer&expand[]=payment_intent.payment_method";
    const session = await stripeGet(
      context.env,
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${expand}`
    );

    if (session.payment_status !== "paid") {
      return json({ error: `Checkout not paid (status: ${session.payment_status || "unknown"})` }, 400, cors);
    }

    const metaLead =
      (session.metadata && session.metadata.b2b_lead_id) ||
      (typeof session.client_reference_id === "string" ? session.client_reference_id : null);

    if (!metaLead || !/^rec[a-zA-Z0-9]{14,}$/.test(String(metaLead).trim())) {
      return json({ error: "Session missing b2b lead reference" }, 400, cors);
    }

    const recordId = String(metaLead).trim();
    const lead = await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, recordId);
    const leadFields = lead.fields || {};

    const stripeCustomerRaw = session.customer;
    const stripeCustomerId =
      typeof stripeCustomerRaw === "string"
        ? stripeCustomerRaw
        : stripeCustomerRaw && stripeCustomerRaw.id
          ? stripeCustomerRaw.id
          : null;

    if (!stripeCustomerId) {
      return json({ error: "No Stripe customer on session" }, 400, cors);
    }

    const sessionPi = session.payment_intent;
    let piResolved = sessionPi;
    let paymentMethodId = extractPaymentMethodId(
      typeof sessionPi === "object" && sessionPi ? sessionPi : null
    );
    if (!paymentMethodId && typeof sessionPi === "string") {
      piResolved = await stripeGet(
        context.env,
        `/v1/payment_intents/${encodeURIComponent(sessionPi)}?expand[]=payment_method`
      );
      paymentMethodId = extractPaymentMethodId(piResolved);
    }
    const paymentIntentId =
      piResolved && typeof piResolved === "object" && piResolved.id
        ? piResolved.id
        : typeof sessionPi === "string"
          ? sessionPi
          : null;

    const businessName =
      leadFields[F.BUSINESS_NAME] != null ? String(leadFields[F.BUSINESS_NAME]).trim() : "Customer";

    const customerPatchFields = {
      [F.STRIPE_CUSTOMER_ID]: stripeCustomerId,
    };
    if (paymentMethodId) {
      customerPatchFields[F.PAYMENT_METHOD_ID] = paymentMethodId;
    }

    const existingLinks = Array.isArray(leadFields[F.CUSTOMER_LINK]) ? leadFields[F.CUSTOMER_LINK] : [];

    if (existingLinks.length > 0) {
      const customerRecId = existingLinks[0];
      await airtablePatchRecord(context.env, customerTableId, customerRecId, customerPatchFields);
    } else {
      const createFields = {
        ...customerPatchFields,
        [nameField]: businessName || "Customer",
      };
      const created = await airtableCreateRecord(context.env, customerTableId, createFields);
      const newCustomerId = created.id;
      if (!newCustomerId) {
        throw new Error("Airtable did not return new Customer record id");
      }
      await airtablePatchRecord(context.env, B2B_LEADS_TABLE_ID, recordId, {
        [F.CUSTOMER_LINK]: [newCustomerId],
      });
    }

    return json(
      {
        ok: true,
        recordId,
        stripeCustomerId,
        paymentMethodId,
        paymentIntentId,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    return json({ error: msg }, 500, cors);
  }
}
