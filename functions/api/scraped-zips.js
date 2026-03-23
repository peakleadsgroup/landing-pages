/**
 * GET /api/scraped-zips - Returns unique zip codes from Scraped Businesses table
 * Used by Client Zip Code Map to show where scraping has already been done
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
  const scrapedTableId = context.env.AIRTABLE_SCRAPED_BUSINESSES_TABLE_ID;

  if (!airtableBaseId || !airtableApiKey || !scrapedTableId) {
    return new Response(
      JSON.stringify({ error: "Missing configuration", zips: [] }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const zips = new Set();
    let offset = null;
    const baseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${scrapedTableId}`;

    do {
      let url = baseUrl + "?pageSize=100&fields[]=Zip";
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
        const z = rec.fields?.Zip;
        if (z != null && z !== "") {
          const zipStr = String(z).replace(/\D/g, "").slice(0, 5);
          if (zipStr.length === 5) zips.add(zipStr);
        }
      }
      offset = data.offset;
    } while (offset);

    return new Response(
      JSON.stringify({ zips: [...zips].sort() }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message, zips: [] }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
