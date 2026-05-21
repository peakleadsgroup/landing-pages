/**
 * GET /api/scrape/status?runId=xxx&niche=Y&launchCalls=1
 * Check Apify run status, fetch results when done, save to Airtable, optionally launch Slybroadcast campaign
 *
 * Returns: { status: "running"|"completed"|"failed", saved?: number, error?: string, slybroadcast?: { sessionId, count } }
 */
const MAX_AIRTABLE_PAGES_PER_REQUEST = 35;

export async function onRequest(context) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (message, details = {}) =>
    console.log(`[api/scrape/status][${requestId}] ${message}`, details);
  const logError = (message, err, details = {}) =>
    console.error(`[api/scrape/status][${requestId}] ${message}`, {
      ...details,
      error: err?.message || String(err || ""),
      stack: err?.stack || null,
    });

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
  const slyUid = context.env.SLYBROADCAST_UID;
  const slyPassword = context.env.SLYBROADCAST_PASSWORD;
  const slyCallerId = context.env.SLYBROADCAST_CALLER_ID;
  const slyRecordAudio = context.env.SLYBROADCAST_RECORD_AUDIO || "DanielLocalPick-Bathrooms";
  const slyStatusSent = context.env.SLYBROADCAST_STATUS_SENT || "Sent";

  if (!token || !airtableBaseId || !airtableApiKey) {
    return new Response(
      JSON.stringify({ error: "Missing configuration", status: "failed" }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(context.request.url);
  const runId = url.searchParams.get("runId");
  const nicheParam = url.searchParams.get("niche") || "Bathrooms";
  const launchCallsParam = url.searchParams.get("launchCalls");
  const launchCalls = launchCallsParam == null ? true : launchCallsParam === "1";
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

  let stage = "init";
  try {
    log("request_received", { runId, nicheParam, niche, launchCalls });
    stage = "check_run_status";
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
    log("apify_run_status", { runId, status, defaultDatasetId });

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

    stage = "fetch_dataset_items";
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}&format=json&clean=true`
    );
    if (!itemsRes.ok) {
      const errText = await itemsRes.text();
      throw new Error(`Apify dataset: ${itemsRes.status} - ${errText}`);
    }
    const items = await itemsRes.json();
    log("apify_dataset_loaded", { runId, itemsCount: Array.isArray(items) ? items.length : 0 });

    const today = new Date().toISOString().slice(0, 10);
    const airtableUrl = `https://api.airtable.com/v0/${airtableBaseId}/${scrapedTableId}`;
    const headers = {
      Authorization: `Bearer ${airtableApiKey}`,
      "Content-Type": "application/json",
    };

    stage = "load_existing_airtable_phones";
    // Fetch existing phone numbers to avoid duplicates (capped to stay under CF subrequest limit)
    const existingPhones = new Set();
    let airtableOffset = null;
    let phoneScanPages = 0;
    let phoneScanTruncated = false;
    do {
      phoneScanPages += 1;
      let listUrl = airtableUrl + "?pageSize=100&fields[]=Phone";
      if (airtableOffset) listUrl += "&offset=" + airtableOffset;
      const listRes = await fetch(listUrl, { headers });
      if (!listRes.ok) {
        const errText = await listRes.text();
        log("airtable_existing_phone_scan_failed", { status: listRes.status, error: errText.slice(0, 300) });
        break;
      }
      const listData = await listRes.json();
      for (const rec of listData.records || []) {
        const p = rec.fields?.Phone;
        if (p) {
          const digits = String(p).replace(/\D/g, "");
          if (digits.length >= 10) existingPhones.add(digits.slice(-10));
        }
      }
      airtableOffset = listData.offset;
      if (airtableOffset && phoneScanPages >= MAX_AIRTABLE_PAGES_PER_REQUEST) {
        phoneScanTruncated = true;
        airtableOffset = null;
      }
    } while (airtableOffset);

    function normalizePhoneDigits(p) {
      const digits = String(p || "").replace(/\D/g, "");
      return digits.length >= 10 ? digits.slice(-10) : "";
    }

    const records = [];
    const seen = new Set();
    const warnings = [];
    if (phoneScanTruncated) {
      warnings.push(
        "Duplicate check used partial Airtable phone list (subrequest limit). In-run dedup still applies."
      );
    }

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
    log("prepared_records", { candidateCount: records.length });

    let saved = 0;
    const createdRecordIds = [];
    const batchSize = 10;

    stage = "save_records_to_airtable";
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const createRes = await fetch(airtableUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ records: batch }),
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        log("airtable_batch_create_failed_retrying_individual", {
          batchStart: i,
          batchSize: batch.length,
          status: createRes.status,
          error: errText.slice(0, 300),
        });
        // Retry each row individually so one bad record doesn't fail the whole run.
        for (const record of batch) {
          const singleRes = await fetch(airtableUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ records: [record] }),
          });
          if (!singleRes.ok) {
            const singleErr = await singleRes.text();
            warnings.push(`Skipped one Airtable row: ${singleRes.status}`);
            log("airtable_single_create_failed", {
              status: singleRes.status,
              error: singleErr.slice(0, 300),
              fields: record.fields,
            });
            continue;
          }
          const singleData = await singleRes.json();
          const rec = singleData.records?.[0];
          if (rec?.id) createdRecordIds.push(rec.id);
          saved += 1;
        }
        continue;
      }
      const createData = await createRes.json();
      for (const rec of createData.records || []) {
        if (rec.id) createdRecordIds.push(rec.id);
      }
      saved += batch.length;
    }
    log("airtable_save_complete", { saved, createdRecordIds: createdRecordIds.length, warnings: warnings.length });

    let slybroadcastResult = null;
    stage = "launch_slybroadcast";
    if (
      launchCalls &&
      saved > 0 &&
      slyUid &&
      slyPassword &&
      slyCallerId &&
      (slyRecordAudio || (context.env.SLYBROADCAST_AUDIO_URL && context.env.SLYBROADCAST_AUDIO_TYPE))
    ) {
      const phones = records
        .map((r) => {
          const p = r.fields?.Phone || "";
          const digits = String(p).replace(/\D/g, "");
          return digits.length >= 10 ? digits.slice(-10) : "";
        })
        .filter(Boolean);
      const phoneList = [...new Set(phones)].join(",");

      if (phoneList) {
        log("launching_slybroadcast", { uniquePhones: phoneList.split(",").filter(Boolean).length });
        const form = new URLSearchParams();
        form.set("c_uid", slyUid);
        form.set("c_password", slyPassword);
        form.set("c_callerID", slyCallerId.replace(/\D/g, "").slice(-10));
        form.set("c_phone", phoneList);
        form.set("c_date", "now");
        form.set("mobile_only", "1");
        if (slyRecordAudio) {
          form.set("c_record_audio", slyRecordAudio);
        } else {
          form.set("c_url", context.env.SLYBROADCAST_AUDIO_URL);
          form.set("c_audio", context.env.SLYBROADCAST_AUDIO_TYPE || "mp3");
        }

        try {
          const slyRes = await fetch("https://www.mobile-sphere.com/gateway/vmb.php", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
          });
          const slyText = await slyRes.text();
          const lines = slyText.trim().split("\n");
          // Slybroadcast may return "OK\n912345678\nNumber of Phone #s = 5000" or "OK session_id=83242792891 number of phone=63"
          let sessionId = lines.find((l) => /^\d+$/.test(l.trim()))?.trim();
          if (!sessionId) {
            const match = slyText.match(/session_id[=:\s]*(\d+)/i);
            if (match) sessionId = match[1];
          }
          if (sessionId && /OK/i.test(slyText)) {
            const count = phoneList.split(",").filter(Boolean).length;
            slybroadcastResult = { sessionId: sessionId.trim(), count };

            // Update Slybot Status in Airtable for records we just created and sent.
            // Use Airtable batch PATCH (up to 10 records/request) to reduce Cloudflare subrequests.
            const patchBatch = 10;
            stage = "update_airtable_sly_status";
            let statusUpdateWarning = null;
            try {
              for (let j = 0; j < createdRecordIds.length; j += patchBatch) {
                const ids = createdRecordIds.slice(j, j + patchBatch);
                const patchRes = await fetch(airtableUrl, {
                  method: "PATCH",
                  headers,
                  body: JSON.stringify({
                    records: ids.map((recId) => ({
                      id: recId,
                      fields: { "Slybot Status": slyStatusSent },
                    })),
                  }),
                });
                if (!patchRes.ok) {
                  const errText = await patchRes.text();
                  throw new Error(`Airtable status update: ${patchRes.status} - ${errText}`);
                }
              }
            } catch (statusErr) {
              // Calls are already launched; don't downgrade launch success if this follow-up step fails.
              statusUpdateWarning = statusErr.message || "Failed to update Slybot Status";
            }
            if (statusUpdateWarning) {
              slybroadcastResult.statusUpdateWarning = statusUpdateWarning;
            }
          } else {
            slybroadcastResult = { error: slyText.slice(0, 200) };
          }
        } catch (slyErr) {
          slybroadcastResult = { error: slyErr.message || "Slybroadcast request failed" };
          logError("slybroadcast_launch_failed", slyErr);
        }
      }
    }

    stage = "completed";
    const response = { status: "completed", saved };
    if (slybroadcastResult) response.slybroadcast = slybroadcastResult;
    if (warnings.length) response.warnings = warnings.slice(0, 20);
    log("request_completed", { saved, hasSly: Boolean(slybroadcastResult), warnings: warnings.length });

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logError("request_failed", err, { stage, runId });
    return new Response(
      JSON.stringify({
        status: "failed",
        stage,
        error: err.message || "Failed to process scrape",
      }),
      // Keep 200 so frontend can show structured job status without console "resource failed" noise.
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}
