/**
 * Set "State" on each row in Airtable US Zips from InternalApps/us_zip_state.json.
 *
 * Table: US Zips (tblieaHIf6rDfFZFl)
 * Zip in Airtable is a number; JSON keys are 5-digit strings (e.g. "02108").
 *
 * Env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 *
 * Usage:
 *   node scripts/update-us-zips-state.mjs
 *   node scripts/update-us-zips-state.mjs --dry-run
 *   node scripts/update-us-zips-state.mjs --limit 20
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const TABLE_ID = "tblieaHIf6rDfFZFl";
const BATCH_SIZE = 10;
const DELAY_MS = 220;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ZIP_STATE_PATH = join(__dirname, "..", "InternalApps", "us_zip_state.json");

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let limit = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
      if (Number.isNaN(limit) || limit < 1) {
        console.error("Invalid --limit");
        process.exit(1);
      }
    }
  }
  return { dryRun, limit };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Airtable Zip is a number; JSON uses 5-digit string keys. */
function stateForZip(zipValue, zipToState) {
  if (zipValue == null || zipValue === "") return undefined;
  const n = Number(zipValue);
  if (Number.isNaN(n)) return undefined;
  const key5 = String(Math.trunc(n)).padStart(5, "0");
  return zipToState[key5];
}

async function fetchAllRecords(apiKey, baseId) {
  const rows = [];
  let offset = null;
  const base = `https://api.airtable.com/v0/${baseId}/${TABLE_ID}`;
  do {
    let url = `${base}?pageSize=100&fields[]=Zip`;
    if (offset) url += `&offset=${encodeURIComponent(offset)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`List failed ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    for (const rec of data.records || []) {
      rows.push({ id: rec.id, zip: rec.fields?.Zip });
    }
    offset = data.offset || null;
    if (offset) await sleep(110);
  } while (offset);
  return rows;
}

async function main() {
  const { dryRun, limit } = parseArgs();
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!dryRun && (!apiKey || !baseId)) {
    console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID (or use --dry-run).");
    process.exit(1);
  }

  const raw = await readFile(ZIP_STATE_PATH, "utf8");
  const zipToState = JSON.parse(raw);

  let rows = dryRun ? [] : await fetchAllRecords(apiKey, baseId);
  if (dryRun) {
    // Minimal sample for dry-run without API
    rows = [
      { id: "recDRYRUN1", zip: 10001 },
      { id: "recDRYRUN2", zip: 2108 },
    ];
  }
  if (limit != null) rows = rows.slice(0, limit);

  const updates = [];
  let missing = 0;
  for (const row of rows) {
    const st = stateForZip(row.zip, zipToState);
    if (!st) {
      missing++;
      if (!dryRun) console.warn(`No state for Zip=${row.zip} record ${row.id}`);
      continue;
    }
    updates.push({ id: row.id, fields: { State: st } });
  }

  if (missing && dryRun) console.warn(`(dry-run sample only)`);

  console.log(
    `${dryRun ? "[dry-run] " : ""}Will PATCH ${updates.length} record(s)${
      missing && !dryRun ? `; ${missing} skipped (no mapping)` : ""
    }.`
  );

  if (dryRun && updates.length) {
    console.log("Sample:", JSON.stringify(updates[0], null, 2));
    return;
  }

  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ID}`;
  const batches = chunk(updates, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: batches[i] }),
    });
    if (!res.ok) {
      console.error(`Batch ${i + 1}/${batches.length} failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const done = (i + 1) * BATCH_SIZE;
    const total = updates.length;
    if (done >= total || (i + 1) % 50 === 0) {
      console.log(`Progress: ${Math.min(done, total)}/${total} rows updated`);
    }
    if (i < batches.length - 1) await sleep(DELAY_MS);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
