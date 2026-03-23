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

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const dateAfter = start.toISOString().slice(0, 10);
  const dateBefore = end.toISOString().slice(0, 10);

  const auth = btoa(`${sid}:${token}`);
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;

  try {
    const listRes = await fetch(
      `${base}/Recordings.json?DateCreated>=${dateAfter}&DateCreated<=${dateBefore}&Status=completed&PageSize=100`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Twilio API: ${listRes.status} - ${err}`);
    }

    const listData = await listRes.json();
    const recordings = [];
    const items = listData.recordings || [];

    for (const rec of items) {
      if (rec.status !== "completed" || !rec.duration || parseInt(rec.duration, 10) === 0)
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
        duration: parseInt(rec.duration, 10),
        date_created: rec.date_created,
        from: callFrom,
        to: callTo,
        source: rec.source,
      });
    }

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
