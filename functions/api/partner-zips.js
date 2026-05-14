/**
 * GET /api/partner-zips
 * Unique 5-digit ZIPs from the partner / territory table where "# of Partners" > 0.
 * Table: tblieaHIf6rDfFZFl (same base as other Airtable workers).
 */
export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const airtableBaseId = context.env.AIRTABLE_BASE_ID;
  const airtableApiKey = context.env.AIRTABLE_API_KEY;
  const partnerTableId = "tblieaHIf6rDfFZFl";
  /** Must match Airtable field name exactly */
  const zipField = "Zip";
  const partnersCountField = "# of Partners";

  if (!airtableBaseId || !airtableApiKey) {
    return new Response(
      JSON.stringify({ error: "Missing configuration", zips: [] }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const filterByFormula = `AND(NOT(BLANK({${zipField}})),{${partnersCountField}}>0)`;

  try {
    const zips = new Set();
    let offset = null;
    const baseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${partnerTableId}`;

    do {
      let url =
        baseUrl +
        "?pageSize=100" +
        "&filterByFormula=" +
        encodeURIComponent(filterByFormula) +
        "&fields[]=" +
        encodeURIComponent(zipField);
      if (offset) url += "&offset=" + offset;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${airtableApiKey}` },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Airtable: ${res.status} - ${errText}`);
      }
      const data = await res.json();
      for (const rec of data.records || []) {
        const z = rec.fields?.[zipField];
        if (z != null && z !== "") {
          const zipStr = String(z).replace(/\D/g, "").slice(0, 5);
          if (zipStr.length === 5) zips.add(zipStr);
        }
      }
      offset = data.offset;
    } while (offset);

    return new Response(JSON.stringify({ zips: [...zips].sort() }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || String(err), zips: [] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
