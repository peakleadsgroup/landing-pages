/**
 * POST /api/ads-library/scrape
 * Body: { keyword: "wealth" }
 * Returns: { runId }
 *
 * Requires env: APIFY_API_TOKEN
 */
const ACTOR_ID = "curious_coder~facebook-ads-library-scraper";
const AD_COUNT = 20;

function adsLibraryStartDateMin() {
  const d = new Date();
  d.setDate(d.getDate() - 31);
  return d.toISOString().slice(0, 10);
}

function buildAdsLibraryUrl(keyword) {
  const trimmed = String(keyword || "").trim();
  const q = encodeURIComponent(trimmed);
  const startMin = adsLibraryStartDateMin();
  const params = [
    "active_status=active",
    "ad_type=all",
    "country=US",
    "is_targeted_country=false",
    "media_type=video",
    "q=" + q,
    "search_type=keyword_unordered",
    "sort_data[direction]=desc",
    "sort_data[mode]=total_impressions",
    "start_date[min]=" + startMin,
    "start_date[max]=",
  ];
  return "https://www.facebook.com/ads/library/?" + params.join("&");
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = context.env.APIFY_API_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing config: APIFY_API_TOKEN" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await context.request.json();
    const keyword = String(body.keyword || "").trim();
    if (!keyword) {
      return new Response(JSON.stringify({ error: "keyword is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const searchUrl = buildAdsLibraryUrl(keyword);
    const input = {
      count: AD_COUNT,
      limitPerSource: AD_COUNT,
      scrapeAdDetails: false,
      "scrapePageAds.activeStatus": "active",
      "scrapePageAds.countryCode": "US",
      "scrapePageAds.sortBy": "impressions_desc",
      urls: [{ url: searchUrl }],
    };

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${token}`,
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

    return new Response(
      JSON.stringify({ runId, keyword, searchUrl, adCount: AD_COUNT }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to start ads library scrape" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
