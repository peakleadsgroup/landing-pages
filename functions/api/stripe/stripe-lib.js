/**
 * Shared helpers for Stripe Checkout Pages Functions.
 */

export const AIRTABLE_BASE_ID = "appmBb0lzqRK9dI8v";
export const B2B_LEADS_TABLE_ID = "tbldNpwtCN9y5Pkiy";

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
    throw new Error(typeof data.error === "string" ? data.error : `Airtable ${res.status}`);
  }
  return data;
}

export async function airtableCreateRecord(env, tableId, fields) {
  const key = env.AIRTABLE_API_KEY;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableId)}`;
  const res = await fetch(url, {
    method: "POST",
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
    throw new Error(typeof data.error === "string" ? data.error : `Airtable ${res.status}`);
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
    throw new Error(typeof data.error === "string" ? data.error : `Airtable ${res.status}`);
  }
  return data;
}

/**
 * @param {Record<string, string>} params flat Stripe API params (nested keys use bracket notation)
 */
export async function stripePostForm(env, path, params) {
  const sk = env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error("STRIPE_SECRET_KEY not configured");
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }
  const res = await fetch(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sk}`,
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

export async function stripeGet(env, path) {
  const sk = env.STRIPE_SECRET_KEY;
  if (!sk) throw new Error("STRIPE_SECRET_KEY not configured");
  const res = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${sk}` },
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
