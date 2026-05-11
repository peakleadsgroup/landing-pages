#!/usr/bin/env python3
"""
Populate Airtable ZIP radius links for a 5-mile neighborhood.

Creates one record in the ZIP radius table for each US ZIP record, and links
all other ZIPs within the target radius (self is excluded).

Required env vars:
  AIRTABLE_PAT=pat...

Optional env vars:
  AIRTABLE_BASE_ID=appmBb0lzqRK9dI8v
  SOURCE_TABLE_ID=tblieaHIf6rDfFZFl
  TARGET_TABLE_ID=tblemzOrE1ZTdNzVl
  SOURCE_ZIP_FIELD=Zip
  SOURCE_LAT_FIELD=Lat
  SOURCE_LNG_FIELD=Long
  TARGET_ZIP_FIELD=Zip
  TARGET_LINK_FIELD=Zips in 5 Mile Radius
  SOURCE_BACKLINK_FIELD=Zip Radius
  RADIUS_MILES=20
  DRY_RUN=0
  AUTO_CONFIRM=0
"""

from __future__ import annotations

import math
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional

import requests


API_ROOT = "https://api.airtable.com/v0"
BATCH_SIZE = 10  # Airtable max records per create/update call.
SEARCH_CELL_RANGE = 2  # Extra neighboring cells to avoid boundary misses.


@dataclass
class Config:
    pat: str
    base_id: str
    source_table_id: str
    target_table_id: str
    source_zip_field: str
    source_lat_field: str
    source_lng_field: str
    target_zip_field: str
    target_link_field: str
    source_backlink_field: str
    radius_miles: float
    dry_run: bool
    auto_confirm: bool


class AirtableClient:
    def __init__(self, pat: str, base_id: str) -> None:
        self.base_id = base_id
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {pat}",
                "Content-Type": "application/json",
            }
        )

    def _url(self, table_id: str) -> str:
        return f"{API_ROOT}/{self.base_id}/{table_id}"

    def _request(self, method: str, url: str, **kwargs):
        max_attempts = 6
        for attempt in range(1, max_attempts + 1):
            res = self.session.request(method, url, timeout=60, **kwargs)
            if res.status_code in (429, 500, 502, 503, 504):
                sleep_s = min(2**attempt, 30)
                print(
                    f"Retryable response {res.status_code}; "
                    f"attempt {attempt}/{max_attempts}, sleeping {sleep_s}s..."
                )
                time.sleep(sleep_s)
                continue
            if not res.ok:
                raise RuntimeError(f"Airtable API error {res.status_code}: {res.text}")
            return res
        raise RuntimeError(f"Failed after {max_attempts} attempts: {method} {url}")

    def list_records(self, table_id: str, fields: Optional[List[str]] = None) -> List[dict]:
        all_records: List[dict] = []
        offset = None
        while True:
            params = {}
            if offset:
                params["offset"] = offset
            if fields:
                params["fields[]"] = fields
            res = self._request("GET", self._url(table_id), params=params)
            payload = res.json()
            all_records.extend(payload.get("records", []))
            offset = payload.get("offset")
            if not offset:
                break
        return all_records

    def create_records(self, table_id: str, records: List[dict]) -> List[dict]:
        out: List[dict] = []
        for i in range(0, len(records), BATCH_SIZE):
            chunk = records[i : i + BATCH_SIZE]
            payload = {"records": [{"fields": f} for f in chunk]}
            res = self._request("POST", self._url(table_id), json=payload)
            out.extend(res.json().get("records", []))
        return out

    def update_records(self, table_id: str, records: List[dict]) -> None:
        for i in range(0, len(records), BATCH_SIZE):
            chunk = records[i : i + BATCH_SIZE]
            payload = {"records": chunk}
            self._request("PATCH", self._url(table_id), json=payload)


