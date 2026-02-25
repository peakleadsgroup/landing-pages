/**
 * Configuration for Airtable FSBS MN → B2C leads Category sync
 * API key is loaded from .env (AIRTABLE_API_KEY) or from the value in main/bathrooms.html
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to load .env file if it exists
function loadEnv() {
  const envPath = join(__dirname, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\s*([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        process.env[key] = value;
      }
    }
  }
}

loadEnv();

// Airtable config - same base as main/bathrooms.html
const AIRTABLE_BASE_ID = 'appmBb0lzqRK9dI8v';
const B2C_LEADS_TABLE_ID = 'tblPt6Wc79hTBSmcD';

export const config = {
  airtable: {
    baseId: AIRTABLE_BASE_ID,
    apiKey: process.env.AIRTABLE_API_KEY || 'pato6OZtm7CrR83po.9400ea9366fb0dcec3f346273c8b427fb7804557897f19e99bcd8a886284b589',
    baseUrl: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`,
    metaUrl: `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE_ID}/tables`,
    b2cLeadsTableId: B2C_LEADS_TABLE_ID,
    // Source table: FSBS MN (Name, Phone, Category)
    fsbsMnTableName: 'FSBS MN',
    fsbsMnTableId: process.env.FSBS_MN_TABLE_ID || 'tbltY8pWyUw9VeyQ1',
  },
};
