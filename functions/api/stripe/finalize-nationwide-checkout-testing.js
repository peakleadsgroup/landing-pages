/**
 * POST /api/stripe/finalize-nationwide-checkout-testing
 *
 * Sandbox/test-mode copy of finalize-nationwide-checkout.
 * Uses STRIPE_TEST_SECRET_KEY only. Writes Airtable Clients/Customers the same
 * way as prod so Drew can self-test end-to-end; Notes are tagged [SANDBOX TEST].
 */
import {
  json,
  corsFor,
  airtableGetRecord,
  airtableCreateRecord,
  airtablePatchRecord,
  airtableListRecords,
  stripeGet,
  trySavePaymentMethodOnStripeCustomer,
  leadPaymentSuccessFields,
  resolveStripeTestSecretKey,
  stripeEnvWithSecretKey,
  F,
  B2B_LEADS_TABLE_ID,
  DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID,
} from "./stripe-lib.js";

const LOG = "[finalize-nationwide-testing]";
const log = (...a) => console.log(LOG, ...a);
const warn = (...a) => console.warn(LOG, ...a);
const err = (...a) => console.error(LOG, ...a);

const CLIENTS_TABLE_ID = "tblMl8Y97cMSbricC";
const CUSTOMERS_TABLE_ID = DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID;

const CF = {
  NAME: "Name",
  STATUS: "Status",
  PAYMENT_MODEL: "Payment Model",
  LEAD_PRICE: "Lead Price",
  NICHE: "Niche",
  WEBSITE: "Website",
  PHONE: "Phone",
  SERVICE_AREA: "Service Area",
  STRIPE_CUSTOMER: "Stripe Customer",
  B2B_LEAD: "B2B Lead",
  NOTES: "Notes",
};

const CU = {
  NAME: "Name",
  EMAIL: "Email",
  STRIPE_CUSTOMER_ID: "Stripe Customer ID",
  PAYMENT_METHOD_ID: "Payment Method ID",
  CLIENT: "Client",
  B2B_LEAD: "B2B Lead",
  B2B_LEADS: "B2B Leads",
};

function extractPaymentMethodId(obj) {
  if (!obj || typeof obj !== "object") return null;
  const pm = obj.payment_method;
  if (typeof pm === "string") return pm;
  if (pm && typeof pm === "object" && pm.id) return pm.id;
  return null;
}

function meta(session, key) {
  const m = (session && session.metadata) || {};
  return m[key] != null ? String(m[key]).trim() : "";
}

