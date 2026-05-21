/**
 * GET /api/recordings?days=30
 * Fetches Twilio voicemail recordings. Requires env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 * Optional: TWILIO_VOICEMAIL_NUMBER to filter by destination
 */
export async function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const sid = context.env.TWILIO_ACCOUNT_SID;
  const token = context.env.TWILIO_AUTH_TOKEN;
  const toNumber = context.env.TWILIO_VOICEMAIL_NUMBER?.trim() || null;

  if (!sid || !token) {
    return new Response(
      JSON.stringify({ error: "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = new URL(context.request.url);
  let days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10), 1), 90);
  if (isNaN(days)) days = 30;

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const end = new Date(now);
  end.setDate(end.getDate() + 1); // Include full today (handles timezone edge cases)
  const dateAfter = start.toISOString().slice(0, 10);
  const dateBefore = end.toISOString().slice(0, 10);

  const auth = btoa(`${sid}:${token}`);
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const MAX_TWILIO_LIST_PAGES = 25;

  try {
    const twilioFetch = (pathOrUrl) =>
      fetch(pathOrUrl.startsWith("http") ? pathOrUrl : `https://api.twilio.com${pathOrUrl}`, {
        headers: { Authorization: `Basic ${auth}` },
      });

    // Prefetch calls in the date range (paginated) so we do not issue one subrequest per recording.
    const callsBySid = new Map();
    let callsUrl =
      `${base}/Calls.json?DateCreated>=${dateAfter}&DateCreated<=${dateBefore}&PageSize=100`;
    if (toNumber) {
      callsUrl += `&To=${encodeURIComponent(toNumber)}`;
    }
    let callPages = 0;
    do {
      callPages += 1;
      const callsRes = await twilioFetch(callsUrl);
      if (!callsRes.ok) {
        const err = await callsRes.text();
        throw new Error(`Twilio Calls API: ${callsRes.status} - ${err}`);
      }
      const callsData = await callsRes.json();
      for (const call of callsData.calls || []) {
        if (call?.sid) {
          callsBySid.set(call.sid, { from: call.from || null, to: call.to || null });
        }
      }
      callsUrl =
        callPages >= MAX_TWILIO_LIST_PAGES ? null : callsData.next_page_uri || null;
    } while (callsUrl);

    const recordings = [];
    let listUrl = `${base}/Recordings.json?DateCreated>=${dateAfter}&DateCreated<=${dateBefore}&PageSize=100`;

    // Paginate through all results (Twilio returns max 100 per page)
    let recordingPages = 0;
    do {
      recordingPages += 1;
      const listRes = await twilioFetch(listUrl);
      if (!listRes.ok) {
        const err = await listRes.text();
        throw new Error(`Twilio API: ${listRes.status} - ${err}`);
      }
      const listData = await listRes.json();
      const items = listData.recordings || [];
      listUrl =
        recordingPages >= MAX_TWILIO_LIST_PAGES ? null : listData.next_page_uri || null;

      for (const rec of items) {
        // Include completed and processing (recent voicemails may still be processing)
        if (rec.status !== "completed" && rec.status !== "processing") continue;
        if (rec.status === "completed" && (!rec.duration || parseInt(rec.duration, 10) === 0))
          continue;

        const callInfo = rec.call_sid ? callsBySid.get(rec.call_sid) : null;
        const callFrom = callInfo?.from ?? null;
        const callTo = callInfo?.to ?? null;
        if (toNumber && callTo && callTo !== toNumber) continue;

        recordings.push({
          sid: rec.sid,
          call_sid: rec.call_sid,
          duration: rec.duration != null ? parseInt(rec.duration, 10) : 0,
          date_created: rec.date_created,
          from: callFrom,
          to: callTo,
          source: rec.source,
          status: rec.status, // "completed" or "processing"
        });
      }
    } while (listUrl);

    recordings.sort((a, b) => {
      const ta = new Date(a.date_created || 0).getTime();
      const tb = new Date(b.date_created || 0).getTime();
      return tb - ta; // newest first
    });

    return new Response(JSON.stringify({ recordings }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to fetch recordings" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
