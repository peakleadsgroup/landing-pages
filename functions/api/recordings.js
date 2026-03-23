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

  try {
    const recordings = [];
    let listUrl = `${base}/Recordings.json?DateCreated>=${dateAfter}&DateCreated<=${dateBefore}&PageSize=100`;
    let items = [];

    // Paginate through all results (Twilio returns max 100 per page)
    do {
      const listRes = await fetch(listUrl.startsWith("http") ? listUrl : `https://api.twilio.com${listUrl}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!listRes.ok) {
        const err = await listRes.text();
        throw new Error(`Twilio API: ${listRes.status} - ${err}`);
      }
      const listData = await listRes.json();
      items = listData.recordings || [];
      listUrl = listData.next_page_uri || null;

      for (const rec of items) {
        // Include completed and processing (recent voicemails may still be processing)
        if (rec.status !== "completed" && rec.status !== "processing") continue;
        if (rec.status === "completed" && (!rec.duration || parseInt(rec.duration, 10) === 0))
          continue;

        let callFrom = null;
        let callTo = null;
        if (rec.call_sid) {
          try {
            const callRes = await fetch(`${base}/Calls/${rec.call_sid}.json`, {
              headers: { Authorization: `Basic ${auth}` },
            });
            if (callRes.ok) {
              const callData = await callRes.json();
              callFrom = callData.from;
              callTo = callData.to;
              if (toNumber && callTo !== toNumber) continue;
            }
          } catch (_) {}
        }

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

    recordings.sort((a, b) => (b.date_created || "").localeCompare(a.date_created || ""));

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