export async function onRequest(context) {
  const t0 = Date.now();
  const cors = corsFor(context.request);

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (context.request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    if (!context.env.AIRTABLE_API_KEY) {
      return json({ error: "AIRTABLE_API_KEY required" }, 503, cors);
    }
    const sandboxKey = resolveStripeTestSecretKey(context.env);
    if (!sandboxKey) {
      return json(
        {
          error:
            "Stripe test key not configured. Set STRIPE_TEST_SECRET_KEY (sk_test_) for nationwide testing endpoints.",
        },
        503,
        cors
      );
    }
    const stripeEnv = stripeEnvWithSecretKey(context.env, sandboxKey);

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

    try {
      const existing = await airtableListRecords(context.env, CLIENTS_TABLE_ID, {
        filterByFormula: `FIND('${sessionId.replace(/'/g, "''")}', {Notes})`,
        maxRecords: 1,
      });
      if (existing.length > 0) {
        log("idempotent hit", existing[0].id);
        return json(
          {
            ok: true,
            alreadyFinalized: true,
            clientsRecordId: existing[0].id,
            sessionId,
            testMode: true,
          },
          200,
          cors
        );
      }
    } catch (idErr) {
      warn("idempotency check failed (continuing)", idErr && idErr.message);
    }

    const expand =
      "expand[]=customer&expand[]=setup_intent&expand[]=setup_intent.payment_method";
    const session = await stripeGet(
      stripeEnv,
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${expand}`
    );

    log("session", {
      id: session.id,
      mode: session.mode,
      status: session.status,
      payment_status: session.payment_status,
      livemode: session.livemode,
    });

    if (session.livemode === true) {
      return json(
        { error: "Refusing live-mode session on testing finalize endpoint" },
        400,
        cors
      );
    }

    if (meta(session, "product") !== "nationwide") {
      return json({ error: "Session is not a nationwide product checkout" }, 400, cors);
    }

    if (session.mode === "setup") {
      if (session.status !== "complete") {
        return json(
          { error: `Checkout not complete (status: ${session.status || "unknown"})` },
          400,
          cors
        );
      }
    } else if (session.payment_status !== "paid") {
      return json(
        { error: `Checkout not paid (status: ${session.payment_status || "unknown"})` },
        400,
        cors
      );
    }

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

    let paymentMethodId = null;
    const si = session.setup_intent;
    if (si && typeof si === "object") {
      paymentMethodId = extractPaymentMethodId(si);
    } else if (typeof si === "string") {
      const siObj = await stripeGet(
        stripeEnv,
        `/v1/setup_intents/${encodeURIComponent(si)}?expand[]=payment_method`
      );
      paymentMethodId = extractPaymentMethodId(siObj);
    }
    if (!paymentMethodId && session.payment_intent) {
      const pi = session.payment_intent;
      if (typeof pi === "object") paymentMethodId = extractPaymentMethodId(pi);
      else if (typeof pi === "string") {
        const piObj = await stripeGet(
          stripeEnv,
          `/v1/payment_intents/${encodeURIComponent(pi)}?expand[]=payment_method`
        );
        paymentMethodId = extractPaymentMethodId(piObj);
      }
    }

    if (paymentMethodId) {
      await trySavePaymentMethodOnStripeCustomer(stripeEnv, stripeCustomerId, paymentMethodId, {
        log,
        warn,
      });
    }

    const businessName = meta(session, "business_name") || "Nationwide Client";
    const contactName = meta(session, "contact_name");
    const email = meta(session, "email");
    const phone = meta(session, "phone");
    const website = meta(session, "website");
    const serviceArea = meta(session, "service_area");
    const signerName = meta(session, "signer_name");
    const sourceType = (meta(session, "source_type") || "").toLowerCase();
    const sourceRecordId = meta(session, "source_record_id");
    let b2bLeadId = meta(session, "b2b_lead_id");
    // Only treat as B2B when source_type says so. If source_type is missing
    // but b2b_lead_id is present (legacy sessions), verify it actually lives
    // in the B2B table before linking.
    let isB2b =
      sourceType === "b2b" ||
      sourceType === "b2b_leads" ||
      sourceType === "lead";
    if (!isB2b) {
      if (b2bLeadId && !sourceType) {
        try {
          await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, b2bLeadId);
          isB2b = true;
        } catch {
          isB2b = false;
          b2bLeadId = "";
        }
      } else {
        b2bLeadId = "";
      }
    }

    const customerFields = {
      [CU.NAME]: `[SANDBOX] ${businessName}`,
      [CU.STRIPE_CUSTOMER_ID]: stripeCustomerId,
    };
    if (email) customerFields[CU.EMAIL] = email;
    if (paymentMethodId) customerFields[CU.PAYMENT_METHOD_ID] = paymentMethodId;
    if (b2bLeadId) {
      customerFields[CU.B2B_LEAD] = [b2bLeadId];
      customerFields[CU.B2B_LEADS] = [b2bLeadId];
    }

    const customerRec = await airtableCreateRecord(context.env, CUSTOMERS_TABLE_ID, customerFields, {
      typecast: true,
    });
    const customerRecordId = customerRec.id;
    if (!customerRecordId) throw new Error("Customer create returned no id");
    log("customer created", customerRecordId);

    const notes = [
      `[SANDBOX TEST] Nationwide signup $49 exclusive bathroom leads`,
      `same quality as dedicated $99-$150; no volume guarantee; card on file only`,
      `session=${sessionId}`,
      `signed_by=${signerName || "(unknown)"}`,
      `contact=${contactName || ""}`,
      `email=${email || ""}`,
      sourceType ? `source_type=${sourceType}` : null,
      sourceRecordId ? `source_record_id=${sourceRecordId}` : null,
      `iso=${new Date().toISOString()}`,
      `stripe_customer=${stripeCustomerId}`,
      paymentMethodId ? `payment_method=${paymentMethodId}` : null,
      `safe_to_delete=true`,
    ]
      .filter(Boolean)
      .join(" | ");

    const clientsFields = {
      [CF.NAME]: `[SANDBOX] ${businessName}`,
      [CF.STATUS]: "Setup",
      [CF.PAYMENT_MODEL]: "Nationwide",
      [CF.LEAD_PRICE]: 49,
      [CF.NICHE]: ["Bathrooms"],
      [CF.STRIPE_CUSTOMER]: [customerRecordId],
      [CF.NOTES]: notes,
    };
    if (website) clientsFields[CF.WEBSITE] = website.startsWith("http") ? website : `https://${website}`;
    if (phone) clientsFields[CF.PHONE] = phone;
    if (serviceArea) clientsFields[CF.SERVICE_AREA] = serviceArea;
    if (b2bLeadId) clientsFields[CF.B2B_LEAD] = [b2bLeadId];

    const clientsRec = await airtableCreateRecord(context.env, CLIENTS_TABLE_ID, clientsFields, {
      typecast: true,
    });
    const clientsRecordId = clientsRec.id;
    if (!clientsRecordId) throw new Error("Clients create returned no id");
    log("clients created", clientsRecordId);

    try {
      await airtablePatchRecord(context.env, CUSTOMERS_TABLE_ID, customerRecordId, {
        [CU.CLIENT]: [clientsRecordId],
      });
    } catch (linkErr) {
      warn("customer→clients link failed", linkErr && linkErr.message);
    }

    let b2bUpdated = false;
    if (b2bLeadId) {
      try {
        await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, b2bLeadId);
        const leadPatch = {
          ...leadPaymentSuccessFields(),
          [F.CUSTOMER_LINK]: [customerRecordId],
          Business: [clientsRecordId],
        };
        try {
          await airtablePatchRecord(context.env, B2B_LEADS_TABLE_ID, b2bLeadId, {
            ...leadPatch,
            "Discovery Status": "Close Won",
          });
        } catch {
          await airtablePatchRecord(context.env, B2B_LEADS_TABLE_ID, b2bLeadId, leadPatch);
        }
        b2bUpdated = true;
      } catch (b2bErr) {
        warn("B2B lead update failed", b2bErr && b2bErr.message);
      }
    }

    log("complete", { clientsRecordId, customerRecordId, ms: Date.now() - t0 });
    return json(
      {
        ok: true,
        testMode: true,
        sessionId,
        stripeCustomerId,
        paymentMethodId,
        customersRecordId: customerRecordId,
        clientsRecordId,
        status: "Setup",
        paymentModel: "Nationwide",
        leadPrice: 49,
        b2bUpdated,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    err("failed", msg);
    return json({ error: msg }, 500, cors);
  }
}
