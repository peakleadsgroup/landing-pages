/**
 * Sales Voicemails + scrape queue + ZIP map
 * Assumes same-origin /api/* and static files under resolveInternalAppsBase().
 */
(function () {
  "use strict";

  var MAX_CONCURRENT_JOBS = 8;
  var POLL_INTERVAL_MS = 5000;
  var MAX_POLL_ATTEMPTS = 180;
  var ZIP_API_TIMEOUT_MS = 90000;
  var ZIP_GEO_TIMEOUT_MS = 120000;

  function resolveInternalAppsBase() {
    try {
      var explicit = document.documentElement.getAttribute("data-internal-apps-base");
      if (explicit != null && explicit !== "") {
        return explicit.replace(/\/$/, "");
      }
      var el = document.querySelector("script[src*='sales-vm-app.js']");
      if (el && el.src) {
        var path = new URL(el.src).pathname;
        var dir = path.replace(/\/[^/]+$/, "");
        return dir || "";
      }
    } catch (e) {}
    return "/InternalApps";
  }

  var INTERNAL_APPS_BASE = resolveInternalAppsBase();
  var GEO_JSON_URL = new URL(
    INTERNAL_APPS_BASE.replace(/\/$/, "") + "/us_zip_complete.json",
    window.location.origin
  ).href;

  function apiUrl(path) {
    return new URL(path, window.location.origin).href;
  }

  function log(scope, msg, obj) {
    var line = "[sales-vm:" + scope + "] " + msg;
    if (obj !== undefined) console.log(line, obj);
    else console.log(line);
  }

  function logError(scope, msg, err, detail) {
    console.error("[sales-vm:" + scope + "] " + msg, err, detail || {});
  }

  function pad2(n) {
    var x = Number(n) || 0;
    return x < 10 ? "0" + x : String(x);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatPhone(p) {
    if (!p) return "—";
    var d = String(p).replace(/\D/g, "");
    if (d.length === 10) return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    if (d.length === 11 && d[0] === "1")
      return "(" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7);
    return String(p);
  }

  function formatDuration(sec) {
    if (sec == null) return "—";
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m > 0 ? m + ":" + pad2(s) : "0:" + pad2(s);
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  }

  function normalizePhoneKey(p) {
    if (!p || typeof p !== "string") return "__unknown__";
    var d = p.replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : d;
  }

  function parseDate(d) {
    if (!d) return 0;
    var t = new Date(d).getTime();
    return isNaN(t) ? 0 : t;
  }

  function groupByPhone(recordings) {
    var groups = new Map();
    for (var i = 0; i < recordings.length; i++) {
      var r = recordings[i];
      var key = normalizePhoneKey(r.from);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    groups.forEach(function (arr) {
      arr.sort(function (a, b) {
        return parseDate(b.date_created) - parseDate(a.date_created);
      });
    });
    return groups;
  }

  async function parseJsonSafe(res) {
    var text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (e) {
      return { _raw: text, _parseError: e.message };
    }
  }

  async function fetchWithTimeout(url, init, timeoutMs) {
    var ctrl = new AbortController();
    var tid = setTimeout(function () {
      ctrl.abort();
    }, timeoutMs);
    try {
      return await fetch(url, Object.assign({}, init || {}, { signal: ctrl.signal }));
    } finally {
      clearTimeout(tid);
    }
  }

  /**
   * Airtable-backed ZIP/notes lists may need many pages. Each GET returns at most
   * 35 pages per Worker run; follow nextOffset until done (avoids CF subrequest limit).
   */
  async function fetchPaginatedJsonList(apiPath, listKey, timeoutMs) {
    var base = apiUrl(apiPath);
    var all = [];
    var seen = new Set();
    var nextOffset = null;
    var safety = 0;
    while (safety < 80) {
      safety += 1;
      var url = base + (nextOffset ? "?offset=" + encodeURIComponent(nextOffset) : "");
      var res = await fetchWithTimeout(url, {}, timeoutMs);
      var data = await parseJsonSafe(res);
      if (!res.ok) {
        throw new Error(data.error || apiPath + " failed (" + res.status + ")");
      }
      var batch = Array.isArray(data[listKey]) ? data[listKey] : [];
      for (var bi = 0; bi < batch.length; bi++) {
        var item = batch[bi];
        if (!seen.has(item)) {
          seen.add(item);
          all.push(item);
        }
      }
      nextOffset =
        data.nextOffset != null && data.nextOffset !== "" ? String(data.nextOffset) : null;
      if (!nextOffset) break;
      log("map", apiPath + " chunk", { batch: batch.length, totalSoFar: all.length });
    }
    all.sort();
    return all;
  }

  async function fetchAllScrapedZips() {
    return fetchPaginatedJsonList("/api/scraped-zips", "zips", ZIP_API_TIMEOUT_MS);
  }

  async function fetchAllPartnerZips() {
    return fetchPaginatedJsonList("/api/partner-zips", "zips", ZIP_API_TIMEOUT_MS);
  }

  async function fetchAllNotesByPhone() {
    var base = apiUrl("/api/notes");
    var merged = {};
    var nextOffset = null;
    var safety = 0;
    while (safety < 80) {
      safety += 1;
      var url = base + (nextOffset ? "?offset=" + encodeURIComponent(nextOffset) : "");
      var res = await fetch(url);
      var data = await parseJsonSafe(res);
      if (!res.ok) {
        throw new Error(data.error || "notes failed (" + res.status + ")");
      }
      var chunk = (data && data.notesByPhone) || {};
      Object.keys(chunk).forEach(function (k) {
        merged[k] = chunk[k];
      });
      nextOffset =
        data.nextOffset != null && data.nextOffset !== "" ? String(data.nextOffset) : null;
      if (!nextOffset) break;
    }
    return merged;
  }

  function buildZipGeoLookup(raw) {
    if (raw == null || typeof raw !== "object") {
      return { get: function () { return null; }, mode: "invalid", size: 0 };
    }
    if (Array.isArray(raw)) {
      var m = new Map();
      for (var i = 0; i < raw.length; i++) {
        var row = raw[i];
        if (!row || typeof row !== "object") continue;
        var z = String(
          row.zip != null
            ? row.zip
            : row.Zip != null
              ? row.Zip
              : row.ZIP != null
                ? row.ZIP
                : row.postal_code != null
                  ? row.postal_code
                  : ""
        )
          .replace(/\D/g, "")
          .slice(0, 5);
        if (z.length !== 5) continue;
        var lat =
          row.lat != null
            ? row.lat
            : row.latitude != null
              ? row.latitude
              : row.Lat;
        var lng =
          row.lng != null
            ? row.lng
            : row.longitude != null
              ? row.longitude
              : row.lon != null
                ? row.lon
                : row.Lng;
        if (lat == null || lng == null) continue;
        var la = Number(lat);
        var ln = Number(lng);
        if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
        m.set(z, { lat: la, lng: ln });
      }
      return {
        get: function (zip) {
          var k = String(zip)
            .replace(/\D/g, "")
            .slice(0, 5);
          return m.get(k) || null;
        },
        mode: "array",
        size: m.size
      };
    }
    var keys = Object.keys(raw);
    if (keys.length && typeof raw[keys[0]] === "string") {
      return { get: function () { return null; }, mode: "non-geo-object", size: 0 };
    }
    return {
      get: function (zip) {
        var k = String(zip)
          .replace(/\D/g, "")
          .slice(0, 5);
        if (k.length !== 5) return null;
        var e = raw[k];
        if (!e || typeof e !== "object") return null;
        var la = e.lat != null ? e.lat : e.latitude != null ? e.latitude : e.Lat;
        var ln = e.lng != null ? e.lng : e.longitude != null ? e.longitude : e.lon != null ? e.lon : e.Lng;
        if (la == null || ln == null) return null;
        la = Number(la);
        ln = Number(ln);
        if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
        return { lat: la, lng: ln };
      },
      mode: "object",
      size: keys.length
    };
  }

  var scrapedZipMap = null;
  var scrapedZipMarkers = null;
  var partnerZipMarkers = null;
  var mapLegendAdded = false;

  function addMapLegend(map) {
    if (mapLegendAdded || !map || !window.L) return;
    mapLegendAdded = true;
    var legend = L.control({ position: "bottomright" });
    legend.onAdd = function () {
      var div = L.DomUtil.create("div", "svm-map-legend");
      div.innerHTML =
        "<strong>Legend</strong>" +
        '<div class="svm-map-legend-row"><span class="svm-leg-dot svm-leg-scraped"></span><span>Scraped (tblUUP3DFDn0RmEj0)</span></div>' +
        '<div class="svm-map-legend-row"><span class="svm-leg-dot svm-leg-partner"></span><span>Has partner (# of partners &gt; 0, tblieaHIf6rDfFZFl)</span></div>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      return div;
    };
    legend.addTo(map);
  }

  function initScrapedZipMapCanvas(summaryEl) {
    if (scrapedZipMap || !window.L) return;
    var mapEl = document.getElementById("scraped-zip-map");
    if (!mapEl) return;
    scrapedZipMap = L.map("scraped-zip-map").setView([39.8283, -98.5795], 4);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 20
    }).addTo(scrapedZipMap);
    partnerZipMarkers = L.layerGroup().addTo(scrapedZipMap);
    scrapedZipMarkers = L.layerGroup().addTo(scrapedZipMap);
    addMapLegend(scrapedZipMap);
    scrapedZipMap.whenReady(function () {
      log("map", "ready");
    });
    setTimeout(function () {
      if (scrapedZipMap) scrapedZipMap.invalidateSize();
    }, 100);
  }

  async function loadScrapedZipMap(summaryEl) {
    try {
      initScrapedZipMapCanvas(summaryEl);
      if (!scrapedZipMap || !scrapedZipMarkers || !partnerZipMarkers) {
        if (!window.L) {
          if (summaryEl) summaryEl.textContent = "Map unavailable: Leaflet did not load.";
          return;
        }
        if (summaryEl) summaryEl.textContent = "Map container missing.";
        return;
      }
      if (summaryEl) summaryEl.textContent = "Loading ZIP lists and coordinates…";
      log("map", "fetch", { geoJsonUrl: GEO_JSON_URL });
      var zipDataRes;
      try {
        zipDataRes = await fetchWithTimeout(GEO_JSON_URL, {}, ZIP_GEO_TIMEOUT_MS);
      } catch (e) {
        if (e && e.name === "AbortError") {
          if (summaryEl) summaryEl.textContent = "Request timed out. Check Network tab.";
        }
        throw e;
      }
      var allZipData = await parseJsonSafe(zipDataRes);
      if (!zipDataRes.ok) {
        throw new Error(
          allZipData.error || "ZIP geo file failed (" + zipDataRes.status + "). Deploy us_zip_complete.json next to this app."
        );
      }
      var scrapedZips = [];
      var partnerZips = [];
      try {
        scrapedZips = await fetchAllScrapedZips();
        log("map", "scraped-zips loaded", { count: scrapedZips.length });
      } catch (se) {
        throw new Error((se && se.message) || "Failed to load scraped zips");
      }
      try {
        partnerZips = await fetchAllPartnerZips();
        log("map", "partner-zips loaded", { count: partnerZips.length });
      } catch (pe) {
        log("map", "partner-zips failed", { message: pe && pe.message });
      }
      var geo = buildZipGeoLookup(allZipData);
      log("map", "geo lookup", { mode: geo.mode, size: geo.size });
      scrapedZipMarkers.clearLayers();
      partnerZipMarkers.clearLayers();
      var allBoundsMarkers = [];
      var plottedScraped = 0;
      var plottedPartner = 0;
      var zi;
      for (zi = 0; zi < scrapedZips.length; zi++) {
        var szip = scrapedZips[zi];
        var sentry = geo.get(szip);
        if (!sentry) continue;
        var sm = L.circleMarker([sentry.lat, sentry.lng], {
          radius: 4,
          color: "#2563eb",
          fillColor: "#3b82f6",
          fillOpacity: 0.72,
          weight: 1
        }).bindPopup(
          "<strong>ZIP:</strong> " +
            escapeHtml(szip) +
            "<br><em>Scraped</em> (scraped businesses)"
        );
        scrapedZipMarkers.addLayer(sm);
        allBoundsMarkers.push(sm);
        plottedScraped++;
      }
      for (zi = 0; zi < partnerZips.length; zi++) {
        var pzip = partnerZips[zi];
        var pentry = geo.get(pzip);
        if (!pentry) continue;
        var pm = L.circleMarker([pentry.lat, pentry.lng], {
          radius: 5,
          color: "#047857",
          fillColor: "#10b981",
          fillOpacity: 0.88,
          weight: 1.5
        }).bindPopup(
          "<strong>ZIP:</strong> " +
            escapeHtml(pzip) +
            "<br><em>Partner area</em> (# of partners &gt; 0)"
        );
        partnerZipMarkers.addLayer(pm);
        allBoundsMarkers.push(pm);
        plottedPartner++;
      }
      if (summaryEl) {
        summaryEl.textContent =
          scrapedZips.length +
          " scraped · " +
          partnerZips.length +
          " partner ZIPs in Airtable · " +
          plottedScraped +
          " scraped dots · " +
          plottedPartner +
          " partner dots on map.";
      }
      if (allBoundsMarkers.length > 0) {
        var group = L.featureGroup(allBoundsMarkers);
        scrapedZipMap.fitBounds(group.getBounds().pad(0.15));
      }
      setTimeout(function () {
        if (scrapedZipMap) scrapedZipMap.invalidateSize();
      }, 50);
    } catch (err) {
      if (summaryEl) summaryEl.textContent = "Map error: " + (err.message || String(err));
      logError("map", "load failed", err);
    }
  }

  var nextJobId = 1;
  var activeJobs = 0;
  var jobs = [];

  function statusClass(status) {
    if (status === "pending") return "status-pending";
    if (status === "starting") return "status-starting";
    if (status === "running") return "status-running";
    if (status === "completed") return "status-completed";
    if (status === "failed") return "status-failed";
    return "status-pending";
  }

  function renderJobs(els) {
    if (!els.queueSummary || !els.jobsList || !els.jobsEmpty) return;
    var pending = jobs.filter(function (j) { return j.status === "pending"; }).length;
    var starting = jobs.filter(function (j) { return j.status === "starting"; }).length;
    var running = jobs.filter(function (j) { return j.status === "running"; }).length;
    var completed = jobs.filter(function (j) { return j.status === "completed"; }).length;
    var failed = jobs.filter(function (j) { return j.status === "failed"; }).length;
    var active = starting + running;
    els.queueSummary.textContent =
      "Active " +
      active +
      "/" +
      MAX_CONCURRENT_JOBS +
      " · Pending " +
      pending +
      " · Done " +
      completed +
      " · Failed " +
      failed;
    if (jobs.length === 0) {
      els.jobsList.innerHTML = "";
      els.jobsEmpty.style.display = "block";
      return;
    }
    els.jobsEmpty.style.display = "none";
    els.jobsList.innerHTML = jobs
      .slice()
      .sort(function (a, b) {
        return a.id - b.id;
      })
      .map(function (job) {
        return (
          "<li><div class=\"svm-job-row\"><div><p class=\"svm-job-title\">" +
          escapeHtml(job.location) +
          "</p><p class=\"svm-job-meta\">" +
          escapeHtml(job.message || "…") +
          "</p></div><div style=\"text-align:right\"><span class=\"status-pill " +
          statusClass(job.status) +
          "\">" +
          escapeHtml(job.status) +
          "</span>" +
          (job.runId
            ? "<div class=\"svm-mini\">run " + escapeHtml(String(job.runId).slice(0, 12)) + "…</div>"
            : "") +
          "</div></div></li>"
        );
      })
      .join("");
  }

  function setJobStatus(job, status, message) {
    job.status = status;
    job.message = message || job.message || "";
  }

  async function pollRun(job, els) {
    for (var i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise(function (r) {
        setTimeout(r, POLL_INTERVAL_MS);
      });
      var statusUrl =
        apiUrl("/api/scrape/status?runId=" + encodeURIComponent(job.runId) + "&launchCalls=1");
      var res = await fetch(statusUrl);
      var data = await parseJsonSafe(res);
      if (!res.ok) {
        var er = new Error(data.error || "Status check failed");
        er.cause = data;
        throw er;
      }
      if (data.status === "running") {
        setJobStatus(job, "running", "In progress… (" + (i + 1) + " checks)");
        renderJobs(els);
        continue;
      }
      if (data.status === "failed") {
        throw new Error((data.error || "Scrape failed") + (data.stage ? " (" + data.stage + ")" : ""));
      }
      if (data.status === "completed") {
        var saved = Number.isFinite(data.saved) ? data.saved : 0;
        var slyErr = data.slybroadcast && data.slybroadcast.error;
        var slyCount = data.slybroadcast && data.slybroadcast.count;
        if (slyErr) {
          setJobStatus(job, "completed", "Saved " + saved + ". Call error: " + slyErr);
        } else if (slyCount != null) {
          setJobStatus(job, "completed", "Saved " + saved + ", " + slyCount + " calls launched.");
        } else {
          setJobStatus(job, "completed", "Saved " + saved + ".");
        }
        renderJobs(els);
        return;
      }
    }
    throw new Error("Timed out waiting for scrape");
  }

  async function runJob(job, els) {
    activeJobs++;
    setJobStatus(job, "starting", "Starting scrape…");
    renderJobs(els);
    try {
      var res = await fetch(apiUrl("/api/scrape"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: job.location })
      });
      var data = await parseJsonSafe(res);
      if (!res.ok) {
        var err = new Error(data.error || "Failed to start scrape");
        err.cause = data;
        throw err;
      }
      if (!data.runId) throw new Error("Missing runId from server");
      job.runId = data.runId;
      setJobStatus(job, "running", "Run started…");
      renderJobs(els);
      await pollRun(job, els);
    } catch (err) {
      setJobStatus(job, "failed", err.message || "Error");
      logError("scrape", "job failed", err, { jobId: job.id });
    } finally {
      activeJobs = Math.max(0, activeJobs - 1);
      processQueue(els);
    }
  }

  function processQueue(els) {
    if (activeJobs >= MAX_CONCURRENT_JOBS) return;
    var slots = MAX_CONCURRENT_JOBS - activeJobs;
    var pending = jobs.filter(function (j) {
      return j.status === "pending";
    });
    for (var i = 0; i < pending.length && i < slots; i++) {
      runJob(pending[i], els);
    }
    renderJobs(els);
  }

  function addLocationJob(els) {
    if (!els.locationInput) return;
    var loc = els.locationInput.value.trim();
    if (!loc) return;
    jobs.push({
      id: nextJobId++,
      location: loc,
      status: "pending",
      runId: null,
      message: "Queued"
    });
    els.locationInput.value = "";
    renderJobs(els);
  }

  function renderRecording(r) {
    var audioPart =
      r.status === "processing"
        ? "<p style=\"margin:0;font-size:0.9rem;color:#b45309\">Processing…</p>"
        : "<audio controls preload=\"metadata\" src=\"" +
          escapeHtml(apiUrl("/api/recordings/" + encodeURIComponent(r.sid) + "/audio")) +
          "\"></audio>";
    var toLine = r.to ? "<p class=\"svm-mini\">To " + escapeHtml(formatPhone(r.to)) + "</p>" : "";
    return (
      "<div class=\"svm-recording-row\"><div><p class=\"svm-muted\" style=\"margin:0 0 0.25rem\">" +
      escapeHtml(formatDate(r.date_created)) +
      " · " +
      (r.status === "processing" ? "…" : escapeHtml(formatDuration(r.duration))) +
      "</p>" +
      toLine +
      "</div><div>" +
      audioPart +
      "</div></div>"
    );
  }

  async function loadRecordings(els) {
    if (!els.loadBtn || !els.btnText || !els.btnSpinner) return;
    els.loadBtn.disabled = true;
    els.btnText.textContent = "Loading…";
    els.btnSpinner.classList.remove("hidden");
    if (els.errorArea) els.errorArea.classList.add("hidden");
    if (els.recordingsArea) els.recordingsArea.classList.add("hidden");
    if (els.emptyState) els.emptyState.classList.add("hidden");
    var days = parseInt(els.daysSelect && els.daysSelect.value, 10) || 7;
    try {
      var recordingsRes = await fetch(apiUrl("/api/recordings?days=" + days));
      var data = await parseJsonSafe(recordingsRes);
      if (!recordingsRes.ok) throw new Error(data.error || "Failed to load recordings");
      var recordings = data.recordings || [];
      var notesByPhone = {};
      try {
        notesByPhone = await fetchAllNotesByPhone();
      } catch (ne) {
        log("recordings", "notes load failed", { message: ne && ne.message });
      }
      var uniq = new Set(recordings.map(function (r) {
        return normalizePhoneKey(r.from);
      })).size;
      if (els.recordingsSummary) {
        els.recordingsSummary.textContent =
          recordings.length + " voicemail(s) from " + uniq + " caller(s)";
      }
      if (recordings.length === 0) {
        if (els.emptyState) els.emptyState.classList.remove("hidden");
      } else {
        var groups = groupByPhone(recordings);
        var sorted = Array.from(groups.entries()).sort(function (a, b) {
          return parseDate(b[1][0] && b[1][0].date_created) - parseDate(a[1][0] && a[1][0].date_created);
        });
        els.recordingsList.innerHTML = sorted
          .map(function (entry) {
            var key = entry[0];
            var recs = entry[1];
            var displayPhone = key === "__unknown__" ? "Unknown" : formatPhone(recs[0] && recs[0].from);
            var rawPhone = (recs[0] && recs[0].from) || "";
            var count = recs.length;
            var notes = escapeHtml((notesByPhone[key] && notesByPhone[key].notes) || "");
            var notesBlock =
              key !== "__unknown__"
                ? "<div class=\"svm-notes-block\"><label>Notes</label>" +
                  "<textarea class=\"svm-notes notes-input\" data-phone=\"" +
                  escapeHtml(rawPhone) +
                  "\">" +
                  notes +
                  "</textarea>" +
                  "<div class=\"svm-notes-actions\"><button type=\"button\" class=\"svm-btn svm-btn-primary save-notes-btn\" data-phone=\"" +
                  escapeHtml(rawPhone) +
                  "\">Save notes</button></div></div>"
                : "";
            return (
              "<li style=\"border-bottom:1px solid #e2e8f0;padding:1rem 0\">" +
              "<details class=\"svm-details\"><summary><span style=\"font-weight:600\">" +
              escapeHtml(displayPhone) +
              "</span><span class=\"svm-muted\">" +
              count +
              " vm" +
              (count !== 1 ? "s" : "") +
              "</span></summary><div style=\"margin-left:0.5rem;border-left:2px solid #e2e8f0;padding-left:1rem\">" +
              recs.map(renderRecording).join("") +
              notesBlock +
              "</div></details></li>"
            );
          })
          .join("");
        els.recordingsList.querySelectorAll(".save-notes-btn").forEach(function (btn) {
          btn.addEventListener("click", async function () {
            var phone = btn.getAttribute("data-phone");
            var li = btn.closest("li");
            var ta = li && li.querySelector("textarea.notes-input");
            if (!ta || !phone) return;
            var key = normalizePhoneKey(phone);
            var recordId =
              notesByPhone[key] && notesByPhone[key].recordId
                ? notesByPhone[key].recordId
                : null;
            btn.disabled = true;
            var prev = btn.textContent;
            btn.textContent = "Saving…";
            try {
              var res = await fetch(apiUrl("/api/notes"), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  phone: phone,
                  notes: ta.value,
                  recordId: recordId
                })
              });
              var out = await parseJsonSafe(res);
              if (!res.ok) throw new Error(out.error || "Save failed");
              btn.textContent = "Saved";
              setTimeout(function () {
                btn.textContent = prev;
                btn.disabled = false;
              }, 1500);
            } catch (err) {
              btn.textContent = "Error";
              alert(err.message);
              btn.disabled = false;
            }
          });
        });
        if (els.recordingsArea) els.recordingsArea.classList.remove("hidden");
      }
    } catch (err) {
      if (els.errorMessage) els.errorMessage.textContent = err.message || "Error";
      if (els.errorArea) els.errorArea.classList.remove("hidden");
      logError("recordings", "load failed", err);
    } finally {
      els.loadBtn.disabled = false;
      els.btnText.textContent = "Load voicemails";
      els.btnSpinner.classList.add("hidden");
    }
  }

  function boot() {
    window.__SALES_VM_JS_EXEC__ = true;

    var els = {
      scrapedZipMapSummary: document.getElementById("scraped-zip-map-summary"),
      locationInput: document.getElementById("location-input"),
      addLocationBtn: document.getElementById("add-location-btn"),
      startQueueBtn: document.getElementById("start-queue-btn"),
      clearFinishedBtn: document.getElementById("clear-finished-btn"),
      queueSummary: document.getElementById("queue-summary"),
      jobsList: document.getElementById("jobs-list"),
      jobsEmpty: document.getElementById("jobs-empty"),
      loadBtn: document.getElementById("load-btn"),
      btnText: document.getElementById("btn-text"),
      btnSpinner: document.getElementById("btn-spinner"),
      daysSelect: document.getElementById("days"),
      errorArea: document.getElementById("error-area"),
      errorMessage: document.getElementById("error-message"),
      recordingsArea: document.getElementById("recordings-area"),
      recordingsSummary: document.getElementById("recordings-summary"),
      recordingsList: document.getElementById("recordings-list"),
      emptyState: document.getElementById("empty-state")
    };

    try {
      if (els.addLocationBtn) {
        els.addLocationBtn.addEventListener("click", function () {
          addLocationJob(els);
          processQueue(els);
        });
      }
      if (els.locationInput) {
        els.locationInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            addLocationJob(els);
            processQueue(els);
          }
        });
      }
      if (els.startQueueBtn) els.startQueueBtn.addEventListener("click", function () { processQueue(els); });
      if (els.clearFinishedBtn) {
        els.clearFinishedBtn.addEventListener("click", function () {
          jobs = jobs.filter(function (j) {
            return j.status !== "completed" && j.status !== "failed";
          });
          renderJobs(els);
        });
      }
      if (els.loadBtn) els.loadBtn.addEventListener("click", function () { loadRecordings(els); });

      renderJobs(els);
      loadScrapedZipMap(els.scrapedZipMapSummary);

      window.__SALES_VM_BOOTED__ = true;
      log("boot", "ok", { internalAppsBase: INTERNAL_APPS_BASE, geoJsonUrl: GEO_JSON_URL });
    } catch (e) {
      logError("boot", "fatal", e);
      if (els.scrapedZipMapSummary) {
        els.scrapedZipMapSummary.textContent = "Startup error — see console.";
      }
    }
  }

  function startApp() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function onReady() {
        document.removeEventListener("DOMContentLoaded", onReady);
        setTimeout(boot, 0);
      });
    } else {
      setTimeout(boot, 0);
    }
  }
  startApp();
})();
