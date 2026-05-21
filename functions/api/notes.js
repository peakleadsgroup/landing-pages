/**
 * GET /api/notes - Fetch notes from Airtable Sales VMs table (paginated)
 * PUT /api/notes - Create or update notes for a phone number
 *
 * GET pagination: pass ?offset= from prior response nextOffset (max 35 Airtable pages/request).
 *
 * Requires env: AIRTABLE_BASE_ID, AIRTABLE_API_KEY
 * Airtable table "Sales VMs" with fields: Phone, Notes
 */
const MAX_AIRTABLE_PAGES_PER_REQUEST = 35;

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
      const requestUrl = new URL(context.request.url);
      const startOffset = requestUrl.searchParams.get("offset") || null;
      const notesByPhone = {};
      let airtableOffset = startOffset;
      let pagesFetched = 0;
      let nextContinuation = null;

      while (pagesFetched < MAX_AIRTABLE_PAGES_PER_REQUEST) {
        pagesFetched += 1;
        let url = baseUrl + "?pageSize=100";
        if (airtableOffset) {
          url += "&offset=" + encodeURIComponent(airtableOffset);
        }

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

        if (!data.offset) {
          nextContinuation = null;
          break;
        }
        nextContinuation = data.offset;
        airtableOffset = data.offset;
      }

      return new Response(JSON.stringify({ notesByPhone, nextOffset: nextContinuation }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err.message || "Failed to fetch notes", notesByPhone: {}, nextOffset: null }),
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

      let recordId = body.recordId || null;
      if (!recordId) {
        const digits = key;
        const filterByFormula =
          `LEN(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Phone}," ",""),"-",""),"(",""),")",""))>=10` +
          `,RIGHT(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Phone}," ",""),"-",""),"(",""),")",""),10)="${digits}"`;
        let lookupUrl =
          baseUrl +
          "?pageSize=1&maxRecords=1&filterByFormula=" +
          encodeURIComponent(filterByFormula);
        const lookupRes = await fetch(lookupUrl, { headers });
        if (!lookupRes.ok) {
          const err = await lookupRes.text();
          throw new Error(`Airtable: ${lookupRes.status} - ${err}`);
        }
        const lookupData = await lookupRes.json();
        recordId = lookupData.records?.[0]?.id || null;
      }

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
