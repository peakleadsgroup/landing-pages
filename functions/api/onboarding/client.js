/**
 * POST /api/onboarding/client
 *
 * Live endpoint called after the agreement page payment succeeds.
 * Creates the Contacts rows (tblzbIWvSdazhesWf) and the Client row (tblH2nVfmGNG8pAjC)
 * for a B2B lead, with all the correct linked-record references.
 *
 * Requires env: AIRTABLE_API_KEY
 *
 * Body JSON:
 * {
 *   "recordId":    "recXXXXXXXXXXXXXXX",           // B2B lead record id
 *   "businessName":"Acme Bath Co",                  // → Client.Name (editable on the form)
 *   "website":     "https://acmebath.example",      // → Client.Website
 *   "tcpaContact": "billing@acmebath.example",      // → Client.TCPA Contact
 *   "contacts": [                                   // → one Contacts row per item, linked from Client
 *     {
 *       "name":          "Jane Doe",
 *       "email":         "jane@acmebath.example",
 *       "phone":         "+1 555 123 4567",
 *       "notifications": ["New Lead", "Billing"]
 *     }
 *   ]
 * }
 */
import {
  json,
  corsFor,
  airtableGetRecord,
  airtableCreateRecord,
  readNumber,
  F,
  B2B_LEADS_TABLE_ID,
} from "../stripe/stripe-lib.js";

const LOG_PREFIX = "[client]";

function logC() {
  console.log.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
}
function warnC() {
  console.warn.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
}
function errC() {
  console.error.apply(console, [LOG_PREFIX].concat(Array.prototype.slice.call(arguments)));
}

/** Truncate a string for safe logging (long values can blow up Cloudflare log lines). */
function trunc(s, n) {
  if (s == null) return "";
  const str = String(s);
  return str.length > (n || 120) ? str.slice(0, n || 120) + "...(" + str.length + " chars)" : str;
}

const CLIENT_TABLE_ID = "tblH2nVfmGNG8pAjC";
const CONTACTS_TABLE_ID = "tblzbIWvSdazhesWf";

const CLIENT_FIELDS = {
  NAME: "Name",
  WEBSITE: "Website",
  TCPA_CONTACT: "TCPA Contact",
  CHARGE_CADENCE: "Charge Cadence",
  BILLING_CONTACTS_LINK: "Billing Contacts",
  CUSTOMERS_LINK: "Customers",
};

const CONTACT_FIELDS = {
  NAME: "Name",
  EMAIL: "Email",
  PHONE: "Phone",
  NOTIFICATIONS: "Notifications",
};

