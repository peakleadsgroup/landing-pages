/**
 * POST /api/stripe/finalize-checkout-testing
 *
 * Testing/sandbox copy of /api/stripe/finalize-checkout.
 * Reads STRIPE_TEST_SECRET_KEY from env (must start with "sk_test_") and uses it
 * in place of STRIPE_SECRET_KEY when talking to Stripe.
 *
 * On a confirmed paid checkout:
 *   1) writes Stripe Customer ID + Payment Method ID to the linked Customer row
 *      (creates one and links it to the lead if missing)
 *   2) best-effort: Charges row + Customer "Payments" link (same as live finalize); failures logged only
 *   3) sets B2B Leads "Discovery Status" = "Close Won" on the lead record
 *   4) fires a webhook POST to MAKE_PAYMENT_WEBHOOK_URL
 * Both side-effects (3) and (4) are best-effort and will not fail the response if they error.
 *
 * The Client row in tblH2nVfmGNG8pAjC is no longer created here; the
 * /api/onboarding/client-testing endpoint creates it after the user submits the
 * onboarding form shown on the agreement-testing page.
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
  stripeGet,
  F,
  B2B_LEADS_TABLE_ID,
  DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID,
  tryRecordChargeAndLinkCustomer,
} from "./stripe-lib.js";

const LOG_PREFIX = "[finalize-checkout-testing]";
function logFCT() {
  console.log.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
}
function warnFCT() {
  console.warn.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
}
function errFCT() {
  console.error.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
}
function truncStr(s, n) {
  if (s == null) return "";
  const str = String(s);
  return str.length > (n || 120) ? str.slice(0, n || 120) + "..." : str;
}

/** B2B Leads field + value to set on the lead row when payment lands. */
const LEAD_DISCOVERY_STATUS_FIELD = "Discovery Status";
const LEAD_DISCOVERY_STATUS_VALUE = "Close Won";

/** Make.com webhook fired after a successful test-mode payment. */
const MAKE_PAYMENT_WEBHOOK_URL =
  "https://hook.us2.make.com/lnb3ggrqony2qi5l5s7r2c6x68hxhd5l";