def get_config() -> Config:
    pat = os.getenv("AIRTABLE_PAT", "").strip()
    if not pat:
        raise RuntimeError("Missing AIRTABLE_PAT environment variable.")

    return Config(
        pat=pat,
        base_id=os.getenv("AIRTABLE_BASE_ID", "appmBb0lzqRK9dI8v").strip(),
        source_table_id=os.getenv("SOURCE_TABLE_ID", "tblieaHIf6rDfFZFl").strip(),
        target_table_id=os.getenv("TARGET_TABLE_ID", "tblemzOrE1ZTdNzVl").strip(),
        source_zip_field=os.getenv("SOURCE_ZIP_FIELD", "Zip").strip(),
        source_lat_field=os.getenv("SOURCE_LAT_FIELD", "Lat").strip(),
        source_lng_field=os.getenv("SOURCE_LNG_FIELD", "Long").strip(),
        target_zip_field=os.getenv("TARGET_ZIP_FIELD", "Zip").strip(),
        target_link_field=os.getenv("TARGET_LINK_FIELD", "Zips in 5 Mile Radius").strip(),
        source_backlink_field=os.getenv("SOURCE_BACKLINK_FIELD", "Zip Radius").strip(),
        radius_miles=float(os.getenv("RADIUS_MILES", "20").strip()),
        dry_run=os.getenv("DRY_RUN", "0").strip().lower() in {"1", "true", "yes"},
        auto_confirm=os.getenv("AUTO_CONFIRM", "0").strip().lower() in {"1", "true", "yes"},
    )


