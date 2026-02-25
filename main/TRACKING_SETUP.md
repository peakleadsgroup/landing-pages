# Bathroom Funnel - Airtable Tracking Setup

This document describes the Airtable table and fields needed for the bathroom remodel landing page (`bathrooms-br.html`) tracking system. Use this to see which campaign/ad users are coming from and where they drop off in the funnel.

## URL Parameters (Campaign & Ad Tracking)

The page reads these URL parameters to attribute traffic:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `campaignID` | Campaign identifier (links to Airtable Campaigns) | `123456789` |
| `adATID` | Ad record ID (Airtable record ID for the ad) | `recXXXXXXXXXXXXXX` |
| `utm_source` | UTM source | `facebook` |
| `utm_medium` | UTM medium | `cpc` |
| `utm_campaign` | UTM campaign name | `bathroom_remodel_2026` |
| `utm_content` | UTM content (ad variation) | `ad_variant_a` |
| `utm_term` | UTM term (keywords) | `bathroom+remodel` |

**Example URL:**
```
https://yoursite.com/bathrooms-br.html?campaignID=123456&adATID=recXXX&utm_source=facebook&utm_medium=cpc&utm_campaign=br_feb2026
```

---

## Airtable Table: Funnel Tracking

Create a new table in your Airtable base to capture **each step completion** so you can analyze drop-off.

### Table Name
`Bathroom Funnel Tracking` (or `Funnel Step Events`)

### Fields

| Field Name | Field Type | Description |
|------------|------------|-------------|
| **Session ID** | Single line text | Unique session identifier (e.g. `br_1730000000_abc123`) |
| **Campaign ID** | Single line text | From URL param `campaignID` |
| **Ad ID** | Single line text | From URL param `adATID` |
| **UTM Source** | Single line text | From URL param `utm_source` |
| **UTM Medium** | Single line text | From URL param `utm_medium` |
| **UTM Campaign** | Single line text | From URL param `utm_campaign` |
| **UTM Content** | Single line text | From URL param `utm_content` |
| **UTM Term** | Single line text | From URL param `utm_term` |
| **Step Number** | Number | 0 = page view, 1–11 = funnel steps |
| **Step Name** | Single line text | Human-readable step (e.g. "Step 1 completed", "Form submitted (lead)") |
| **Timestamp** | Date (with time) | When the step was completed |
| **Form Data** | Long text | JSON snapshot of form data at this step (for debugging/analysis) |

### Step Numbers Reference

| Step | Step Name | Question/Action |
|------|-----------|-----------------|
| 0 | Page view / Session started | User landed on page |
| 1 | Step 1 completed | Homeowner (own/rent) |
| 2 | Step 2 completed | Type of home |
| 3 | Step 3 completed | Existing or new build |
| 4 | Step 4 completed | Project type |
| 5 | Step 5 completed | Goal (I want to…) |
| 6 | Step 6 completed | Material preferences |
| 7 | Step 7 completed | Timeline |
| 8 | Step 8 completed | Has estimate |
| 9 | Step 9 completed | Address |
| 10 | Step 10 completed | Name |
| 11 | Form submitted (lead) | Phone/email + submit |

---

## Enabling Tracking

1. Create the `Bathroom Funnel Tracking` table in Airtable with the fields above.
2. Copy the **Table ID** from the Airtable URL when viewing the table:
   - URL format: `https://airtable.com/appXXXXX/tblYYYYY/...`
   - The `tblYYYYY` part is your Table ID.
3. In `bathrooms-br.html`, update:
   ```javascript
   FUNNEL_TRACKING: 'tblYOUR_TABLE_ID_HERE'
   ```
4. Set `WRITE_TO_AIRTABLE = true` to start writing tracking events.

---

## Enabling Lead Submission

To write completed leads to Airtable (same as `bathrooms.html`):

1. Set `WRITE_LEADS_TO_AIRTABLE = true` in `bathrooms-br.html`.
2. Leads will be written to the existing `B2C_LEADS` table.
3. For full parity with `bathrooms.html`, you may want to add:
   - Zip-based client matching (`findClientByZipCode`)
   - Source Campaign linking
   - Ad linking
   - Calendar/phone redirect logic

---

## Analyzing Drop-Off

**Views to create in Airtable:**

1. **By Campaign** – Group by Campaign ID, count records per Step Number.
2. **Funnel Funnel** – Pivot: Step Number vs. count of Session IDs (unique).
3. **Drop-off Rate** – Formula: `(Step N count - Step N+1 count) / Step N count`.

**Example analysis:**
- 100 users completed Step 1
- 85 users completed Step 2 → 15% drop-off at Step 2
- 70 users completed Step 3 → 18% drop-off at Step 3
- etc.

---

## Logo & Partner Name

Logo and partner name are loaded from Airtable when `campaignID` is present:

1. Look up Campaign by `Campaign ID` field.
2. Get linked Client record.
3. Use Client fields:
   - `Logo Link` → logo image URL
   - `Name` → partner name in privacy text

Ensure your Campaigns table has a `Campaign ID` field and a linked `Client` record with `Logo Link` and `Name`.
