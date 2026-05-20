/**
 * Shared helpers for Stripe Checkout Pages Functions.
 */

export const AIRTABLE_BASE_ID = "appmBb0lzqRK9dI8v";
export const B2B_LEADS_TABLE_ID = "tbldNpwtCN9y5Pkiy";

/** B2B Leads → Customer (linked table). Override with env AIRTABLE_CUSTOMER_TABLE_ID if it ever changes. */
export const DEFAULT_AIRTABLE_CUSTOMER_TABLE_ID = "tbl9xNF0tpXvzkvX7";

/** Customers.Payments → Charges. Override with env AIRTABLE_CHARGES_TABLE_ID if it ever changes. */
export const DEFAULT_AIRTABLE_CHARGES_TABLE_ID = "tblU9p7dmEgboC2Mk";

/** Charges table field names (must match Airtable). */
export const CHARGE_FIELDS = {
  CHARGE_ID: "Charge ID",
  STATUS: "Status",
  AMOUNT: "Amount",
  PRICE: "Price",
  NUMBER: "Number",
};

/** Customers table: linked Charges records. */
export const CUSTOMER_PAYMENTS_FIELD = "Payments";

/** Customers table: long text for charge/Payments flow diagnostics. */
export const CUSTOMER_ERROR_FIELD = "Error";

/** API version that supports Checkout wallet_options.link.display (Apr 2025+). */
export const STRIPE_CHECKOUT_API_VERSION = "2025-04-30.basil";

/** Card-only Checkout (no ACH / other payment_method_types). */
export const CHECKOUT_CARD_ONLY_BASE_PARAMS = {
  mode: "payment",
  "payment_method_types[0]": "card",
  "payment_intent_data[setup_future_usage]": "off_session",
};

/** Hide Stripe Link on Checkout (requires STRIPE_CHECKOUT_API_VERSION). */
export const CHECKOUT_DISABLE_LINK_PARAMS = {
  "wallet_options[link][display]": "never",
};

/** @deprecated Prefer CHECKOUT_CARD_ONLY_BASE_PARAMS; kept for spread compatibility. */
export const CHECKOUT_CARD_ONLY_STRIPE_PARAMS = {
  ...CHECKOUT_CARD_ONLY_BASE_PARAMS,
  ...CHECKOUT_DISABLE_LINK_PARAMS,
};

/**
 * Resolve a Stripe test secret (sk_test_). Accepts STRIPE_TEST_SECRET_KEY or
 * STRIPE_SECRET_KEY when that value is already a test key (local sandbox testing).
 */
export function resolveStripeTestSecretKey(env) {
  const testKey = (env.STRIPE_TEST_SECRET_KEY || "").trim();
  if (testKey.startsWith("sk_test_")) return testKey;
  const mainKey = (env.STRIPE_SECRET_KEY || "").trim();
  if (mainKey.startsWith("sk_test_")) return mainKey;
  return "";
}

/** Env object with STRIPE_SECRET_KEY set for stripe-lib HTTP helpers. */
export function stripeEnvWithSecretKey(env, secretKey) {
  return { ...env, STRIPE_SECRET_KEY: secretKey };
}

export const F = {
  BUSINESS_NAME: "Business Name",
  LEADS_SOLD_UPFRONT: "Leads Sold Upfront",
  PRICE_PER_LEAD: "Price Per Lead",
  SIGNER_NAME: "Signer Name",
  SIGNED_DATE: "Signed Date",
  CUSTOMER_LINK: "Customer",
  STRIPE_CUSTOMER_ID: "Stripe Customer ID",
  PAYMENT_METHOD_ID: "Payment Method ID",
};

/** B2B Leads fields updated after successful Stripe checkout (not on Customers table). */
export const LEAD_PAYMENT_FIELDS = {
  PAYMENT_METHOD_SAVED: "Payment Method Saved",
  PAYMENT_SUCCESSFULLY_RECEIVED: "Payment Successfully Received",
  STRIPE_CUSTOMER_CREATED: "Stripe Customer Created",
};

