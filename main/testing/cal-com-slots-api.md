# Cal.com Slots API — Fetch Available Time Slots (No API Key Required)

This document describes how to fetch available booking slots from Cal.com using a simple HTTP GET request. **No API key or authentication is required** for the slots endpoint.

## Quick Reference

**Endpoint:** `https://api.cal.com/v2/slots`

**Required header:** `cal-api-version: 2024-09-04`

**Required query params:** `start`, `end` (date range in `YYYY-MM-DD` format)

---

## Parsing a Cal.com URL

From a Cal.com link like:
```
https://cal.com/drew-peakleadsgroup/60-minute-meeting
```

Extract:
- **username** = `drew-peakleadsgroup` (first path segment)
- **eventTypeSlug** = `60-minute-meeting` (second path segment)

For org/team links, you may need `organizationSlug` and/or `teamSlug` — see [Cal.com API docs](https://cal.com/docs/api-reference/v2/slots/get-available-time-slots-for-an-event-type).

---

## Example Request

```
GET https://api.cal.com/v2/slots?username=drew-peakleadsgroup&eventTypeSlug=60-minute-meeting&start=2026-02-26&end=2026-03-15&timeZone=America/New_York&format=range
Headers:
  cal-api-version: 2024-09-04
```

### Query Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `username` | Yes* | Username from the Cal.com URL |
| `eventTypeSlug` | Yes* | Event type slug from the Cal.com URL |
| `start` | Yes | Start date (YYYY-MM-DD) |
| `end` | Yes | End date (YYYY-MM-DD) |
| `timeZone` | No | e.g. `America/New_York` (default: UTC) |
| `format` | No | `range` returns start/end objects; omit for start-time strings only |
| `duration` | No | Slot duration in minutes (for multi-duration event types) |

*Or use `eventTypeId` alone, or `organizationSlug` + `teamSlug` for team events.

---

## JavaScript Example

```javascript
async function getCalComSlots(username, eventTypeSlug, startDate, endDate, timeZone = 'America/New_York') {
  const params = new URLSearchParams({
    username,
    eventTypeSlug,
    start: startDate,
    end: endDate,
    timeZone,
    format: 'range'
  });
  
  const res = await fetch(`https://api.cal.com/v2/slots?${params}`, {
    headers: { 'cal-api-version': '2024-09-04' }
  });
  
  const json = await res.json();
  if (json.status !== 'success') throw new Error(json.error?.message || 'Failed to fetch slots');
  return json.data;
}

// Usage
const slots = await getCalComSlots('drew-peakleadsgroup', '60-minute-meeting', '2026-02-26', '2026-03-15');
// slots = { "2026-02-27": [{ start: "...", end: "..." }, ...], "2026-02-28": [...], ... }
```

---

## Response Format

With `format=range`, the response looks like:

```json
{
  "status": "success",
  "data": {
    "2026-02-27": [
      { "start": "2026-02-27T13:00:00.000-05:00", "end": "2026-02-27T14:00:00.000-05:00" },
      { "start": "2026-02-27T15:00:00.000-05:00", "end": "2026-02-27T16:00:00.000-05:00" }
    ],
    "2026-02-28": [ ... ]
  }
}
```

- Keys are dates (YYYY-MM-DD)
- Values are arrays of `{ start, end }` objects (ISO 8601 with timezone)
- Empty `data: {}` means no slots in the requested range

---

## Notes

1. **Date range:** Use the correct year. Past dates return empty slots.
2. **CORS:** The API allows browser requests; you can call it directly from frontend JavaScript.
3. **Rate limits:** Cal.com may apply rate limits; avoid excessive polling.
4. **Booking:** To actually book a slot, use Cal.com's booking flow or their booking API (which may require auth).

---

## Tested Example (PeakLeadsGroup)

**Cal.com link:** https://cal.com/drew-peakleadsgroup/60-minute-meeting

**Working request:**
```
GET https://api.cal.com/v2/slots?username=drew-peakleadsgroup&eventTypeSlug=60-minute-meeting&start=2026-02-26&end=2026-03-15&timeZone=America/New_York&format=range
Header: cal-api-version: 2024-09-04
```

Returns available 60-minute slots from Feb 27–Mar 15, 2026.
