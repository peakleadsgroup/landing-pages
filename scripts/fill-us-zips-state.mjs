/**
 * Fills the "State" field on Airtable "US Zip Codes" (US Zips) from InternalApps/us_zip_state.json.
 *
 * Requires: Node 18+ (fetch). Env:
 *   AIRTABLE_API_KEY — personal access token with schema + data writes
 *   AIRTABLE_BASE_ID — optional, defaults to appmBb0lzqRK9dI8v
 *
 * Usage:
 *   node scripts/fill-us-zips-state.mjs           # dry-run: counts only
 *   node scripts/fill-us-zips-state.mjs --apply   # PATCH records (batches of 10)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const DEFAULT_BASE_ID = "appmBb0lzqRK9dI8v";
const US_ZIPS_TABLE_ID = "tblieaHIf6rDfFZFl";
const ZIP_FIELD = "Zip";
const STATE_FIELD = "State";

const BATCH_SIZE = 10;
const PAUSE_MS = 220;

function normalizeZipKey(raw) {
  if (raw == null || raw === "") return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits.length) return null;
  const five = digits.length >= 5 ? digits.slice(0, 5) : digits.padStart(5, "0");
  return five;
}

function loadZipToState() {
  const p = path.join(REPO_ROOT, "InternalApps", "us_zip_state.json");
  const text = fs.readFileSync(p, "utf8");
  return JSON.parse(text);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function airtableFetch(apiKey, baseId, relPath, init = {}) {
  const url = `https://api.airtable.com/v0/${baseId}/${relPath}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Airtable ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function listAllZipRecords(apiKey, baseId) {
  const records = [];
  let offset = null;
  do {
    let q = `pageSize=100&fields[]=${encodeURIComponent(ZIP_FIELD)}&fields[]=${encodeURIComponent(STATE_FIELD)}`;
    if (offset) q += `&offset=${encodeURIComponent(offset)}`;
    const data = await airtableFetch(apiKey, baseId, `${US_ZIPS_TABLE_ID}?${q}`);
    records.push(...(data.records || []));
    offset = data.offset || null;
    if (offset) await sleep(120);
  } while (offset);
  return records;
}

async function patchBatch(apiKey, baseId, recordsPayload, attempt = 0) {
  const body = JSON.stringify({ records: recordsPayload });
  try {
    return await airtableFetch(apiKey, baseId, US_ZIPS_TABLE_ID, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (e) {
    if (e.status === 429 && attempt < 8) {
      const wait = 1500 * (attempt + 1);
      console.warn(`429 rate limit — waiting ${wait}ms and retrying…`);
      await sleep(wait);
      return patchBatch(apiKey, baseId, recordsPayload, attempt + 1);
    }
    throw e;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID || DEFAULT_BASE_ID;

  if (!apiKey) {
    console.error("Set AIRTABLE_API_KEY (and optionally AIRTABLE_BASE_ID).");
    process.exit(1);
  }

  const zipToState = loadZipToState();
  console.log(`Loaded ${Object.keys(zipToState).length} zip→state mappings from us_zip_state.json`);

  console.log("Listing Airtable US Zip Codes…");
  const records = await listAllZipRecords(apiKey, baseId);
  console.log(`Found ${records.length} rows.`);

  let wouldSet = 0;
  let alreadyOk = 0;
  let missingMap = 0;
  const toPatch = [];

  for (const rec of records) {
    const zipVal = rec.fields?.[ZIP_FIELD];
    const key = normalizeZipKey(zipVal);
    if (!key) {
      console.warn(`Record ${rec.id}: empty/invalid ${ZIP_FIELD}:`, zipVal);
      continue;
    }
    const st = zipToState[key];
    if (st == null) {
      missingMap++;
      if (missingMap <= 15) console.warn(`No state in JSON for zip key ${key} (record ${rec.id})`);
      continue;
    }
    const current = rec.fields?.[STATE_FIELD];
    if (current === st) {
      alreadyOk++;
      continue;
    }
    wouldSet++;
    toPatch.push({ id: rec.id, fields: { [STATE_FIELD]: st } });
  }

  if (missingMap > 15) console.warn(`… and ${missingMap - 15} more zips missing from JSON`);

  console.log(
    JSON.stringify(
      { alreadyCorrect: alreadyOk, toWrite: wouldSet, missingFromJson: missingMap },
      null,
      2
    )
  );

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to write to Airtable.");
    return;
  }

  let written = 0;
  for (let i = 0; i < toPatch.length; i += BATCH_SIZE) {
    const chunk = toPatch.slice(i, i + BATCH_SIZE);
    await patchBatch(apiKey, baseId, chunk);
    written += chunk.length;
    console.log(`Updated ${written}/${toPatch.length}`);
    if (i + BATCH_SIZE < toPatch.length) await sleep(PAUSE_MS);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
