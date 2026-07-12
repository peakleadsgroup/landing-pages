/**
 * Nationwide agreement prefill by Airtable record ID + source type.
 *
 * GET /api/stripe/nationwide-prefill?recordID=rec...&type=churned|closed|b2b
 * Also accepts: source= / table=
 *
 * Returns only fields needed to prefill the form (no secrets).
 * Requires env: AIRTABLE_API_KEY
 */
import {
  airtableGetRecord,
  B2B_LEADS_TABLE_ID,
  corsFor,
  json,
} from "./stripe-lib.js";

const CLIENTS_TABLE_ID = "tblMl8Y97cMSbricC"; // Clients (plural) — churned/active CRM
const CLIENT_TABLE_ID = "tblH2nVfmGNG8pAjC"; // Client (singular) — closed/legacy
const CONTACTS_TABLE_ID = "tblzbIWvSdazhesWf";
const ADSETS_TABLE_ID = "tblee61crNCoSfurx";

function clean(v, max = 500) {
  return String(v == null ? "" : v)
    .trim()
    .slice(0, max);
}

function looksLikeRec(id) {
  return /^rec[a-zA-Z0-9]{14,}$/.test(id || "");
}

function firstEmail(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      const nested = firstEmail(...v);
      if (nested) return nested;
      continue;
    }
    const s = String(v).trim();
    const m = s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (m) return m[0];
  }
  return "";
}

function firstPhone(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      const nested = firstPhone(...v);
      if (nested) return nested;
      continue;
    }
    const s = String(v).trim();
    if (!s) continue;
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 10) return s;
  }
  return "";
}

function padZip(z) {
  const d = String(z || "").replace(/\D/g, "");
  if (d.length >= 3 && d.length <= 5) return d.padStart(5, "0");
  return "";
}

