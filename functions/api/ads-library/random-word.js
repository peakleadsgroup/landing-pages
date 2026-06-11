/**
 * GET /api/ads-library/random-word?count=3
 * Proxies https://api.api-ninjas.com/v2/randomword
 */
const API_NINJAS_KEY = "WiThVD69tkYe5NsR5NlTHj4zWyjvazECXOyHnQNI";
const API_NINJAS_URL = "https://api.api-ninjas.com/v2/randomword";

async function fetchOneRandomWord() {
  const res = await fetch(API_NINJAS_URL, {
    headers: { "X-Api-Key": API_NINJAS_KEY },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API Ninjas: ${res.status} - ${errText}`);
  }

  const data = await res.json();
  if (!Array.isArray(data) || !data.length) {
    throw new Error("No words returned from API Ninjas");
  }

  const word = String(data[0] || "").trim();
  if (!word) {
    throw new Error("Empty word returned from API Ninjas");
  }
  return word;
}

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
    const words = [];
    const seen = new Set();
    let attempts = 0;
    const maxAttempts = count * 4;

    while (words.length < count && attempts < maxAttempts) {
      attempts += 1;
      const batchSize = count - words.length;
      const batch = await Promise.all(
        Array.from({ length: batchSize }, function () {
          return fetchOneRandomWord();
        })
      );

      for (const word of batch) {
        const key = word.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          words.push(word);
          if (words.length >= count) break;
        }
      }
    }

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