const ALLOWED_NOTIFICATIONS = new Set(["New Lead", "Billing"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

function clean(str, max = 500) {
  if (str == null) return "";
  const s = String(str).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeWebsite(raw) {
  const v = clean(raw, 500);
  if (!v) return "";
  if (URL_RE.test(v)) return v;
  /* Allow input like "acmebath.example" — prefix https:// so the value passes Airtable URL validation. */
  return `https://${v.replace(/^\/+/, "")}`;
}

export async function onRequest(context) {
  const t0 = Date.now();
  const cors = corsFor(context.request);
  const method = context.request.method;

  logC("request received", {
    method,
    url: trunc(context.request.url, 200),
    origin: context.request.headers.get("Origin") || "(none)",
    contentType: context.request.headers.get("Content-Type") || "(none)",
  });

  if (method === "OPTIONS") {
    logC("preflight OPTIONS — 204");
    return new Response(null, { status: 204, headers: cors });
  }

  if (method !== "POST") {
    warnC("rejecting non-POST method:", method);
    return json({ error: "Method not allowed" }, 405, cors);
  }

  try {
    if (!context.env.AIRTABLE_API_KEY) {
      errC("AIRTABLE_API_KEY not configured");
      return json({ error: "AIRTABLE_API_KEY not configured" }, 503, cors);
    }

    let body;
    try {
      body = await context.request.json();
    } catch (parseErr) {
      warnC("invalid JSON body", parseErr && parseErr.message);
      return json({ error: "Invalid JSON body" }, 400, cors);
    }

    const recordId = clean(body.recordId, 50);
    if (!/^rec[a-zA-Z0-9]{14,}$/.test(recordId)) {
      warnC("invalid recordId:", trunc(recordId, 40));
      return json({ error: "Invalid recordId" }, 400, cors);
    }

    const businessName = clean(body.businessName, 250);
    const websiteRaw = clean(body.website, 500);
    const tcpaContact = clean(body.tcpaContact, 250);

    const rawContactCount = Array.isArray(body.contacts) ? body.contacts.length : 0;
    logC("payload parsed", {
      recordId,
      businessName: trunc(businessName, 80),
      website: trunc(websiteRaw, 80),
      tcpaContact: trunc(tcpaContact, 80),
      contactCount: rawContactCount,
    });

    if (!businessName) {
      warnC("validation failed: businessName empty");
      return json({ error: "Business name is required" }, 400, cors);
    }
    if (!websiteRaw) {
      warnC("validation failed: website empty");
      return json({ error: "Website is required" }, 400, cors);
    }
    if (!tcpaContact || !EMAIL_RE.test(tcpaContact)) {
      warnC("validation failed: tcpaContact invalid", trunc(tcpaContact, 80));
      return json({ error: "TCPA contact must be a valid email" }, 400, cors);
    }

    const website = normalizeWebsite(websiteRaw);
    if (website !== websiteRaw) {
      logC("website normalized:", trunc(websiteRaw, 80), "->", trunc(website, 80));
    }

    const rawContacts = Array.isArray(body.contacts) ? body.contacts : [];
    if (rawContacts.length === 0) {
      warnC("validation failed: no contacts provided");
      return json({ error: "At least one contact is required" }, 400, cors);
    }

    const contacts = [];
    for (let i = 0; i < rawContacts.length; i++) {
      const c = rawContacts[i] || {};
      const name = clean(c.name, 250);
      const email = clean(c.email, 250);
      const phone = clean(c.phone, 50);
      const rawNotifs = Array.isArray(c.notifications) ? c.notifications : [];
      const cleanedNotifs = rawNotifs.map((n) => clean(n, 50));
      const validNotifs = Array.from(
        new Set(cleanedNotifs.filter((n) => ALLOWED_NOTIFICATIONS.has(n)))
      );
      const droppedNotifs = cleanedNotifs.filter((n) => !ALLOWED_NOTIFICATIONS.has(n));
      if (droppedNotifs.length > 0) {
        warnC(`contact ${i + 1}: ignoring unknown notification options`, droppedNotifs);
      }

      if (!name) {
        warnC(`validation failed: contact ${i + 1} missing name`);
        return json({ error: `Contact ${i + 1}: name is required` }, 400, cors);
      }
      if (!email || !EMAIL_RE.test(email)) {
        warnC(`validation failed: contact ${i + 1} email invalid`, trunc(email, 60));
        return json({ error: `Contact ${i + 1}: email is required and must be valid` }, 400, cors);
      }
      contacts.push({ name, email, phone, notifications: validNotifs });
    }

    logC("validation OK; fetching B2B lead", recordId);
    let lead;
    try {
      lead = await airtableGetRecord(context.env, B2B_LEADS_TABLE_ID, recordId);
    } catch (leadErr) {
      errC("airtable lead fetch failed", recordId, leadErr && leadErr.message);
      throw leadErr;
    }
    const leadFields = lead.fields || {};

    const signerName = leadFields[F.SIGNER_NAME];
    const signedDate = leadFields[F.SIGNED_DATE];
    const isSigned =
      (signerName != null && String(signerName).trim() !== "") ||
      (signedDate != null && String(signedDate).trim() !== "");
    if (!isSigned) {
      warnC("lead not signed; rejecting", { recordId });
      return json({ error: "Lead is not signed yet" }, 400, cors);
    }

    const customerLinks = Array.isArray(leadFields[F.CUSTOMER_LINK]) ? leadFields[F.CUSTOMER_LINK] : [];
    const customerRecordId = customerLinks.length > 0 ? customerLinks[0] : null;
    const upfrontN = readNumber(leadFields[F.LEADS_SOLD_UPFRONT]);

    logC("lead resolved", {
      signed: true,
      customerRecordId: customerRecordId || "(none)",
      leadsSoldUpfront: upfrontN,
      businessNameOnLead: trunc(leadFields[F.BUSINESS_NAME], 80),
    });

    if (!customerRecordId) {
      warnC("no Customer link on lead — Client.Customers will not be set");
    }

    const createdContactIds = [];
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i];
      const fields = {
        [CONTACT_FIELDS.NAME]: c.name,
        [CONTACT_FIELDS.EMAIL]: c.email,
      };
      if (c.phone) fields[CONTACT_FIELDS.PHONE] = c.phone;
      if (c.notifications.length > 0) {
        fields[CONTACT_FIELDS.NOTIFICATIONS] = c.notifications;
      }
      logC(`creating contact ${i + 1}/${contacts.length}`, {
        name: trunc(c.name, 60),
        email: trunc(c.email, 60),
        hasPhone: !!c.phone,
        notifications: c.notifications,
      });
      let created;
      try {
        created = await airtableCreateRecord(
          context.env,
          CONTACTS_TABLE_ID,
          fields,
          { typecast: true }
        );
      } catch (contactErr) {
        errC(`contact ${i + 1} create failed`, contactErr && contactErr.message);
        throw contactErr;
      }
      if (!created || !created.id) {
        errC(`contact ${i + 1}: airtable returned no id`, created);
        throw new Error("Airtable did not return contact record id");
      }
      logC(`contact ${i + 1} created`, created.id);
      createdContactIds.push(created.id);
    }

    const clientFields = {
      [CLIENT_FIELDS.NAME]: businessName,
      [CLIENT_FIELDS.WEBSITE]: website,
      [CLIENT_FIELDS.TCPA_CONTACT]: tcpaContact,
      [CLIENT_FIELDS.BILLING_CONTACTS_LINK]: createdContactIds,
    };
    if (upfrontN != null) {
      clientFields[CLIENT_FIELDS.CHARGE_CADENCE] = upfrontN;
    }
    if (customerRecordId) {
      clientFields[CLIENT_FIELDS.CUSTOMERS_LINK] = [customerRecordId];
    }

    logC("creating Client row", {
      table: CLIENT_TABLE_ID,
      fieldsPreview: {
        Name: trunc(businessName, 60),
        Website: trunc(website, 60),
        "Charge Cadence": upfrontN,
        "Billing Contacts": createdContactIds,
        Customers: customerRecordId ? [customerRecordId] : "(none)",
      },
    });

    let createdClient;
    try {
      createdClient = await airtableCreateRecord(
        context.env,
        CLIENT_TABLE_ID,
        clientFields,
        { typecast: true }
      );
    } catch (clientErr) {
      errC("client row create failed", clientErr && clientErr.message);
      throw clientErr;
    }
    if (!createdClient || !createdClient.id) {
      errC("client row: airtable returned no id", createdClient);
      throw new Error("Airtable did not return client record id");
    }

    const ms = Date.now() - t0;
    logC("request complete", {
      clientRecordId: createdClient.id,
      contactRecordIds: createdContactIds,
      customerRecordId,
      elapsedMs: ms,
    });

    return json(
      {
        ok: true,
        clientRecordId: createdClient.id,
        contactRecordIds: createdContactIds,
        customerRecordId,
      },
      200,
      cors
    );
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Server error";
    errC("request failed", msg, e && e.stack ? trunc(e.stack, 1000) : "(no stack)");
    return json({ error: msg }, 500, cors);
  }
}
