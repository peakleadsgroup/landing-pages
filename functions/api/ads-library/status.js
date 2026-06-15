/**
 * GET /api/ads-library/status?runId=xxx&keyword=wealth
 * Poll Apify run; when done return normalized video ads for swipe file.
 *
 * Returns: { status: "running"|"completed"|"failed", ads?: [], meta?: {} }
 */
const AD_COUNT = 20;

function normalizeMediaUrl(url) {
  if (!url || typeof url !== "string") return null;
  var trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.indexOf("//") === 0) return "https:" + trimmed;
  return null;
}

function isVideoAd(item) {
  const snap = item?.snapshot || {};
  if (String(snap.display_format || "").toUpperCase() === "VIDEO") return true;
  const videos = snap.videos;
  if (!Array.isArray(videos)) return false;
  return videos.some(function (v) {
    return v && (v.video_sd_url || v.video_hd_url);
  });
}

function normalizeAd(item, keyword) {
  const snap = item.snapshot || {};
  const videos = Array.isArray(snap.videos) ? snap.videos : [];
  const v0 = videos[0] || {};
  const archiveId = item.ad_archive_id || item.adArchiveId || null;

  return {
    adArchiveId: archiveId,
    pageId: item.page_id || snap.page_id || null,
    pageName: snap.page_name || item.page_name || null,
    pageProfileUri: snap.page_profile_uri || null,
    pageProfilePictureUrl: normalizeMediaUrl(snap.page_profile_picture_url),
    pageCategories: snap.page_categories || [],
    pageLikeCount: snap.page_like_count ?? null,
    bodyText:
      (snap.body && typeof snap.body === "object" && snap.body.text) ||
      (typeof snap.body === "string" ? snap.body : null),
    caption: snap.caption || null,
    ctaText: snap.cta_text || null,
    ctaType: snap.cta_type || null,
    linkUrl: snap.link_url || null,
    displayFormat: snap.display_format || null,
    videoSdUrl: normalizeMediaUrl(v0.video_sd_url),
    videoHdUrl: normalizeMediaUrl(v0.video_hd_url),
    videoPreviewUrl: normalizeMediaUrl(v0.video_preview_image_url),
    adLibraryUrl:
      item.ad_library_url ||
      (archiveId ? "https://www.facebook.com/ads/library/?id=" + archiveId : null),
    isActive: item.is_active ?? null,
    currency: item.currency || null,
    spend: item.spend ?? null,
    reachEstimate: item.reach_estimate ?? null,
    impressionsWithIndex: item.impressions_with_index ?? null,
    startDate: item.start_date_formatted || null,
    endDate: item.end_date_formatted || null,
    publisherPlatforms: item.publisher_platform || item.publisher_platforms || [],
    collationCount: item.collation_count ?? null,
    entityType: item.entity_type || null,
    keyword: keyword || null,
  };
}

export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = context.env.APIFY_API_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing configuration", status: "failed" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(context.request.url);
  const runId = url.searchParams.get("runId");
  const keyword = url.searchParams.get("keyword") || "";

  if (!runId) {
    return new Response(JSON.stringify({ error: "runId required", status: "failed" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const runRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`);
    if (!runRes.ok) {
      const errText = await runRes.text();
      throw new Error(`Apify: ${runRes.status} - ${errText}`);
    }

    const runData = await runRes.json();
    const status = runData.data?.status;
    const defaultDatasetId = runData.data?.defaultDatasetId;

    if (status === "RUNNING" || status === "READY" || status === "STARTING") {
      return new Response(JSON.stringify({ status: "running" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (status !== "SUCCEEDED") {
      const msg =
        runData.data?.statusMessage ||
        (runData.data?.status
          ? `${runData.data.status} (check Apify console for details)`
          : "Run did not succeed");
      return new Response(JSON.stringify({ status: "failed", error: msg }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!defaultDatasetId) {
      return new Response(JSON.stringify({ status: "failed", error: "No dataset from run" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}&format=json&clean=true`
    );
    if (!itemsRes.ok) {
      const errText = await itemsRes.text();
      throw new Error(`Apify dataset: ${itemsRes.status} - ${errText}`);
    }

    const items = await itemsRes.json();
    const rawItems = Array.isArray(items) ? items : [];
    const videoItems = rawItems.filter(isVideoAd);
    const ads = videoItems.slice(0, AD_COUNT).map(function (item) {
      return normalizeAd(item, keyword);
    });

    return new Response(
      JSON.stringify({
        status: "completed",
        ads,
        meta: {
          keyword,
          rawCount: rawItems.length,
          videoCount: videoItems.length,
          returnedCount: ads.length,
          usageTotalUsd: runData.data?.usageTotalUsd ?? null,
        },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        status: "failed",
        error: err.message || "Failed to process ads library scrape",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