function extractZips(text) {
  const out = [];
  const seen = new Set();
  const re = /\b(\d{3,5})\b/g;
  const s = String(text || "");
  let m;
  while ((m = re.exec(s))) {
    const p = padZip(m[1]);
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function parseMapDevelopersCircles(url) {
  try {
    if (!url || !String(url).includes("circles=")) return "";
    const m = String(url).match(/circles=([^&\s]+)/);
    if (!m) return "";
    const raw = decodeURIComponent(m[1]);
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.length) return "";
    const parts = [];
    for (const c of data.slice(0, 5)) {
      const meters = Number(c[0]);
      const lat = Number(c[1]);
      const lng = Number(c[2]);
      if (!Number.isFinite(meters) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const miles = Math.round(meters / 1609.34);
      parts.push(`${lat.toFixed(4)},${lng.toFixed(4)} - ${miles} miles`);
    }
    return parts.join("; ");
  } catch {
    return "";
  }
}

function compactServiceArea(sa, { source = "", radiusMiles = 50 } = {}) {
  const text = clean(sa, 8000);
  if (!text) return "";

  // Existing "ZIP - N miles" style
  if (/\d{3,5}\s*-\s*\d+\s*miles?/i.test(text) && text.length <= 700) {
    return text;
  }

  // Address + Radius form
  if (/Radius\s*#?\s*\d+/i.test(text) && text.length <= 700) {
    return text;
  }

  // Map tool URL with circles
  if (text.includes("mapdevelopers.com") || text.includes("circles=")) {
    const parsed = parseMapDevelopersCircles(text);
    if (parsed) return parsed;
  }

  const zips = extractZips(text);
  if (zips.length === 1) {
    return `${zips[0]} - ${radiusMiles} miles`;
  }
  if (zips.length > 1) {
    const keep = zips.slice(0, 60);
    let out = keep.join(" ");
    if (zips.length > 60) {
      out += ` (plus ${zips.length - 60} more zips on file — edit if needed)`;
    }
    if (out.length > 700) {
      const keep2 = zips.slice(0, 40);
      out =
        keep2.join(" ") +
        ` (plus ${Math.max(0, zips.length - 40)} more zips on file — edit if needed)`;
    }
    return out;
  }

  // B2B bare location zip often already handled; free text fallback
  if (text.length > 700) return text.slice(0, 680).replace(/\s+\S*$/, "") + "…";
  return text;
}

function normalizeType(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase();
  if (!t) return "";
  if (["churned", "clients", "clients_churned", "clientschurned"].includes(t)) return "churned";
  if (["closed", "client", "client_closed", "clientclosed"].includes(t)) return "closed";
  if (["b2b", "b2b_leads", "b2bleads", "lead"].includes(t)) return "b2b";
  return t;
}

async function loadContact(env, contactId) {
  if (!looksLikeRec(contactId)) return null;
  try {
    const rec = await airtableGetRecord(env, CONTACTS_TABLE_ID, contactId);
    const f = rec.fields || {};
    return {
      name: clean(f.Name || f["Full Name"] || "", 250),
      email: firstEmail(f.Email, f["Email Address"]),
      phone: firstPhone(f.Phone, f.Mobile, f["Phone Number"]),
    };
  } catch {
    return null;
  }
}

async function serviceAreaFromClientAdsets(env, adsetIds) {
  const ids = (adsetIds || []).filter(looksLikeRec).slice(0, 8);
  const zips = new Set();
  const blobs = [];
  const errors = [];
  for (const aid of ids) {
    try {
      const rec = await airtableGetRecord(env, ADSETS_TABLE_ID, aid);
      const f = rec.fields || {};
      const blob = [
        f["Comma Separated Zips"],
        f["Service Area"],
        f["Exact Raw Zips"],
        f.Zips,
        f.ZIP,
      ]
        .map((x) => String(x || ""))
        .join(" ");
      blobs.push(blob);
      for (const z of extractZips(blob)) zips.add(z);
      if (!blob.trim()) errors.push(`adset ${aid}: no zip fields`);
    } catch (e) {
      errors.push(`adset ${aid}: ${(e && e.message) || "fetch failed"}`);
    }
  }
  if (zips.size) {
    return { serviceArea: Array.from(zips).sort().join(" "), errors };
  }
  const joined = blobs.join(" ").trim();
  return { serviceArea: joined, errors };
}

async function prefillChurned(env, recordId) {
  const rec = await airtableGetRecord(env, CLIENTS_TABLE_ID, recordId);
  const f = rec.fields || {};
  const contactIds = []
    .concat(f.Contacts || [])
    .concat(f["Billing Contacts"] || [])
    .filter(looksLikeRec);

  let contactName = "";
  let email = firstEmail(f["TCPA Contact"], f.Email, f.Website);
  let phone = firstPhone(f.Phone, f.Mobile);
  for (const cid of contactIds.slice(0, 3)) {
    const c = await loadContact(env, cid);
    if (!c) continue;
    if (!contactName && c.name) contactName = c.name;
    if (!email && c.email) email = c.email;
    if (!phone && c.phone) phone = c.phone;
    if (contactName && email && phone) break;
  }

  let serviceArea = clean(f["Service Area"] || "", 4000);
  if (!extractZips(serviceArea)) {
    const map = clean(f["Service Area Map"] || "", 4000);
    const parsedMap = parseMapDevelopersCircles(map);
    if (parsedMap) serviceArea = parsedMap;
    else if (f["Exact Raw Zips"]) serviceArea = clean(f["Exact Raw Zips"], 4000);
    else if (f["Expanded Area Raw Zips"]) serviceArea = clean(f["Expanded Area Raw Zips"], 4000);
  }

  return {
    source: "churned",
    businessName: clean(f.Name || "", 250),
    contactName,
    email,
    phone,
    website: clean(f.Website || "", 500),
    serviceArea: compactServiceArea(serviceArea, { source: "churned" }),
  };
}

async function prefillClosed(env, recordId) {
  const rec = await airtableGetRecord(env, CLIENT_TABLE_ID, recordId);
  const f = rec.fields || {};
  const contactIds = []
    .concat(f.Contacts || [])
    .concat(f["Billing Contacts"] || [])
    .filter(looksLikeRec);

  let contactName = "";
  let email = firstEmail(f["TCPA Contact"], f.Email);
  let phone = firstPhone(f.Phone, f.Mobile);
  for (const cid of contactIds.slice(0, 3)) {
    const c = await loadContact(env, cid);
    if (!c) continue;
    if (!contactName && c.name) contactName = c.name;
    if (!email && c.email) email = c.email;
    if (!phone && c.phone) phone = c.phone;
    if (contactName && email && phone) break;
  }

  let serviceArea = clean(f["Service Area"] || "", 4000);
  let warnings = [];
  if (!extractZips(serviceArea)) {
    const fromAdsets = await serviceAreaFromClientAdsets(env, f.Adsets || []);
    if (fromAdsets.serviceArea) serviceArea = fromAdsets.serviceArea;
    if (fromAdsets.errors && fromAdsets.errors.length) warnings = fromAdsets.errors;
    if (!serviceArea && !(f.Adsets || []).length) warnings.push("no linked adsets");
  }

  return {
    source: "closed",
    businessName: clean(f.Name || "", 250),
    contactName,
    email,
    phone,
    website: clean(f.Website || "", 500),
    serviceArea: compactServiceArea(serviceArea, { source: "closed" }),
    warnings,
  };
}

async function prefillB2b(env, recordId) {
  const rec = await airtableGetRecord(env, B2B_LEADS_TABLE_ID, recordId);
  const f = rec.fields || {};
  const loc = clean(f.Location || f.Zip || f.ZIP || f["Zip Code"] || "", 50);
  let serviceArea = clean(f["Service Area"] || "", 1000);
  if (!serviceArea) {
    const zip = padZip(loc) || (extractZips(loc)[0] || "");
    if (zip) serviceArea = `${zip} - 50 miles`;
    else {
      // Notes sometimes hold "Zip Code: 15644"
      const notes = clean(f.Notes || "", 4000);
      const z = extractZips(notes)[0];
      if (z) serviceArea = `${z} - 50 miles`;
    }
  } else {
    serviceArea = compactServiceArea(serviceArea, { source: "b2b", radiusMiles: 50 });
  }

  return {
    source: "b2b",
    businessName: clean(f["Business Name"] || f.Name || f.Company || "", 250),
    contactName: clean(f["Contact Name"] || f.Contact || "", 250),
    email: firstEmail(f["Contact Email"], f.Email, f["Email Address"]),
    phone: firstPhone(f["Parsed Phone"], f["Phone Number"], f.Phone, f.Mobile),
    website: clean(f.Website || "", 500),
    serviceArea,
  };
}

export async function onRequest(context) {
  const cors = {
    ...corsFor(context.request),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (context.request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, cors);
  }
  if (!context.env.AIRTABLE_API_KEY) {
    return json({ error: "AIRTABLE_API_KEY not configured" }, 503, cors);
  }

  const url = new URL(context.request.url);
  const recordId = clean(
    url.searchParams.get("recordID") ||
      url.searchParams.get("recordId") ||
      url.searchParams.get("id") ||
      "",
    40
  );
  const type = normalizeType(
    url.searchParams.get("type") ||
      url.searchParams.get("source") ||
      url.searchParams.get("table") ||
      ""
  );

  if (!looksLikeRec(recordId)) {
    return json({ error: "Valid recordID is required" }, 400, cors);
  }
  if (!["churned", "closed", "b2b"].includes(type)) {
    return json(
      { error: "type is required (churned | closed | b2b)" },
      400,
      cors
    );
  }

  try {
    let data;
    if (type === "churned") data = await prefillChurned(context.env, recordId);
    else if (type === "closed") data = await prefillClosed(context.env, recordId);
    else data = await prefillB2b(context.env, recordId);

    return json(
      {
        ok: true,
        recordId,
        ...data,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = (e && e.message) || "Prefill failed";
    const status = /NOT_FOUND|404|Could not find/i.test(msg) ? 404 : 500;
    return json({ error: msg }, status, cors);
  }
}
