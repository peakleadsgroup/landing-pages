/**
 * POST /api/scrape - Start Apify Google Maps scrape for a location
 * Body (new): { location: "Charlotte, NC" }
 * Body (legacy): { zip: "28201", niche: "Bathrooms" }
 * Returns: { runId } - poll GET /api/scrape/status?runId=X for completion
 *
 * Requires env: APIFY_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_API_KEY
 */
export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = context.env.APIFY_API_TOKEN;
  const airtableBaseId = context.env.AIRTABLE_BASE_ID;
  const airtableApiKey = context.env.AIRTABLE_API_KEY;

  if (!token || !airtableBaseId || !airtableApiKey) {
    return new Response(
      JSON.stringify({
        error: "Missing config: APIFY_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_API_KEY",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await context.request.json();
    const location = String(body.location || "").trim();
    const zip = String(body.zip || "").trim();
    const locationQuery = location || (zip ? `${zip}, USA` : "");

    if (!locationQuery) {
      return new Response(JSON.stringify({ error: "location is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Bathrooms-only flow
    const searchTerm = "bathroom remodeling";

    const input = {
      searchStringsArray: [searchTerm],
      locationQuery,
      maxCrawledPlacesPerSearch: 120,
    };

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }
    );

    if (!runRes.ok) {
      const errText = await runRes.text();
      throw new Error(`Apify: ${runRes.status} - ${errText}`);
    }

    const runData = await runRes.json();
    const runId = runData.data?.id;

    if (!runId) {
      throw new Error("No run ID from Apify");
    }

    return new Response(JSON.stringify({ runId }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to start scrape" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
