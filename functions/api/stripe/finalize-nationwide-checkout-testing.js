/**
 * POST /api/stripe/finalize-nationwide-checkout-testing
 *
 * Sandbox/test-mode copy of finalize-nationwide-checkout.
 * Uses STRIPE_TEST_SECRET_KEY only. Writes Airtable Client/Customers the same
 * way as prod so Drew can self-test end-to-end; Notes are tagged [SANDBOX TEST].
 *
 * Correct CRM table = Client singular (tblH2nVfmGNG8pAjC), NOT legacy Clients plural.
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

// Correct CRM table (singular). Do NOT use legacy Clients plural tblMl8Y97cMSbricC.
const CLIENT_TABLE_ID = "tblH2nVfmGNG8pAjC";
const CUSTOMERS_TABLE_ID = DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID;

const CF = {
  NAME: "Name",
  STATUS: "Status",
  MODEL: "Model",
  LEAD_PRICE: "Lead Price",
  NICHE: "Niche",
  WEBSITE: "Website",
  CUSTOMERS: "Customers",
  B2B_LEAD: "B2B Lead",
  NOTES: "Notes",
  TCPA_CONTACT: "TCPA Contact",
  CHARGING: "Charging",
};

const CU = {
  NAME: "Name",
  EMAIL: "Email",
  STRIPE_CUSTOMER_ID: "Stripe Customer ID",
  PAYMENT_METHOD_ID: "Payment Method ID",
  // Schema: "Client" -> legacy Clients plural; "Client 2" -> correct Client singular
  CLIENT_2: "Client 2",
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
      const existing = await airtableListRecords(context.env, CLIENT_TABLE_ID, {
        filterByFormula: `FIND('${sessionId.replace(/'/g, "''")}', {Notes})`,
        maxRecords: 1,
      });
      if (existing.length > 0) {
        log("idempotent hit", existing[0].id);
        return json(
          {
            ok: true,
            alreadyFinalized: true,
            clientRecordId: existing[0].id,
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
      `payment_model=Nationwide`,
      `session=${sessionId}`,
      `signed_by=${signerName || "(unknown)"}`,
      `contact=${contactName || ""}`,
      `email=${email || ""}`,
      phone ? `phone=${phone}` : null,
      serviceArea ? `service_area=${serviceArea}` : null,
      sourceType ? `source_type=${sourceType}` : null,
      sourceRecordId ? `source_record_id=${sourceRecordId}` : null,
      `iso=${new Date().toISOString()}`,
      `stripe_customer=${stripeCustomerId}`,
      paymentMethodId ? `payment_method=${paymentMethodId}` : null,
      `safe_to_delete=true`,
    ]
      .filter(Boolean)
      .join(" | ");

    const clientFields = {
      [CF.NAME]: `[SANDBOX] ${businessName}`,
      [CF.STATUS]: "Setup",
      [CF.MODEL]: "Nationwide",
      [CF.LEAD_PRICE]: 49,
      [CF.NICHE]: ["Bathrooms"],
      [CF.CUSTOMERS]: [customerRecordId],
      [CF.NOTES]: notes,
      [CF.CHARGING]: "Pause",
    };
    if (website) clientFields[CF.WEBSITE] = website.startsWith("http") ? website : `https://${website}`;
    if (email) clientFields[CF.TCPA_CONTACT] = email;
    if (b2bLeadId) clientFields[CF.B2B_LEAD] = [b2bLeadId];

    let clientRec;
    try {
      clientRec = await airtableCreateRecord(context.env, CLIENT_TABLE_ID, clientFields, {
        typecast: true,
      });
    } catch (modelErr) {
      warn("Client create with Model=Nationwide failed; retrying Postpay Each Lead", modelErr && modelErr.message);
      clientFields[CF.MODEL] = "Postpay Each Lead";
      clientFields[CF.NOTES] = `${notes} | model_fallback=Postpay Each Lead (Nationwide intended)`;
      clientRec = await airtableCreateRecord(context.env, CLIENT_TABLE_ID, clientFields, {
        typecast: true,
      });
    }
    const clientRecordId = clientRec.id;
    if (!clientRecordId) throw new Error("Client create returned no id");
    log("client created", clientRecordId);

    try {
      await airtablePatchRecord(context.env, CUSTOMERS_TABLE_ID, customerRecordId, {
        [CU.CLIENT_2]: [clientRecordId],
      });
    } catch (linkErr) {
      warn("customer→Client 2 link failed", linkErr && linkErr.message);
    }

    let b2bUpdated = false;
    if (b2bLeadId) {
      try {
        await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, b2bLeadId);
        const leadPatch = {
          ...leadPaymentSuccessFields(),
          [F.CUSTOMER_LINK]: [customerRecordId],
          Client: [clientRecordId],
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

    log("complete", { clientRecordId, customerRecordId, ms: Date.now() - t0 });
    return json(
      {
        ok: true,
        testMode: true,
        sessionId,
        stripeCustomerId,
        paymentMethodId,
        customersRecordId: customerRecordId,
        clientRecordId,
        clientsRecordId: clientRecordId,
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
