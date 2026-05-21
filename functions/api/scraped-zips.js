/**
 * GET /api/scraped-zips
 * Unique 5-digit ZIPs from Scraped Businesses (tblUUP3DFDn0RmEj0).
 *
 * Pagination: Airtable is read in chunks within a single Worker invocation to stay
 * under Cloudflare's subrequest limit. Pass ?offset=<opaque> from the previous
 * response's nextOffset to continue. Response: { zips, nextOffset }
 */
const MAX_AIRTABLE_PAGES_PER_REQUEST = 35;

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const airtableBaseId = context.env.AIRTABLE_BASE_ID;
  const airtableApiKey = context.env.AIRTABLE_API_KEY;
  const scrapedTableId = "tblUUP3DFDn0RmEj0";

  if (!airtableBaseId || !airtableApiKey) {
    return new Response(
      JSON.stringify({ error: "Missing configuration", zips: [], nextOffset: null }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const requestUrl = new URL(context.request.url);
  const startOffset = requestUrl.searchParams.get("offset") || null;

  try {
    const zips = new Set();
    const baseUrl = `https://api.airtable.com/v0/${airtableBaseId}/${scrapedTableId}`;

    let airtableOffset = startOffset;
    let pagesFetched = 0;
    let nextContinuation = null;

    while (pagesFetched < MAX_AIRTABLE_PAGES_PER_REQUEST) {
      pagesFetched += 1;
      let url = baseUrl + "?pageSize=100&fields[]=Zip";
      if (airtableOffset) {
        url += "&offset=" + encodeURIComponent(airtableOffset);
      }

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

      if (!data.offset) {
        nextContinuation = null;
        break;
      }
      nextContinuation = data.offset;
      airtableOffset = data.offset;
    }

    return new Response(
      JSON.stringify({
        zips: [...zips].sort(),
        nextOffset: nextContinuation,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err.message || String(err),
        zips: [],
        nextOffset: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
