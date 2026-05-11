/**
 * POST /api/stripe/finalize-checkout-testing
 *
 * Testing/sandbox copy of /api/stripe/finalize-checkout.
 * Reads STRIPE_TEST_SECRET_KEY from env (must start with "sk_test_") and uses it
 * in place of STRIPE_SECRET_KEY when talking to Stripe.
 *
 * On a confirmed paid checkout:
 *   1) creates a new record in PAID_CUSTOMERS_TABLE_ID with { Name: businessName }
 *   2) sets B2B Leads "Discovery Status" = "Close Won" on the lead record
 *   3) fires a webhook POST to MAKE_PAYMENT_WEBHOOK_URL
 * All three side-effects are best-effort and will not fail the response if they error.
 *
 * WARNING: STRIPE_TEST_SECRET_KEY must be a Stripe test-mode key. This endpoint is
 * intentionally pinned to test mode for the agreement-testing page.
 */
import {
  json,
  corsFor,
  airtableGetRecord,
  airtableCreateRecord,
  airtablePatchRecord,
  readNumber,
  stripeGet,
  F,
  B2B_LEADS_TABLE_ID,
  DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID,
} from "./stripe-lib.js";

/** Airtable table where a new record is created after each successful test-mode payment. */
const PAID_CUSTOMERS_TABLE_ID = "tblH2nVfmGNG8pAjC";
const PAID_CUSTOMERS_NAME_FIELD = "Name";
const PAID_CUSTOMERS_CHARGE_CADENCE_FIELD = "Charge Cadence";

/** B2B Leads field + value to set on the lead row when payment lands. */
const LEAD_DISCOVERY_STATUS_FIELD = "Discovery Status";
const LEAD_DISCOVERY_STATUS_VALUE = "Close Won";

/** Make.com webhook fired after a successful test-mode payment. */
const MAKE_PAYMENT_WEBHOOK_URL =
  "https://hook.us2.make.com/lnb3ggrqony2qi5l5s7r2c6x68hxhd5l";

async function notifyPaymentWebhook(payload) {
  try {
    const res = await fetch(MAKE_PAYMENT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        "[finalize-checkout-testing] webhook non-OK",
        res.status,
        text.slice(0, 200)
      );
    }
  } catch (err) {
    console.warn(
      "[finalize-checkout-testing] webhook failed",
      err && err.message ? err.message : err
    );
  }
}

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
    if (!context.env.AIRTABLE_API_KEY) {
      return json({ error: "AIRTABLE_API_KEY required" }, 503, cors);
    }

    const sandboxKey = (context.env.STRIPE_TEST_SECRET_KEY || "").trim();
    if (!sandboxKey || !sandboxKey.startsWith("sk_test_")) {
      return json(
        { error: "STRIPE_TEST_SECRET_KEY not configured (must be a sk_test_ key)" },
        503,
        cors
      );
    }

    /* stripe-lib helpers read env.STRIPE_SECRET_KEY; shadow it with the sandbox key. */
    const stripeEnv = { ...context.env, STRIPE_SECRET_KEY: sandboxKey };

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

    const expand = "expand[]=customer&expand[]=payment_intent.payment_method";
    const session = await stripeGet(
      stripeEnv,
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
        stripeEnv,
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

    const leadsUpfrontNumber = readNumber(leadFields[F.LEADS_SOLD_UPFRONT]);

    let paidCustomerRecordId = null;
    try {
      const paidCustomerFields = {
        [PAID_CUSTOMERS_NAME_FIELD]: businessName || "Customer",
      };
      if (leadsUpfrontNumber != null) {
        paidCustomerFields[PAID_CUSTOMERS_CHARGE_CADENCE_FIELD] = leadsUpfrontNumber;
      }
      const created = await airtableCreateRecord(
        context.env,
        PAID_CUSTOMERS_TABLE_ID,
        paidCustomerFields
      );
      paidCustomerRecordId = created && created.id ? created.id : null;
    } catch (err) {
      console.warn(
        "[finalize-checkout-testing] paid-customers create failed",
        err && err.message ? err.message : err
      );
    }

    let discoveryStatusUpdated = false;
    try {
      await airtablePatchRecord(context.env, B2B_LEADS_TABLE_ID, recordId, {
        [LEAD_DISCOVERY_STATUS_FIELD]: LEAD_DISCOVERY_STATUS_VALUE,
      });
      discoveryStatusUpdated = true;
    } catch (err) {
      console.warn(
        "[finalize-checkout-testing] lead discovery-status update failed",
        err && err.message ? err.message : err
      );
    }

    const webhookPromise = notifyPaymentWebhook({
      business_name: businessName,
      record_id: recordId,
      stripe_customer_id: stripeCustomerId,
      payment_intent_id: paymentIntentId,
      paid_customer_record_id: paidCustomerRecordId,
      mode: "testing",
    });
    if (typeof context.waitUntil === "function") {
      context.waitUntil(webhookPromise);
    } else {
      /* Local/dev runtimes without waitUntil: best-effort await, errors already swallowed. */
      await webhookPromise;
    }

    return json(
      {
        ok: true,
        mode: "testing",
        recordId,
        stripeCustomerId,
        paymentMethodId,
        paymentIntentId,
        paidCustomerRecordId,
        discoveryStatusUpdated,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    return json({ error: msg }, 500, cors);
  }
}
