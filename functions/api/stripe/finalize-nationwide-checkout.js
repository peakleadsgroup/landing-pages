/**
 * POST /api/stripe/finalize-nationwide-checkout
 * Body JSON: { "sessionId": "cs_…" }
 *
 * National / Nationwide product only.
 * On completed setup Checkout session:
 *   1) attach payment method to Stripe Customer
 *   2) create Customers row (Stripe Customer ID + Payment Method ID)
 *   3) create Client row (singular / correct CRM table): Status=Setup, Model=Nationwide, Lead Price=49
 *   4) link Customer ↔ Client via Customers."Client 2"; optional B2B lead links + payment flags
 *
 * Does NOT:
 *   - touch dedicated finalize-checkout
 *   - write to legacy Clients plural table (tblMl8Y97cMSbricC)
 *   - run onboarding form / kickoff
 *   - fire dedicated Make payment webhook
 *
 * Requires env: STRIPE_SECRET_KEY, AIRTABLE_API_KEY
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
  F,
  B2B_LEADS_TABLE_ID,
  DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID,
} from "./stripe-lib.js";

const LOG = "[finalize-nationwide]";
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
    if (!context.env.STRIPE_SECRET_KEY) {
      return json({ error: "STRIPE_SECRET_KEY required" }, 503, cors);
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

    // Idempotency: if we already created a Client row for this session, return it.
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
            clientsRecordId: existing[0].id, // alias for older clients
            sessionId,
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
      context.env,
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?${expand}`
    );

    log("session", {
      id: session.id,
      mode: session.mode,
      status: session.status,
      payment_status: session.payment_status,
      livemode: session.livemode,
    });

    if (meta(session, "product") !== "nationwide") {
      return json({ error: "Session is not a nationwide product checkout" }, 400, cors);
    }

    // setup mode → status complete; payment mode would be paid
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
        context.env,
        `/v1/setup_intents/${encodeURIComponent(si)}?expand[]=payment_method`
      );
      paymentMethodId = extractPaymentMethodId(siObj);
    }
    // payment-mode fallback
    if (!paymentMethodId && session.payment_intent) {
      const pi = session.payment_intent;
      if (typeof pi === "object") paymentMethodId = extractPaymentMethodId(pi);
      else if (typeof pi === "string") {
        const piObj = await stripeGet(
          context.env,
          `/v1/payment_intents/${encodeURIComponent(pi)}?expand[]=payment_method`
        );
        paymentMethodId = extractPaymentMethodId(piObj);
      }
    }

    if (paymentMethodId) {
      await trySavePaymentMethodOnStripeCustomer(context.env, stripeCustomerId, paymentMethodId, {
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

    // Create Customers row
    const customerFields = {
      [CU.NAME]: businessName,
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

    // Create Client row (singular / correct table) — Setup until deliberate launch
    const notes = [
      `Nationwide signup $49 exclusive bathroom leads`,
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
    ]
      .filter(Boolean)
      .join(" | ");

    const clientFields = {
      [CF.NAME]: businessName,
      [CF.STATUS]: "Setup",
      // Prefer Nationwide option on Client.Model (typecast may create option if permitted)
      [CF.MODEL]: "Nationwide",
      [CF.LEAD_PRICE]: 49,
      [CF.NICHE]: ["Bathrooms"],
      [CF.CUSTOMERS]: [customerRecordId],
      [CF.NOTES]: notes,
      [CF.CHARGING]: "Pause", // not live until network launch
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
      // Fallback if Nationwide is not yet an allowed Model option and typecast is blocked
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

    // Link Customer → Client (singular) via Client 2
    try {
      await airtablePatchRecord(context.env, CUSTOMERS_TABLE_ID, customerRecordId, {
        [CU.CLIENT_2]: [clientRecordId],
      });
    } catch (linkErr) {
      warn("customer→Client 2 link failed", linkErr && linkErr.message);
    }

    // Optional B2B lead updates (flags only; no dedicated Make webhook)
    let b2bUpdated = false;
    if (b2bLeadId) {
      try {
        await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, b2bLeadId);
        const leadPatch = {
          ...leadPaymentSuccessFields(),
          [F.CUSTOMER_LINK]: [customerRecordId],
          // B2B.Client links to singular Client table
          Client: [clientRecordId],
        };
        // Discovery Status Close Won is best-effort (may not apply to all sources)
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
        sessionId,
        stripeCustomerId,
        paymentMethodId,
        customersRecordId: customerRecordId,
        clientRecordId,
        clientsRecordId: clientRecordId, // alias
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