function formatAirtableError(data, status) {
  const err = data && data.error;
  if (err && typeof err === "object" && typeof err.message === "string") {
    return err.message;
  }
  if (typeof err === "string") return err;
  return `Airtable ${status}`;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

/** CORS for browser POST from agreement page (JSON triggers preflight). */
export function corsFor(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}

export function readNumber(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "string") {
    const n = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  if (Array.isArray(val)) {
    for (const x of val) {
      const n = readNumber(x);
      if (n != null) return n;
    }
    return null;
  }
  if (typeof val === "object") {
    if (typeof val.value === "number" && Number.isFinite(val.value)) return val.value;
    if (typeof val.amount === "number" && Number.isFinite(val.amount)) return val.amount;
  }
  const n2 = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n2) ? n2 : null;
}

export function onboardingAmountCents(fields) {
  const upfront = readNumber(fields[F.LEADS_SOLD_UPFRONT]);
  const ppl = readNumber(fields[F.PRICE_PER_LEAD]);
  if (upfront == null || ppl == null) return null;
  return Math.round(upfront * ppl * 100);
}

export function isLeadSigned(fields) {
  const sn = fields[F.SIGNER_NAME];
  const sd = fields[F.SIGNED_DATE];
  if (sn != null && String(sn).trim() !== "") return true;
  if (sd != null && String(sd).trim() !== "") return true;
  return false;
}

export async function airtableGetRecord(env, tableId, recordId) {
  const key = env.AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY not configured");
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Airtable invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(formatAirtableError(data, res.status));
  }
  return data;
}