def normalize_zip(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return f"{int(value):05d}"
    text = str(value).strip()
    if not text:
        return None
    if "." in text:
        text = text.split(".", 1)[0]
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return None
    return digits.zfill(5)


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 3958.7613  # Earth radius in miles.
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def lat_bucket(lat: float, lon: float, cell_deg: float) -> tuple[int, int]:
    return (math.floor(lat / cell_deg), math.floor(lon / cell_deg))


def chunked(values: Iterable, size: int) -> Iterable[list]:
    bucket = []
    for value in values:
        bucket.append(value)
        if len(bucket) >= size:
            yield bucket
            bucket = []
    if bucket:
        yield bucket


def main() -> int:
    cfg = get_config()
    client = AirtableClient(cfg.pat, cfg.base_id)

    print("Fetching US ZIP records...")
    source_records = client.list_records(
        cfg.source_table_id,
        fields=[
            cfg.source_zip_field,
            cfg.source_lat_field,
            cfg.source_lng_field,
        ],
    )
    if not source_records:
        raise RuntimeError("No source records found in US Zips table.")
    print(f"Loaded {len(source_records)} source ZIP records.")

    zips = []
    for rec in source_records:
        fields = rec.get("fields", {})
        z = normalize_zip(fields.get(cfg.source_zip_field))
        lat = fields.get(cfg.source_lat_field)
        lng = fields.get(cfg.source_lng_field)
        if z is None or lat is None or lng is None:
            continue
        zips.append(
            {
                "record_id": rec["id"],
                "zip": z,
                "lat": float(lat),
                "lng": float(lng),
            }
        )

    if not zips:
        raise RuntimeError("No valid source ZIP records with zip/lat/lng fields.")

    print(f"Computing neighbors within {cfg.radius_miles:.2f} miles...")
    # Approx degree span that safely covers the target radius globally.
    # 1 degree latitude ~= 69 miles; use a small cell for candidate pruning.
    cell_deg = cfg.radius_miles / 69.0
    if cell_deg <= 0:
        raise RuntimeError("RADIUS_MILES must be positive.")

    grid: Dict[tuple[int, int], List[int]] = defaultdict(list)
    for idx, z in enumerate(zips):
        grid[lat_bucket(z["lat"], z["lng"], cell_deg)].append(idx)

    neighbors_by_source: Dict[str, List[str]] = {}
    self_only_count = 0
    max_neighbor_count = 0
    for idx, src in enumerate(zips):
        src_cell = lat_bucket(src["lat"], src["lng"], cell_deg)
        candidates = []
        for dlat in range(-SEARCH_CELL_RANGE, SEARCH_CELL_RANGE + 1):
            for dlon in range(-SEARCH_CELL_RANGE, SEARCH_CELL_RANGE + 1):
                candidates.extend(grid.get((src_cell[0] + dlat, src_cell[1] + dlon), []))

        linked_ids = []
        for j in candidates:
            dst = zips[j]
            if dst["record_id"] == src["record_id"]:
                continue
            dist = haversine_miles(src["lat"], src["lng"], dst["lat"], dst["lng"])
            if dist <= cfg.radius_miles:
                linked_ids.append(dst["record_id"])

        # Dedupe while preserving rough local ordering.
        deduped = list(dict.fromkeys(linked_ids))
        neighbors_by_source[src["record_id"]] = deduped
        neighbor_count = len(deduped)
        if neighbor_count == 0:
            self_only_count += 1
        if neighbor_count > max_neighbor_count:
            max_neighbor_count = neighbor_count
        if (idx + 1) % 2500 == 0:
            print(f"  computed {idx + 1}/{len(zips)}...")

    avg_neighbor_count = sum(len(v) for v in neighbors_by_source.values()) / len(zips)
    print(
        "Neighbor stats: "
        f"no-neighbor={self_only_count} ({self_only_count / len(zips):.1%}), "
        f"avg_links={avg_neighbor_count:.2f}, max_links={max_neighbor_count}"
    )

    print("Loading existing radius table records for resume support...")
    existing_target_records = client.list_records(
        cfg.target_table_id,
        fields=[cfg.target_zip_field],
    )
    existing_target_by_zip: Dict[str, str] = {}
    duplicate_zip_count = 0
    for rec in existing_target_records:
        existing_zip = normalize_zip(rec.get("fields", {}).get(cfg.target_zip_field))
        if not existing_zip:
            continue
        if existing_zip in existing_target_by_zip:
            duplicate_zip_count += 1
            continue
        existing_target_by_zip[existing_zip] = rec["id"]
    print(
        f"Found {len(existing_target_by_zip)} existing radius rows "
        f"({duplicate_zip_count} duplicate-zip rows ignored)."
    )

    print("Preparing missing radius table records...")
    create_payload = []
    source_to_zip_radius_record: Dict[str, str] = {}
    missing_sources = []
    for src in zips:
        existing_id = existing_target_by_zip.get(src["zip"])
        if existing_id:
            source_to_zip_radius_record[src["record_id"]] = existing_id
            continue
        fields = {
            cfg.target_zip_field: int(src["zip"]),
            cfg.target_link_field: neighbors_by_source[src["record_id"]],
        }
        create_payload.append(fields)
        missing_sources.append(src)

    if cfg.dry_run:
        print(
            "[DRY_RUN] Resume summary: "
            f"existing={len(existing_target_by_zip)}, "
            f"missing={len(create_payload)}, total={len(zips)}"
        )
        if create_payload:
            sample = create_payload[0]
            print(f"[DRY_RUN] Sample payload keys: {list(sample.keys())}")
            print(
                f"[DRY_RUN] Sample linked count for first missing ZIP: "
                f"{len(sample[cfg.target_link_field])}"
            )
        return 0

    if not cfg.auto_confirm:
        response = input(
            "Proceed with Airtable writes "
            f"(create {len(create_payload)} missing rows + update backlinks)? [y/N]: "
        ).strip().lower()
        if response not in {"y", "yes"}:
            print("Aborted before writing any records.")
            return 0

    created_records = []
    if create_payload:
        for chunk in chunked(create_payload, BATCH_SIZE):
            created_records.extend(client.create_records(cfg.target_table_id, chunk))
            if len(created_records) % 2500 == 0:
                print(f"  created {len(created_records)}/{len(create_payload)}...")

        if len(created_records) != len(create_payload):
            raise RuntimeError(
                "Created record count does not match missing payload count. "
                f"created={len(created_records)}, expected={len(create_payload)}"
            )

        # Because we create in source order, map by position.
        for i, src in enumerate(missing_sources):
            source_to_zip_radius_record[src["record_id"]] = created_records[i]["id"]
    else:
        print("No missing rows to create; resuming with backlink updates only.")

    if len(source_to_zip_radius_record) != len(zips):
        raise RuntimeError(
            "Could not map every source ZIP to a radius row before backlink update. "
            f"mapped={len(source_to_zip_radius_record)}, source={len(zips)}"
        )

    print("Updating US Zips backlink field...")
    update_payload = []
    for src in zips:
        update_payload.append(
            {
                "id": src["record_id"],
                "fields": {
                    cfg.source_backlink_field: [source_to_zip_radius_record[src["record_id"]]]
                },
            }
        )

    client.update_records(cfg.source_table_id, update_payload)
    print("Done. ZIP radius links are fully populated.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
