/**
 * Zip linking for kickoff.html — same junction pattern as Dashboards/ClientManagement.html
 */
(function (global) {
  const CONFIG = {
    ADSET_TABLE: "tblee61crNCoSfurx",
    ADSET_ZIPS_TABLE: "tbl87JqHAdJwgq1GL",
    US_ZIPS_TABLE: "tblieaHIf6rDfFZFl",
    JUNCTION_ADSET_FIELD: "Adset",
    JUNCTION_ZIP_FIELD: "US Zips",
    ADSET_JUNCTION_LINK_FIELDS: ["Adset Zip Tracking", "Ad Set Zip Tracking"],
    JUNCTION_ADSET_FILTER_FIELDS: ["Adset"],
    JUNCTION_ZIP_LINK_FIELDS: ["US Zips"],
    US_ZIPS_MATCH_FIELD: "Zip",
    US_ZIPS_MATCH_AS_NUMBER: true,
    US_ZIPS_BATCH_CHUNK: 20,
    US_ZIPS_BATCH_PAUSE_MS: 150,
    JUNCTION_BATCH_CHUNK: 20,
  };

  const BUILTIN_ZIP_FIELD_CANDIDATES = ["ZIP", "Zip", "zip", "Name", "ZCTA", "Zcta", "GEOID", "Zip Code", "ZIP Code"];

  function create(deps) {
    const fetchJson = deps.fetchJson;
    const airtableUrl = deps.airtableUrl;
    let usZipsMatchField = null;
    let usZipsMatchAsNumber = false;
    const zipRecordIdToCode = new Map();
    let readyPromise = null;

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function airtableStringForFormula(s) {
      return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    async function fetchAllRecords(table, params) {
      params = params || {};
      const records = [];
      let offset = null;
      do {
        const u = new URL(airtableUrl(table), window.location.origin);
        if (params.formula) u.searchParams.set("filterByFormula", params.formula);
        if (offset) u.searchParams.set("offset", offset);
        if (params.fields) {
          params.fields.forEach(function (f) { u.searchParams.append("fields[]", f); });
        }
        const data = await fetchJson(u.toString());
        records.push.apply(records, data.records || []);
        offset = data.offset || null;
      } while (offset);
      return records;
    }

    function parseZipInput(raw) {
      if (!raw || !String(raw).trim()) return [];
      const parts = String(raw).split(/[\s,;\n\r]+/).map(function (z) { return z.trim(); }).filter(Boolean);
      const out = [];
      const seen = new Set();
      parts.forEach(function (p) {
        const m = p.match(/\d{5}/);
        if (!m) return;
        const five = m[0];
        if (seen.has(five)) return;
        seen.add(five);
        out.push(five);
      });
      return out;
    }

    function zipMatchFormula(fiveDigit) {
      if (!usZipsMatchField) throw new Error("Zip match field not ready.");
      const n = parseInt(fiveDigit, 10);
      if (usZipsMatchAsNumber) return "{" + usZipsMatchField + "}=" + n;
      return "{" + usZipsMatchField + '}="' + airtableStringForFormula(fiveDigit) + '"';
    }

    async function resolveUsZipsMatchField() {
      const data = await fetchJson(airtableUrl(CONFIG.US_ZIPS_TABLE) + "?maxRecords=1");
      const rec = data.records && data.records[0];
      if (!rec) throw new Error("US Zips table has no rows.");
      const fields = rec.fields || {};
      const keys = Object.keys(fields);
      const preferred = (CONFIG.US_ZIPS_MATCH_FIELD || "").trim();
      if (preferred) {
        if (keys.indexOf(preferred) < 0) throw new Error('US Zips has no field "' + preferred + '".');
        usZipsMatchField = preferred;
        usZipsMatchAsNumber = typeof CONFIG.US_ZIPS_MATCH_AS_NUMBER === "boolean"
          ? CONFIG.US_ZIPS_MATCH_AS_NUMBER
          : typeof fields[preferred] === "number";
        return;
      }
      const tryOrder = BUILTIN_ZIP_FIELD_CANDIDATES;
      for (let i = 0; i < tryOrder.length; i++) {
        if (tryOrder[i] && keys.indexOf(tryOrder[i]) >= 0) {
          usZipsMatchField = tryOrder[i];
          break;
        }
      }
      if (!usZipsMatchField) throw new Error("Could not detect US Zips match field.");
      if (typeof fields[usZipsMatchField] === "number") usZipsMatchAsNumber = true;
    }

    function ensureReady() {
      if (!readyPromise) {
        readyPromise = resolveUsZipsMatchField().catch(function (err) {
          readyPromise = null;
          throw err;
        });
      }
      return readyPromise;
    }

    async function findZipRecordId(fiveDigit) {
      const formula = encodeURIComponent(zipMatchFormula(fiveDigit));
      const url = airtableUrl(CONFIG.US_ZIPS_TABLE) + "?maxRecords=1&filterByFormula=" + formula;
      const data = await fetchJson(url);
      const rec = data.records && data.records[0];
      return rec ? rec.id : null;
    }

    function zipCodeStringFromRaw(raw, fallbackId) {
      if (typeof raw === "number") return String(Math.floor(raw)).padStart(5, "0");
      if (raw != null) return String(raw).trim().replace(/\D/g, "").slice(0, 5).padStart(5, "0");
      return fallbackId;
    }

    function normalizeLinkIds(v) {
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    }

    function zipRecordIdFromJunctionFields(fields) {
      const keys = CONFIG.JUNCTION_ZIP_LINK_FIELDS || [CONFIG.JUNCTION_ZIP_FIELD];
      for (let i = 0; i < keys.length; i++) {
        const z = fields[keys[i]];
        const id = Array.isArray(z) ? z[0] : z;
        if (id && typeof id === "string" && id.indexOf("rec") === 0) return id;
      }
      return null;
    }

    function junctionRowFromRecord(r) {
      const fields = r.fields || {};
      const zipId = zipRecordIdFromJunctionFields(fields);
      if (!zipId) return null;
      return { junctionId: r.id, zipRecordId: zipId };
    }

    async function hydrateZipCodesBatch(recordIds) {
      const unique = recordIds.filter(function (id, i, a) {
        return id && String(id).indexOf("rec") === 0 && a.indexOf(id) === i && !zipRecordIdToCode.has(id);
      });
      if (!unique.length) return;
      const chunkSize = CONFIG.US_ZIPS_BATCH_CHUNK || 20;
      const pauseMs = CONFIG.US_ZIPS_BATCH_PAUSE_MS || 150;
      for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const formula = "OR(" + chunk.map(function (id) { return 'RECORD_ID()="' + id + '"'; }).join(",") + ")";
        const u = new URL(airtableUrl(CONFIG.US_ZIPS_TABLE), window.location.origin);
        u.searchParams.set("filterByFormula", formula);
        u.searchParams.append("fields[]", usZipsMatchField);
        u.searchParams.set("maxRecords", "100");
        try {
          const data = await fetchJson(u.toString());
          (data.records || []).forEach(function (rec) {
            const raw = rec.fields && rec.fields[usZipsMatchField];
            zipRecordIdToCode.set(rec.id, zipCodeStringFromRaw(raw, rec.id));
          });
        } catch (e) {
          for (let j = 0; j < chunk.length; j++) {
            const id = chunk[j];
            if (zipRecordIdToCode.has(id)) continue;
            try {
              const one = await fetchJson(airtableUrl(CONFIG.US_ZIPS_TABLE) + "/" + encodeURIComponent(id));
              const raw = one.fields && one.fields[usZipsMatchField];
              zipRecordIdToCode.set(id, zipCodeStringFromRaw(raw, id));
            } catch (err) {
              zipRecordIdToCode.set(id, id);
            }
            await sleep(80);
          }
        }
        chunk.forEach(function (id) {
          if (!zipRecordIdToCode.has(id)) zipRecordIdToCode.set(id, id);
        });
        if (i + chunkSize < unique.length) await sleep(pauseMs);
      }
    }

    async function loadJunctionRowsByJunctionIds(junctionIds) {
      const unique = junctionIds.filter(function (id, i, a) { return id && a.indexOf(id) === i; });
      if (!unique.length) return [];
      const zipFields = [CONFIG.JUNCTION_ZIP_FIELD].concat(CONFIG.JUNCTION_ZIP_LINK_FIELDS || [])
        .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
      const chunkSize = CONFIG.JUNCTION_BATCH_CHUNK || 20;
      const rows = [];
      for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const formula = "OR(" + chunk.map(function (id) { return 'RECORD_ID()="' + id + '"'; }).join(",") + ")";
        try {
          const records = await fetchAllRecords(CONFIG.ADSET_ZIPS_TABLE, {
            formula: formula,
            fields: zipFields.length ? zipFields : undefined,
          });
          records.forEach(function (r) {
            const row = junctionRowFromRecord(r);
            if (row) rows.push(row);
          });
        } catch (e) {
          for (let j = 0; j < chunk.length; j++) {
            try {
              const data = await fetchJson(airtableUrl(CONFIG.ADSET_ZIPS_TABLE) + "/" + encodeURIComponent(chunk[j]));
              const row = junctionRowFromRecord(data);
              if (row) rows.push(row);
            } catch (err) { /* skip */ }
            await sleep(80);
          }
        }
      }
      return rows;
    }

    async function fetchJunctionRowsForAdset(adsetId) {
      let adsetRecord = null;
      try {
        adsetRecord = await fetchJson(airtableUrl(CONFIG.ADSET_TABLE) + "/" + encodeURIComponent(adsetId));
      } catch (e) { /* ignore */ }

      if (adsetRecord && adsetRecord.fields) {
        const linkFields = CONFIG.ADSET_JUNCTION_LINK_FIELDS || [];
        for (let i = 0; i < linkFields.length; i++) {
          const juncIds = normalizeLinkIds(adsetRecord.fields[linkFields[i]]);
          if (juncIds.length) {
            const rows = await loadJunctionRowsByJunctionIds(juncIds);
            if (rows.length) return rows;
          }
        }
      }

      const adsetFieldNames = CONFIG.JUNCTION_ADSET_FILTER_FIELDS || [CONFIG.JUNCTION_ADSET_FIELD];
      const zipFields = [CONFIG.JUNCTION_ZIP_FIELD].concat(CONFIG.JUNCTION_ZIP_LINK_FIELDS || [])
        .filter(function (x, idx, a) { return x && a.indexOf(x) === idx; });
      for (let i = 0; i < adsetFieldNames.length; i++) {
        try {
          const records = await fetchAllRecords(CONFIG.ADSET_ZIPS_TABLE, {
            formula: "{" + adsetFieldNames[i] + '}="' + adsetId + '"',
            fields: zipFields.length ? zipFields : undefined,
          });
          const mapped = records.map(junctionRowFromRecord).filter(Boolean);
          if (mapped.length) return mapped;
        } catch (e) { /* unknown field */ }
      }
      return [];
    }

    async function linkedZipsDisplayForAdset(adsetId) {
      const rows = await fetchJunctionRowsForAdset(adsetId);
      if (!rows.length) return "";
      await hydrateZipCodesBatch(rows.map(function (r) { return r.zipRecordId; }));
      const codes = rows.map(function (r) { return zipRecordIdToCode.get(r.zipRecordId) || r.zipRecordId; });
      codes.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
      return codes.join(", ");
    }

    async function createJunctionRows(adsetId, zipRecordIds, onProgress) {
      const fieldAdset = CONFIG.JUNCTION_ADSET_FIELD;
      const fieldZip = CONFIG.JUNCTION_ZIP_FIELD;
      const batchSize = 10;
      const total = zipRecordIds.length;
      let done = 0;
      for (let i = 0; i < zipRecordIds.length; i += batchSize) {
        const chunk = zipRecordIds.slice(i, i + batchSize);
        const body = {
          records: chunk.map(function (zipRecId) {
            const fields = {};
            fields[fieldAdset] = [adsetId];
            fields[fieldZip] = [zipRecId];
            return { fields: fields };
          }),
        };
        await fetchJson(airtableUrl(CONFIG.ADSET_ZIPS_TABLE), {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        done += chunk.length;
        if (onProgress) onProgress(done, total);
      }
    }

    async function deleteJunctionRecord(junctionRecordId) {
      await fetchJson(airtableUrl(CONFIG.ADSET_ZIPS_TABLE) + "/" + encodeURIComponent(junctionRecordId), {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
    }

    function setSectionStatus(sectionEl, message, kind) {
      const el = sectionEl.querySelector("[data-role=\"zip-status\"]");
      if (!el) return;
      el.textContent = message || "";
      el.className = "zip-section-status" + (kind ? " " + kind : "");
    }

    function setSectionProgress(sectionEl, message) {
      const zipLine = sectionEl.querySelector("[data-role=\"zip-line\"]");
      if (zipLine && message) zipLine.textContent = message;
      setSectionStatus(sectionEl, message, "info");
    }

    function setSectionButtonsDisabled(sectionEl, disabled) {
      sectionEl.querySelectorAll("[data-action]").forEach(function (btn) {
        btn.disabled = !!disabled;
      });
    }

    async function refreshSection(sectionEl) {
      const adsetId = sectionEl.dataset.adsetId;
      if (!adsetId) return;
      const zipLine = sectionEl.querySelector("[data-role=\"zip-line\"]");
      if (zipLine) zipLine.textContent = "Loading linked zips…";
      setSectionStatus(sectionEl, "", "");
      try {
        await ensureReady();
        const zips = await linkedZipsDisplayForAdset(adsetId);
        if (zipLine) zipLine.textContent = zips || "(none)";
      } catch (err) {
        if (zipLine) zipLine.textContent = "Error loading zips.";
        setSectionStatus(sectionEl, err.message || "Failed to load zips.", "error");
      }
    }

    async function onAddZips(sectionEl) {
      const adsetId = sectionEl.dataset.adsetId;
      const input = sectionEl.querySelector("[data-role=\"zip-input\"]");
      const zips = parseZipInput(input ? input.value : "");
      if (!zips.length) {
        setSectionStatus(sectionEl, "Enter at least one valid 5-digit zip.", "error");
        return;
      }
      setSectionButtonsDisabled(sectionEl, true);
      try {
        await ensureReady();
        setSectionProgress(sectionEl, "Add: loading current links…");
        const existingRows = await fetchJunctionRowsForAdset(adsetId);
        const existingZipIds = new Set(existingRows.map(function (r) { return r.zipRecordId; }));
        const notFound = [];
        const duplicate = [];
        const toCreate = [];
        for (let i = 0; i < zips.length; i++) {
          setSectionProgress(sectionEl, "Add: looking up zip " + (i + 1) + "/" + zips.length + "…");
          const zipRecId = await findZipRecordId(zips[i]);
          if (!zipRecId) { notFound.push(zips[i]); continue; }
          if (existingZipIds.has(zipRecId)) { duplicate.push(zips[i]); continue; }
          toCreate.push(zipRecId);
          existingZipIds.add(zipRecId);
        }
        if (toCreate.length) {
          await createJunctionRows(adsetId, toCreate, function (done, tot) {
            setSectionProgress(sectionEl, "Add: saving links " + done + "/" + tot + "…");
          });
          if (input) input.value = "";
        }
        await refreshSection(sectionEl);
        const parts = ["Added " + toCreate.length + " link" + (toCreate.length !== 1 ? "s" : "") + "."];
        if (duplicate.length) parts.push("Skipped " + duplicate.length + " already linked: " + duplicate.join(", ") + ".");
        if (notFound.length) parts.push("No US Zips row for: " + notFound.join(", ") + ".");
        setSectionStatus(sectionEl, parts.join(" "), notFound.length && !toCreate.length ? "error" : "success");
      } catch (err) {
        setSectionStatus(sectionEl, err.message || "Add failed.", "error");
      } finally {
        setSectionButtonsDisabled(sectionEl, false);
      }
    }

    async function onRemoveZips(sectionEl) {
      const adsetId = sectionEl.dataset.adsetId;
      const input = sectionEl.querySelector("[data-role=\"zip-input\"]");
      const zips = parseZipInput(input ? input.value : "");
      if (!zips.length) {
        setSectionStatus(sectionEl, "Enter at least one valid 5-digit zip to remove.", "error");
        return;
      }
      setSectionButtonsDisabled(sectionEl, true);
      try {
        await ensureReady();
        setSectionProgress(sectionEl, "Remove: loading links…");
        const rows = await fetchJunctionRowsForAdset(adsetId);
        const zipIdToJunction = new Map();
        rows.forEach(function (r) { zipIdToJunction.set(r.zipRecordId, r.junctionId); });
        const notFound = [];
        const notLinked = [];
        const toDelete = [];
        for (let i = 0; i < zips.length; i++) {
          setSectionProgress(sectionEl, "Remove: looking up " + (i + 1) + "/" + zips.length + "…");
          const zipRecId = await findZipRecordId(zips[i]);
          if (!zipRecId) { notFound.push(zips[i]); continue; }
          const jId = zipIdToJunction.get(zipRecId);
          if (!jId) { notLinked.push(zips[i]); continue; }
          toDelete.push(jId);
        }
        for (let d = 0; d < toDelete.length; d++) {
          setSectionProgress(sectionEl, "Remove: deleting " + (d + 1) + "/" + toDelete.length + "…");
          await deleteJunctionRecord(toDelete[d]);
        }
        if (toDelete.length && input) input.value = "";
        await refreshSection(sectionEl);
        const parts = ["Removed " + toDelete.length + " link" + (toDelete.length !== 1 ? "s" : "") + "."];
        if (notLinked.length) parts.push("Not linked: " + notLinked.join(", ") + ".");
        if (notFound.length) parts.push("No US Zips row for: " + notFound.join(", ") + ".");
        setSectionStatus(sectionEl, parts.join(" "), toDelete.length ? "success" : "error");
      } catch (err) {
        setSectionStatus(sectionEl, err.message || "Remove failed.", "error");
      } finally {
        setSectionButtonsDisabled(sectionEl, false);
      }
    }

    async function onSwapZips(sectionEl) {
      const adsetId = sectionEl.dataset.adsetId;
      const input = sectionEl.querySelector("[data-role=\"zip-input\"]");
      const zips = parseZipInput(input ? input.value : "");
      if (!zips.length) {
        setSectionStatus(sectionEl, "Enter at least one valid 5-digit zip to swap.", "error");
        return;
      }
      setSectionButtonsDisabled(sectionEl, true);
      try {
        await ensureReady();
        setSectionProgress(sectionEl, "Swap: loading links…");
        const rows = await fetchJunctionRowsForAdset(adsetId);
        const existingZipIdToJunctionId = new Map();
        rows.forEach(function (r) { existingZipIdToJunctionId.set(r.zipRecordId, r.junctionId); });
        const targetZipRecIds = new Set();
        const notFound = [];
        for (let i = 0; i < zips.length; i++) {
          setSectionProgress(sectionEl, "Swap: looking up " + (i + 1) + "/" + zips.length + "…");
          const zipRecId = await findZipRecordId(zips[i]);
          if (!zipRecId) { notFound.push(zips[i]); continue; }
          targetZipRecIds.add(zipRecId);
        }
        const toDelete = [];
        existingZipIdToJunctionId.forEach(function (junctionId, zipRecId) {
          if (!targetZipRecIds.has(zipRecId)) toDelete.push(junctionId);
        });
        const toCreate = [];
        targetZipRecIds.forEach(function (zipRecId) {
          if (!existingZipIdToJunctionId.has(zipRecId)) toCreate.push(zipRecId);
        });
        for (let i = 0; i < toDelete.length; i++) {
          setSectionProgress(sectionEl, "Swap: removing " + (i + 1) + "/" + toDelete.length + "…");
          await deleteJunctionRecord(toDelete[i]);
        }
        if (toCreate.length) {
          await createJunctionRows(adsetId, toCreate, function (done, tot) {
            setSectionProgress(sectionEl, "Swap: adding " + done + "/" + tot + "…");
          });
        }
        await refreshSection(sectionEl);
        const parts = [
          "Swap complete. Removed " + toDelete.length + ", added " + toCreate.length + ".",
        ];
        if (notFound.length) parts.push("No US Zips row for: " + notFound.join(", ") + ".");
        setSectionStatus(sectionEl, parts.join(" "), "success");
      } catch (err) {
        setSectionStatus(sectionEl, err.message || "Swap failed.", "error");
      } finally {
        setSectionButtonsDisabled(sectionEl, false);
      }
    }

    function renderSections(container, adsets, nicheLabelFn) {
      container.innerHTML = "";
      if (!adsets.length) {
        const empty = document.createElement("p");
        empty.className = "field-subtext";
        empty.textContent = "No ad sets to configure.";
        container.appendChild(empty);
        return;
      }

      adsets.forEach(function (adset) {
        const niche = nicheLabelFn(adset);
        const section = document.createElement("section");
        section.className = "adset-zip-section";
        section.dataset.adsetId = adset.id;

        const heading = document.createElement("h3");
        heading.className = "adset-cap-heading";
        heading.textContent = niche;
        section.appendChild(heading);

        const linkedLabel = document.createElement("span");
        linkedLabel.className = "zip-linked-label";
        linkedLabel.textContent = "Linked zips";
        section.appendChild(linkedLabel);

        const zipLine = document.createElement("p");
        zipLine.className = "zip-linked-line";
        zipLine.dataset.role = "zip-line";
        zipLine.textContent = "Loading…";
        section.appendChild(zipLine);

        const inputLabel = document.createElement("label");
        inputLabel.className = "zip-input-label";
        inputLabel.textContent = "Paste zips to add or remove";
        section.appendChild(inputLabel);

        const textarea = document.createElement("textarea");
        textarea.className = "zip-input";
        textarea.rows = 3;
        textarea.placeholder = "Comma or line-separated 5-digit zips";
        textarea.dataset.role = "zip-input";
        section.appendChild(textarea);

        const actions = document.createElement("div");
        actions.className = "zip-actions";

        const btnAdd = document.createElement("button");
        btnAdd.type = "button";
        btnAdd.className = "btn-zip btn-zip-add";
        btnAdd.dataset.action = "add";
        btnAdd.textContent = "Add Zips";
        btnAdd.addEventListener("click", function () { onAddZips(section); });

        const btnRemove = document.createElement("button");
        btnRemove.type = "button";
        btnRemove.className = "btn-zip btn-zip-remove";
        btnRemove.dataset.action = "remove";
        btnRemove.textContent = "Remove Zips";
        btnRemove.addEventListener("click", function () { onRemoveZips(section); });

        const btnSwap = document.createElement("button");
        btnSwap.type = "button";
        btnSwap.className = "btn-zip btn-zip-swap";
        btnSwap.dataset.action = "swap";
        btnSwap.textContent = "Swap Zips";
        btnSwap.addEventListener("click", function () { onSwapZips(section); });

        actions.appendChild(btnAdd);
        actions.appendChild(btnRemove);
        actions.appendChild(btnSwap);
        section.appendChild(actions);

        const status = document.createElement("p");
        status.className = "zip-section-status";
        status.dataset.role = "zip-status";
        section.appendChild(status);

        container.appendChild(section);
      });
    }

    async function refreshAllSections(container) {
      const sections = container.querySelectorAll(".adset-zip-section");
      await ensureReady();
      for (let i = 0; i < sections.length; i++) {
        await refreshSection(sections[i]);
      }
    }

    return {
      ensureReady: ensureReady,
      renderSections: renderSections,
      refreshAllSections: refreshAllSections,
      refreshSection: refreshSection,
    };
  }

  global.KickoffZipLinking = { create: create };
})(window);
