# Airtable Category Sync

Syncs the **Category** field from the Airtable table **FSBS MN** to the **Category** field in **B2C leads**.

**Source:** FSBS MN (columns: Name, Phone, Category)  
**Target:** B2C leads  
**Matching:** Phone → Phone

## Setup

1. Create `.env` in this folder with:
   ```
   AIRTABLE_API_KEY=your_key_here
   FSBS_MN_TABLE_ID=tblXXXXXXXX
   ```
   Get the table ID from Airtable: open the FSBS MN table and check the URL (`airtable.com/.../tblXXXXX/...`). The `tblXXXXX` part is the table ID.

## Usage

```bash
cd fixingquality
npm run dry-run   # Preview changes without updating
npm run sync      # Sync Category values to B2C leads
```
