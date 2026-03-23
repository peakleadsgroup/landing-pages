/**
 * GET /api/notes - Fetch all notes from Airtable Sales VMs table
 * PUT /api/notes - Create or update notes for a phone number
 *
 * Requires env: AIRTABLE_BASE_ID, AIRTABLE_API_KEY
 * Airtable table "Sales VMs" with fields: Phone, Notes
 */
export async function onRequest(context) {
  const baseId = context.env.AIRTABLE_BASE_ID;
  const apiKey = context.env.AIRTABLE_API_KEY;

  if (!baseId || !apiKey) {
    return new Response(
      JSON.stringify({ error: "Airtable not configured (AIRTABLE_BASE_ID, AIRTABLE_API_KEY)" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const tableName = "Sales VMs";
  const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  function normalizePhone(p) {
    if (!p || typeof p !== "string") return "";
    const digits = p.replace(/\D/g, "");
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  if (context.request.method === "GET") {
    try {
      const notesByPhone = {};
      let offset = null;

      do {
        let url = baseUrl + "?pageSize=100";
        if (offset) url += "&offset=" + offset;

        const res = await fetch(url, { headers });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Airtable: ${res.status} - ${err}`);
        }
        const data = await res.json();
        for (const rec of data.records || []) {
          const phone = rec.fields?.Phone;
          const notes = rec.fields?.Notes || "";
          const key = normalizePhone(phone);
          if (key) {
            notesByPhone[key] = { notes, recordId: rec.id, rawPhone: phone };
          }
        }
        offset = data.offset;
      } while (offset);

      return new Response(JSON.stringify({ notesByPhone }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message || "Failed to fetch notes" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  if (context.request.method === "PUT") {
    try {
      const body = await context.request.json();
      const phone = body.phone;
      const notes = String(body.notes ?? "").trim();

      if (!phone) {
        return new Response(
          JSON.stringify({ error: "phone is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const key = normalizePhone(phone);
      if (!key) {
        return new Response(
          JSON.stringify({ error: "Invalid phone number" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      let recordId = null;
      let offset = null;
      do {
        let url = baseUrl + "?pageSize=100";
        if (offset) url += "&offset=" + offset;
        const listRes = await fetch(url, { headers });
        if (!listRes.ok) {
          const err = await listRes.text();
          throw new Error(`Airtable: ${listRes.status} - ${err}`);
        }
        const listData = await listRes.json();
        for (const rec of listData.records || []) {
          if (normalizePhone(rec.fields?.Phone) === key) {
            recordId = rec.id;
            break;
          }
        }
        offset = recordId ? null : listData.offset;
      } while (!recordId && offset);

      if (recordId) {
        const patchRes = await fetch(baseUrl + "/" + recordId, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ fields: { Notes: notes } }),
        });
        if (!patchRes.ok) {
          const err = await patchRes.text();
          throw new Error(`Airtable: ${patchRes.status} - ${err}`);
        }
      } else {
        const storePhone = phone.startsWith("+") ? phone : "+1" + key;
        const postRes = await fetch(baseUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ fields: { Phone: storePhone, Notes: notes } }),
        });
        if (!postRes.ok) {
          const err = await postRes.text();
          throw new Error(`Airtable: ${postRes.status} - ${err}`);
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message || "Failed to save notes" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}
