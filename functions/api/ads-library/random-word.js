/**
 * GET /api/ads-library/random-word?count=3
 * Proxies https://random-words-api.kushcreates.com/api
 */
export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(context.request.url);
  const count = Math.min(10, Math.max(1, parseInt(url.searchParams.get("count") || "1", 10) || 1));

  try {
    const res = await fetch(
      `https://random-words-api.kushcreates.com/api?language=en&words=${count}`
    );
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Random words API: ${res.status} - ${errText}`);
    }

    const items = await res.json();
    const words = (Array.isArray(items) ? items : [])
      .map((item) => String(item.word || "").trim())
      .filter(Boolean);

    if (!words.length) {
      throw new Error("No words returned from API");
    }

    return new Response(JSON.stringify({ words }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to fetch random words" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
