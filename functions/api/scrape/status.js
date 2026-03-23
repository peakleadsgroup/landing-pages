/**
 * GET /api/scrape/status?runId=xxx - Check Apify run status, fetch results when done, save to Airtable
 *
 * Returns: { status: "running"|"completed"|"failed", saved?: number, error?: string }
 */
export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = context.env.APIFY_API_TOKEN;
  const airtableBaseId = context.env.AIRTABLE_BASE_ID;
  const airtableApiKey = context.env.AIRTABLE_API_KEY;
  const scrapedTableId = "tblUUP3DFDn0RmEj0";

  if (!token || !airtableBaseId || !airtableApiKey) {
    return new Response(
      JSON.stringify({ error: "Missing configuration", status: "failed" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(context.request.url);
  const runId = url.searchParams.get("runId");
  const nicheParam = url.searchParams.get("niche") || "Bathrooms";
  // Map UI niche values to exact Airtable select option names
  const nicheToAirtable = {
    Bathrooms: "Bathroom Remodeling",
    Windows: "Windows",
    "Floor Coating": "Floor Coating",
    Roofing: "Roofing",
  };
  const niche = nicheToAirtable[nicheParam] || nicheParam;
  if (!runId) {
    return new Response(JSON.stringify({ error: "runId required", status: "failed" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const runRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
    );
    if (!runRes.ok) {
      const errText = await runRes.text();
      throw new Error(`Apify: ${runRes.status} - ${errText}`);
    }
    const runData = await runRes.json();
    const status = runData.data?.status;
    const defaultDatasetId = runData.data?.defaultDatasetId;

    if (status === "RUNNING" || status === "READY" || status === "STARTING") {
      return new Response(
        JSON.stringify({ status: "running" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (status !== "SUCCEEDED") {
      const msg =
        runData.data?.statusMessage ||
        (runData.data?.status ? `${runData.data.status} (check Apify console for details)` : "Run did not succeed");
      return new Response(
        JSON.stringify({
          status: "failed",
          error: msg,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (!defaultDatasetId) {
      return new Response(
        JSON.stringify({ status: "failed", error: "No dataset from run" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}&format=json&clean=true`
    );
    if (!itemsRes.ok) {
      const errText = await itemsRes.text();
      throw new Error(`Apify dataset: ${itemsRes.status} - ${errText}`);
    }
    const items = await itemsRes.json();

    const today = new Date().toISOString().slice(0, 10);
    const airtableUrl = `https://api.airtable.com/v0/${airtableBaseId}/${scrapedTableId}`;
    const headers = {
      Authorization: `Bearer ${airtableApiKey}`,
      "Content-Type": "application/json",
    };

    // Fetch existing phone numbers to avoid duplicates
    const existingPhones = new Set();
    let airtableOffset = null;
    do {
      let listUrl = airtableUrl + "?pageSize=100&fields[]=Phone";
      if (airtableOffset) listUrl += "&offset=" + airtableOffset;
      const listRes = await fetch(listUrl, { headers });
      if (!listRes.ok) break;
      const listData = await listRes.json();
      for (const rec of listData.records || []) {
        const p = rec.fields?.Phone;
        if (p) {
          const digits = String(p).replace(/\D/g, "");
          if (digits.length >= 10) existingPhones.add(digits.slice(-10));
        }
      }
      airtableOffset = listData.offset;
    } while (airtableOffset);

    function normalizePhoneDigits(p) {
      const digits = String(p || "").replace(/\D/g, "");
      return digits.length >= 10 ? digits.slice(-10) : "";
    }

    const records = [];
    const seen = new Set();

    for (const item of items) {
      const phone = item.phone || item.phoneUnformatted || "";
      const name = (item.title || "").trim();
      const zipVal = item.postalCode || item.postal_code || "";

      if (!name || !phone) continue;

      const phoneKey = normalizePhoneDigits(phone);
      if (!phoneKey) continue;
      if (existingPhones.has(phoneKey)) continue;

      const key = `${name}|${phoneKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      existingPhones.add(phoneKey); // Prevent duplicates within this batch

      const fields = {
        "Business Name": name,
        Phone: phone,
        Niche: niche,
        "Scrape Date": today,
      };
      const zipNum = zipVal ? parseInt(zipVal.replace(/\D/g, "").slice(0, 5), 10) : null;
      if (zipNum && !isNaN(zipNum)) fields.Zip = zipNum;
      records.push({ fields });
    }

    let saved = 0;
    const batchSize = 10;

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const createRes = await fetch(airtableUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ records: batch }),
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Airtable: ${createRes.status} - ${errText}`);
      }
      saved += batch.length;
    }

    return new Response(
      JSON.stringify({ status: "completed", saved }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        status: "failed",
        error: err.message || "Failed to process scrape",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