async function notifyPaymentWebhook(payload) {
  const t0 = Date.now();
  logFCT("webhook posting", { url: MAKE_PAYMENT_WEBHOOK_URL, payload });
  try {
    const res = await fetch(MAKE_PAYMENT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      warnFCT("webhook non-OK", res.status, truncStr(text, 200), ms + "ms");
    } else {
      logFCT("webhook OK", res.status, ms + "ms");
    }
  } catch (err) {
    warnFCT("webhook failed", err && err.message ? err.message : err);
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
  const t0 = Date.now();
  const cors = corsFor(context.request);
  const method = context.request.method;

  logFCT("request received", {
    method,
    url: truncStr(context.request.url, 200),
    origin: context.request.headers.get("Origin") || "(none)",
  });

  if (method === "OPTIONS") {
    logFCT("preflight OPTIONS — 204");
    return new Response(null, { status: 204, headers: cors });
  }

  if (method !== "POST") {
    warnFCT("rejecting non-POST method:", method);
    return json({ error: "Method not allowed" }, 405, cors);
  }

  const customerTableId =
    (context.env.AIRTABLE_CUSTOMER_TABLE_ID || "").trim() || DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID;

  const nameField = (context.env.AIRTABLE_CUSTOMER_NAME_FIELD || "Name").trim() || "Name";

  try {
    if (!context.env.AIRTABLE_API_KEY) {
      errFCT("AIRTABLE_API_KEY not configured");
      return json({ error: "AIRTABLE_API_KEY required" }, 503, cors);
    }

    const sandboxKey = (context.env.STRIPE_TEST_SECRET_KEY || "").trim();
    if (!sandboxKey || !sandboxKey.startsWith("sk_test_")) {
      errFCT("STRIPE_TEST_SECRET_KEY missing or not a sk_test_ key");
      return json(
        { error: "STRIPE_TEST_SECRET_KEY not configured (must be a sk_test_ key)" },
        503,
        cors
      );
    }
    logFCT("env OK", { customerTableId, nameField, stripeKeyKind: "sk_test_" });

    /* stripe-lib helpers read env.STRIPE_SECRET_KEY; shadow it with the sandbox key. */
    const stripeEnv = { ...context.env, STRIPE_SECRET_KEY: sandboxKey };

    let body;
    try {
      body = await context.request.json();
    } catch (parseErr) {
      warnFCT("invalid JSON body", parseErr && parseErr.message);
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
      warnFCT("invalid sessionId", truncStr(sessionId, 40));
      return json({ error: "Invalid sessionId" }, 400, cors);
    }
    logFCT("session id accepted", sessionId);

    const expand = "expand[]=customer&expand[]=payment_intent.payment_method";
    let session;
    try {
      session = await stripeGet(
        stripeEnv,
        `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${expand}`
      );
    } catch (sErr) {
      errFCT("stripe session GET failed", sErr && sErr.message);
      throw sErr;
    }
    logFCT("stripe session retrieved", {
      id: session.id,
      payment_status: session.payment_status,
      mode: session.mode,
      livemode: session.livemode,
      amount_total: session.amount_total,
      currency: session.currency,
      has_metadata_lead: !!(session.metadata && session.metadata.b2b_lead_id),
    });

    if (session.payment_status !== "paid") {
      warnFCT("checkout not paid", { payment_status: session.payment_status || "unknown" });
      return json({ error: `Checkout not paid (status: ${session.payment_status || "unknown"})` }, 400, cors);
    }

    const metaLead =
      (session.metadata && session.metadata.b2b_lead_id) ||
      (typeof session.client_reference_id === "string" ? session.client_reference_id : null);

    if (!metaLead || !/^rec[a-zA-Z0-9]{14,}$/.test(String(metaLead).trim())) {
      errFCT("session missing b2b lead reference", { metaLead });
      return json({ error: "Session missing b2b lead reference" }, 400, cors);
    }

    const recordId = String(metaLead).trim();
    logFCT("fetching B2B lead", recordId);
    let lead;
    try {
      lead = await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, recordId);
    } catch (lErr) {
      errFCT("B2B lead fetch failed", recordId, lErr && lErr.message);
      throw lErr;
    }
    const leadFields = lead.fields || {};

    const stripeCustomerRaw = session.customer;
    const stripeCustomerId =
      typeof stripeCustomerRaw === "string"
        ? stripeCustomerRaw
        : stripeCustomerRaw && stripeCustomerRaw.id
          ? stripeCustomerRaw.id
          : null;

    if (!stripeCustomerId) {
      errFCT("no Stripe customer on session");
      return json({ error: "No Stripe customer on session" }, 400, cors);
    }

    const sessionPi = session.payment_intent;
    let piResolved = sessionPi;
    let paymentMethodId = extractPaymentMethodId(
      typeof sessionPi === "object" && sessionPi ? sessionPi : null
    );
    if (!paymentMethodId && typeof sessionPi === "string") {
      logFCT("expanding payment_intent for PM id", sessionPi);
      try {
        piResolved = await stripeGet(
          stripeEnv,
          `/v1/payment_intents/${encodeURIComponent(sessionPi)}?expand[]=payment_method`
        );
      } catch (piErr) {
        errFCT("payment_intent GET failed", sessionPi, piErr && piErr.message);
        throw piErr;
      }
      paymentMethodId = extractPaymentMethodId(piResolved);
    }
    const paymentIntentId =
      piResolved && typeof piResolved === "object" && piResolved.id
        ? piResolved.id
        : typeof sessionPi === "string"
          ? sessionPi
          : null;

    logFCT("stripe references", { stripeCustomerId, paymentIntentId, paymentMethodId });

    const businessName =
      leadFields[F.BUSINESS_NAME] != null ? String(leadFields[F.BUSINESS_NAME]).trim() : "Customer";

    const customerPatchFields = {
      [F.STRIPE_CUSTOMER_ID]: stripeCustomerId,
    };
    if (paymentMethodId) {
      customerPatchFields[F.PAYMENT_METHOD_ID] = paymentMethodId;
    }

    const existingLinks = Array.isArray(leadFields[F.CUSTOMER_LINK]) ? leadFields[F.CUSTOMER_LINK] : [];

    let customerRecordId = null;
    if (existingLinks.length > 0) {
      customerRecordId = existingLinks[0];
      logFCT("patching existing Customer row", customerRecordId);
      try {
        await airtablePatchRecord(context.env, customerTableId, customerRecordId, customerPatchFields);
      } catch (cpErr) {
        errFCT("Customer patch failed", customerRecordId, cpErr && cpErr.message);
        throw cpErr;
      }
    } else {
      const createFields = {
        ...customerPatchFields,
        [nameField]: businessName || "Customer",
      };
      logFCT("creating new Customer row", { name: truncStr(businessName, 60) });
      let created;
      try {
        created = await airtableCreateRecord(context.env, customerTableId, createFields);
      } catch (ccErr) {
        errFCT("Customer create failed", ccErr && ccErr.message);
        throw ccErr;
      }
      const newCustomerId = created.id;
      if (!newCustomerId) {
        errFCT("Customer create returned no id", created);
        throw new Error("Airtable did not return new Customer record id");
      }
      customerRecordId = newCustomerId;
      logFCT("new Customer created; linking back to lead", { customerRecordId, recordId });
      try {
        await airtablePatchRecord(context.env, B2B_LEADS_TABLE_ID, recordId, {
          [F.CUSTOMER_LINK]: [newCustomerId],
        });
      } catch (linkErr) {
        errFCT("lead customer-link patch failed", linkErr && linkErr.message);
        throw linkErr;
      }
    }

    const chargeResult = await tryRecordChargeAndLinkCustomer(context.env, {
      customerTableId,
      customerRecordId,
      leadFields,
      paymentIntentId,
      warn: (...args) => warnFCT(...args),
      log: (...args) => logFCT(...args),
    });

    let discoveryStatusUpdated = false;
    try {
      logFCT("patching lead Discovery Status -> Close Won", recordId);
      await airtablePatchRecord(context.env, B2B_LEADS_TABLE_ID, recordId, {
        [LEAD_DISCOVERY_STATUS_FIELD]: LEAD_DISCOVERY_STATUS_VALUE,
      });
      discoveryStatusUpdated = true;
      logFCT("Discovery Status updated OK");
    } catch (err) {
      warnFCT("lead discovery-status update failed", err && err.message ? err.message : err);
    }

    const webhookPromise = notifyPaymentWebhook({
      business_name: businessName,
      record_id: recordId,
      stripe_customer_id: stripeCustomerId,
      payment_intent_id: paymentIntentId,
      mode: "testing",
    });
    if (typeof context.waitUntil === "function") {
      logFCT("webhook deferred via waitUntil");
      context.waitUntil(webhookPromise);
    } else {
      /* Local/dev runtimes without waitUntil: best-effort await, errors already swallowed. */
      logFCT("waitUntil unavailable; awaiting webhook inline");
      await webhookPromise;
    }

    const ms = Date.now() - t0;
    logFCT("request complete", {
      recordId,
      customerRecordId,
      chargeRecorded: chargeResult.ok,
      chargeRecordId: chargeResult.chargeRecordId,
      discoveryStatusUpdated,
      elapsedMs: ms,
    });

    return json(
      {
        ok: true,
        mode: "testing",
        recordId,
        stripeCustomerId,
        paymentMethodId,
        paymentIntentId,
        discoveryStatusUpdated,
        chargeRecorded: chargeResult.ok,
        chargeRecordId: chargeResult.chargeRecordId || null,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    errFCT("request failed", msg, e && e.stack ? truncStr(e.stack, 1000) : "(no stack)");
    return json({ error: msg }, 500, cors);
  }
}