export async function airtableCreateRecord(env, tableId, fields, options) {
  const key = env.AIRTABLE_API_KEY;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableId)}`;
  /** typecast lets Airtable coerce strings into single/multi-select options (auto-creating if missing). */
  const payload = { fields };
  if (options && options.typecast) payload.typecast = true;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Airtable invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(formatAirtableError(data, res.status));
  }
  return data;
}

export async function airtablePatchRecord(env, tableId, recordId, fields) {
  const key = env.AIRTABLE_API_KEY;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Airtable invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(formatAirtableError(data, res.status));
  }
  return data;
}

/** Checkbox flags on the B2B lead after payment is confirmed. */
export function leadPaymentSuccessFields() {
  return {
    [LEAD_PAYMENT_FIELDS.PAYMENT_METHOD_SAVED]: true,
    [LEAD_PAYMENT_FIELDS.PAYMENT_SUCCESSFULLY_RECEIVED]: true,
    [LEAD_PAYMENT_FIELDS.STRIPE_CUSTOMER_CREATED]: true,
  };
}

/**
 * @param {object} env
 * @param {string} tableId
 * @param {{ filterByFormula?: string, maxRecords?: number }} query
 */
export async function airtableListRecords(env, tableId, query = {}) {
  const key = env.AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY not configured");
  const usp = new URLSearchParams();
  if (query.filterByFormula != null && query.filterByFormula !== "") {
    usp.set("filterByFormula", query.filterByFormula);
  }
  if (query.maxRecords != null) usp.set("maxRecords", String(query.maxRecords));
  const qs = usp.toString();
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableId)}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Airtable invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(formatAirtableError(data, res.status));
  }
  return Array.isArray(data.records) ? data.records : [];
}

/** Escape a string for use inside single quotes in an Airtable filterByFormula literal. */
function escapeAirtableFormulaString(s) {
  return String(s).replace(/'/g, "''");
}

const CHARGE_ERROR_LOG_MAX = 95000;

function formatErr(e) {
  if (e == null) return "(none)";
  const msg = e.message != null ? String(e.message) : String(e);
  const stack = e.stack != null ? String(e.stack) : "";
  return stack ? `${msg}\n${stack}` : msg;
}

/**
 * Best-effort: write or clear Customer "Error" long text (charge / Payments flow only).
 * Never throws.
 */
async function patchCustomerChargeDiagnostic(
  env,
  customerTableId,
  customerRecordId,
  /** @type {string} full text or "" to clear */
  body,
  warn
) {
  if (!customerRecordId) return;
  const text =
    body.length > CHARGE_ERROR_LOG_MAX ? `${body.slice(0, CHARGE_ERROR_LOG_MAX)}\n\n...(truncated)` : body;
  try {
    await airtablePatchRecord(env, customerTableId, customerRecordId, {
      [CUSTOMER_ERROR_FIELD]: text,
    });
  } catch (e) {
    warn("charge: could not write Customer Error field", e && e.message);
  }
}

/**
 * Best-effort: create a Charges row for this Payment Intent and append it to Customer.Payments.
 * Never throws. Failures are logged via warn(); on failure also writes details to Customer "Error".
 *
 * @param {object} env
 * @param {{
 *   chargesTableId?: string,
 *   customerTableId: string,
 *   customerRecordId: string,
 *   leadFields: Record<string, unknown>,
 *   paymentIntentId: string | null,
 *   warn?: (...args: unknown[]) => void,
 *   log?: (...args: unknown[]) => void,
 * }} params
 * @returns {Promise<{ ok: boolean, chargeRecordId?: string, duplicate?: boolean, skippedReason?: string }>}
 */
export async function tryRecordChargeAndLinkCustomer(env, params) {
  const warn = typeof params.warn === "function" ? params.warn : (...a) => console.warn("[charge]", ...a);
  const log = typeof params.log === "function" ? params.log : () => {};
  const fromEnv = (env.AIRTABLE_CHARGES_TABLE_ID || "").trim();
  const chargesTableId =
    (params.chargesTableId || "").trim() || fromEnv || DEFAULT_AIRTABLE_CHARGES_TABLE_ID;
  const { customerTableId, customerRecordId, leadFields, paymentIntentId } = params;

  const fail = async (skippedReason, lines, extra) => {
    const detail = [
      `step: ${skippedReason}`,
      `isoTime: ${new Date().toISOString()}`,
      `chargesTableId: ${chargesTableId}`,
      `customerTableId: ${customerTableId}`,
      `customerRecordId: ${customerRecordId || "(none)"}`,
      `paymentIntentId: ${paymentIntentId != null ? String(paymentIntentId) : "(none)"}`,
      ...(lines || []),
    ].join("\n");
    warn("charge: failed —", skippedReason, extra !== undefined ? extra : "");
    await patchCustomerChargeDiagnostic(env, customerTableId, customerRecordId, detail, warn);
    return { ok: false, ...extra, skippedReason };
  };

  const succeed = async (result) => {
    await patchCustomerChargeDiagnostic(env, customerTableId, customerRecordId, "", warn);
    return result;
  };

  try {
    if (!paymentIntentId || typeof paymentIntentId !== "string") {
      warn("charge: skipped — no paymentIntentId");
      return await fail("no_payment_intent", [
        "cause: Stripe Payment Intent id missing after checkout (unexpected if session was paid).",
      ]);
    }
    if (!customerRecordId) {
      warn("charge: skipped — no customerRecordId");
      return { ok: false, skippedReason: "no_customer" };
    }

    const upfrontRaw = readNumber(leadFields[F.LEADS_SOLD_UPFRONT]);
    const ppl = readNumber(leadFields[F.PRICE_PER_LEAD]);
    if (upfrontRaw == null || ppl == null || upfrontRaw <= 0 || ppl <= 0) {
      warn("charge: skipped — invalid Leads Sold Upfront or Price Per Lead", { upfront: upfrontRaw, ppl });
      return await fail("invalid_lead_pricing", [
        `Leads Sold Upfront (raw): ${JSON.stringify(leadFields[F.LEADS_SOLD_UPFRONT])} → parsed: ${upfrontRaw}`,
        `Price Per Lead (raw): ${JSON.stringify(leadFields[F.PRICE_PER_LEAD])} → parsed: ${ppl}`,
        "expected: both positive numbers from B2B lead (same as checkout line item).",
      ]);
    }

    const upfront = upfrontRaw;
    const amountTotal = upfront * ppl;

    let chargeRecordId = null;
    let duplicate = false;
    let listErrCaptured = null;

    try {
      const formula = `{${CHARGE_FIELDS.CHARGE_ID}}='${escapeAirtableFormulaString(paymentIntentId)}'`;
      const existing = await airtableListRecords(env, chargesTableId, {
        filterByFormula: formula,
        maxRecords: 1,
      });
      if (existing.length > 0 && existing[0].id) {
        chargeRecordId = existing[0].id;
        duplicate = true;
        log("charge: existing row for Payment Intent", paymentIntentId, chargeRecordId);
      }
    } catch (listErr) {
      listErrCaptured = listErr;
      warn("charge: list existing by Charge ID failed (will still try create)", listErr && listErr.message);
    }

    if (!chargeRecordId) {
      const fields = {
        [CHARGE_FIELDS.CHARGE_ID]: paymentIntentId,
        [CHARGE_FIELDS.STATUS]: "succeeded",
        [CHARGE_FIELDS.AMOUNT]: amountTotal,
        [CHARGE_FIELDS.PRICE]: ppl,
        [CHARGE_FIELDS.NUMBER]: upfront,
      };
      try {
        const created = await airtableCreateRecord(env, chargesTableId, fields);
        chargeRecordId = created && created.id ? created.id : null;
        if (!chargeRecordId) {
          warn("charge: create returned no id", created);
          return await fail("create_no_id", [
            "cause: Airtable POST Charges returned no record id.",
            `responseSummary: ${JSON.stringify(created != null ? created : null)}`,
            `payloadSent: ${JSON.stringify(fields)}`,
            listErrCaptured
              ? `priorListByChargeIdError (non-fatal): ${formatErr(listErrCaptured)}`
              : "",
          ].filter(Boolean));
        }
        log("charge: created Charges row", chargeRecordId);
      } catch (createErr) {
        warn("charge: create failed", createErr && createErr.message);
        return await fail("create_failed", [
          "cause: Airtable rejected Charges row create.",
          `createError: ${formatErr(createErr)}`,
          `payloadSent: ${JSON.stringify(fields)}`,
          listErrCaptured
            ? `priorListByChargeIdError (non-fatal): ${formatErr(listErrCaptured)}`
            : "",
        ].filter(Boolean));
      }
    }

    let paymentLinks = [];
    try {
      const cust = await airtableGetRecord(env, customerTableId, customerRecordId);
      const f = cust.fields || {};
      const raw = f[CUSTOMER_PAYMENTS_FIELD];
      paymentLinks = Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
    } catch (getErr) {
      warn("charge: could not read Customer for Payments link", getErr && getErr.message);
      return await fail("customer_fetch_failed", [
        "cause: could not GET Customer to read existing Payments links.",
        `getCustomerError: ${formatErr(getErr)}`,
        `chargeRecordIdToLink: ${chargeRecordId || "(none)"}`,
      ], { chargeRecordId });
    }

    if (paymentLinks.includes(chargeRecordId)) {
      log("charge: Customer.Payments already includes", chargeRecordId);
      return await succeed({ ok: true, chargeRecordId, duplicate });
    }

    const merged = paymentLinks.concat([chargeRecordId]);
    try {
      await airtablePatchRecord(env, customerTableId, customerRecordId, {
        [CUSTOMER_PAYMENTS_FIELD]: merged,
      });
      log("charge: linked to Customer.Payments", customerRecordId, chargeRecordId);
    } catch (patchErr) {
      warn("charge: Customer Payments patch failed", patchErr && patchErr.message);
      return await fail(
        "payments_patch_failed",
        [
          "cause: PATCH Customer to append Payments failed.",
          `patchError: ${formatErr(patchErr)}`,
          `existingPaymentRecordIds (${paymentLinks.length}): ${JSON.stringify(paymentLinks)}`,
          `chargeRecordIdToAppend: ${chargeRecordId}`,
          `mergedWouldHaveBeen (${merged.length}): ${JSON.stringify(merged)}`,
        ],
        { chargeRecordId, duplicate }
      );
    }

    return await succeed({ ok: true, chargeRecordId, duplicate });
  } catch (e) {
    warn("charge: unexpected", e && e.message);
    if (customerRecordId) {
      await patchCustomerChargeDiagnostic(
        env,
        customerTableId,
        customerRecordId,
        [
          `step: unexpected`,
          `isoTime: ${new Date().toISOString()}`,
          `chargesTableId: ${chargesTableId}`,
          `customerRecordId: ${customerRecordId}`,
          `paymentIntentId: ${paymentIntentId != null ? String(paymentIntentId) : "(none)"}`,
          `error: ${formatErr(e)}`,
        ].join("\n"),
        warn
      );
    }
    return { ok: false, skippedReason: "unexpected" };
  }
}

function stripeAuthHeaders(env, apiVersion) {
  const sk = env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error("STRIPE_SECRET_KEY not configured");
  const headers = { Authorization: `Bearer ${sk}` };
  const ver = (apiVersion || env.STRIPE_API_VERSION || "").trim();
  if (ver) headers["Stripe-Version"] = ver;
  return headers;
}

/**
 * Create an agreement Checkout Session. Uses a recent Stripe API version for
 * wallet_options; falls back without wallet_options if Stripe rejects that param.
 *
 * @param {Record<string, string>} sessionParams checkout fields (line items, urls, metadata, …)
 */
export async function stripeCreateAgreementCheckoutSession(env, sessionParams) {
  const withLinkDisabled = {
    ...CHECKOUT_CARD_ONLY_BASE_PARAMS,
    ...CHECKOUT_DISABLE_LINK_PARAMS,
    ...sessionParams,
  };
  try {
    return await stripePostForm(env, "/v1/checkout/sessions", withLinkDisabled, {
      apiVersion: STRIPE_CHECKOUT_API_VERSION,
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "";
    if (!/wallet_options|unknown parameter/i.test(msg)) throw e;
    console.warn("[stripe] wallet_options rejected; retrying card-only checkout without Link override");
    return await stripePostForm(env, "/v1/checkout/sessions", {
      ...CHECKOUT_CARD_ONLY_BASE_PARAMS,
      ...sessionParams,
    });
  }
}

/**
 * @param {Record<string, string>} params flat Stripe API params (nested keys use bracket notation)
 * @param {{ apiVersion?: string }} [options]
 */
export async function stripePostForm(env, path, params, options = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      ...stripeAuthHeaders(env, options.apiVersion),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Stripe invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg = data.error?.message || data.message || text || res.statusText;
    throw new Error(typeof msg === "string" ? msg : `Stripe ${res.status}`);
  }
  return data;
}

/**
 * Best-effort: ensure the payment method is on the Stripe Customer and set as default
 * for future off-session charges. Never throws.
 */
export async function trySavePaymentMethodOnStripeCustomer(
  env,
  stripeCustomerId,
  paymentMethodId,
  { log, warn } = {}
) {
  const doLog = typeof log === "function" ? log : () => {};
  const doWarn = typeof warn === "function" ? warn : (...a) => console.warn("[stripe-pm-save]", ...a);
  if (!stripeCustomerId || !paymentMethodId) return;

  try {
    await stripePostForm(env, `/v1/payment_methods/${encodeURIComponent(paymentMethodId)}/attach`, {
      customer: stripeCustomerId,
    });
    doLog("payment method attached to customer", stripeCustomerId);
  } catch (attachErr) {
    const msg = attachErr && attachErr.message ? String(attachErr.message) : String(attachErr);
    if (!/already been attached|already attached/i.test(msg)) {
      doWarn("attach payment method (may already be attached)", msg);
    }
  }

  try {
    await stripePostForm(env, `/v1/customers/${encodeURIComponent(stripeCustomerId)}`, {
      "invoice_settings[default_payment_method]": paymentMethodId,
    });
    doLog("default payment method set on customer", stripeCustomerId);
  } catch (defErr) {
    doWarn("set default payment method failed", defErr && defErr.message ? defErr.message : defErr);
  }
}

/**
 * @param {{ apiVersion?: string }} [options]
 */
export async function stripeGet(env, path, options = {}) {
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: stripeAuthHeaders(env, options.apiVersion),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Stripe invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg = data.error?.message || text || res.statusText;
    throw new Error(typeof msg === "string" ? msg : `Stripe ${res.status}`);
  }
  return data;
}
