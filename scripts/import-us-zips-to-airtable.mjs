/**
 * Import US ZIP codes + lat/long from InternalApps/us_zip_complete.json into Airtable.
 *
 * Table: US Zips (tblieaHIf6rDfFZFl)
 * Fields: Zip (number), Lat (number), Long (number) — JSON uses "lng", mapped to Long.
 *
 * Requires: Node 18+ (fetch)
 * Env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 *
 * Usage:
 *   $env:AIRTABLE_API_KEY="pat_..."; $env:AIRTABLE_BASE_ID="app..."
 *   node scripts/import-us-zips-to-airtable.mjs
 *   node scripts/import-us-zips-to-airtable.mjs --dry-run
 *   node scripts/import-us-zips-to-airtable.mjs --limit 30
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const TABLE_ID = "tblieaHIf6rDfFZFl";
const BATCH_SIZE = 10;
const DELAY_MS = 220; // stay under ~5 req/s per base

const __dirname = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(__dirname, "..", "InternalApps", "us_zip_complete.json");

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

async function main() {
  const { dryRun, limit } = parseArgs();
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!dryRun && (!apiKey || !baseId)) {
    console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID (or use --dry-run).");
    process.exit(1);
  }

  const raw = await readFile(JSON_PATH, "utf8");
  const data = JSON.parse(raw);

  const entries = Object.entries(data).map(([zipStr, v]) => ({
    zip: Number(zipStr),
    lat: v.lat,
    lng: v.lng,
  }));

  if (limit != null) entries.splice(limit);

  const records = entries.map((e) => ({
    fields: {
      Zip: e.zip,
      Lat: e.lat,
      Long: e.lng,
    },
  }));

  const batches = chunk(records, BATCH_SIZE);
  const url = `https://api.airtable.com/v0/${baseId}/${TABLE_ID}`;

  console.log(
    `${dryRun ? "[dry-run] " : ""}Prepared ${records.length} rows in ${batches.length} batch(es).`
  );

  if (dryRun) {
    console.log("Sample first record:", JSON.stringify(batches[0]?.[0], null, 2));
    return;
  }

  let done = 0;
  for (let i = 0; i < batches.length; i++) {
    const body = JSON.stringify({ records: batches[i] });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Batch ${i + 1}/${batches.length} failed: ${res.status} ${text}`);
      process.exit(1);
    }

    done += batches[i].length;
    if ((i + 1) % 50 === 0 || i === batches.length - 1) {
      console.log(`Progress: ${done}/${records.length} rows created`);
    }

    if (i < batches.length - 1) await sleep(DELAY_MS);
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
