/**
 * Syncs Category from Airtable "FSBS MN" table to Airtable B2C leads.
 * Matches by: FSBS MN "Phone" → B2C leads "Phone"
 */
import { config } from './config.js';

const DRY_RUN = process.argv.includes('--dry-run');

function normalizePhone(phone) {
  if (phone == null || typeof phone !== 'string') return '';
  return String(phone).replace(/\D/g, '');
}

async function fetchTableIdByName(tableName) {
  const { metaUrl, apiKey } = config.airtable;
  const res = await fetch(metaUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Airtable Meta API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const table = data.tables?.find((t) => t.name === tableName);
  if (!table) throw new Error(`Table "${tableName}" not found in base`);
  return table.id;
}

async function fetchAllAirtableRecords(tableId) {
  const { baseUrl, apiKey } = config.airtable;
  const url = `${baseUrl}/${tableId}`;
  const records = [];
  let offset = null;

  do {
    const params = offset ? `?offset=${offset}` : '';
    const res = await fetch(`${url}${params}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`Airtable API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);

  return records;
}

async function updateAirtableRecord(recordId, fields) {
  const { baseUrl, apiKey, b2cLeadsTableId } = config.airtable;
  const res = await fetch(`${baseUrl}/${b2cLeadsTableId}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable update error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const { airtable } = config;

  // Resolve FSBS MN table ID
  let fsbsMnTableId = airtable.fsbsMnTableId;
  if (!fsbsMnTableId) {
    try {
      fsbsMnTableId = await fetchTableIdByName(airtable.fsbsMnTableName);
      console.log(`Found table "FSBS MN" (${fsbsMnTableId})`);
    } catch (err) {
      console.error(err.message);
      console.error('\nSet FSBS_MN_TABLE_ID in .env with the table ID from your Airtable URL (e.g. airtable.com/appXXX/tblYYY/...)');
      process.exit(1);
    }
  } else {
    console.log(`Using FSBS MN table (${fsbsMnTableId})`);
  }

  // Load source records from FSBS MN
  const fsbsRecords = await fetchAllAirtableRecords(fsbsMnTableId);
  const sourceByPhone = new Map();
  for (const r of fsbsRecords) {
    const phone = normalizePhone(r.fields?.Phone);
    const category = r.fields?.Category;
    if (phone && category != null && String(category).trim()) {
      sourceByPhone.set(phone, String(category).trim());
    }
  }

  console.log(`Loaded ${sourceByPhone.size} rows with Category from FSBS MN (Phone → Category)`);

  // Load B2C leads
  const b2cRecords = await fetchAllAirtableRecords(airtable.b2cLeadsTableId);
  const b2cByPhone = new Map();
  for (const r of b2cRecords) {
    const phone = normalizePhone(r.fields?.Phone);
    if (phone) b2cByPhone.set(phone, r);
  }

  console.log(`Loaded ${b2cRecords.length} Airtable B2C leads`);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const [phone, category] of sourceByPhone) {
    const record = b2cByPhone.get(phone);
    if (!record) {
      notFound++;
      continue;
    }
    const current = record.fields?.Category;
    if (current === category) {
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update ${record.id}: Category "${current}" → "${category}"`);
      updated++;
      continue;
    }
    try {
      await updateAirtableRecord(record.id, { Category: category });
      updated++;
      console.log(`Updated ${record.id}: Category → "${category}"`);
    } catch (err) {
      console.error(`Failed to update ${record.id}:`, err.message);
    }
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (unchanged): ${skipped}, No match in B2C leads: ${notFound}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
