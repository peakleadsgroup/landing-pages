/**
 * Text Timer — drip Pending status onto today's empty-status message rows
 */
(function () {
  "use strict";

  var AIRTABLE_BASE_ID = "appmBb0lzqRK9dI8v";
  var AIRTABLE_BASE_URL = "/api/airtable/v0/" + AIRTABLE_BASE_ID;
  var TABLE_MESSAGES = "tblcd9wgdPNt8RUqv";

  var F = {
    STATUS: "Status",
    CREATED: "Created",
    PHONE: "Phone",
    DIRECTION: "Direction",
    CONTENT: "Message Content",
    BUSINESS: "Business",
  };

  var LOG_PREFIX = "[TextTimer]";
  var AIRTABLE_PATCH_LIMIT = 10;

  var state = {
    step: 1,
    loading: false,
    allToday: [],
    queued: [],
    released: [],
    schedule: [],
    scheduleIndex: 0,
    timerRunning: false,
    timerPaused: false,
    timerStopped: false,
    nextTimeoutId: null,
    countdownIntervalId: null,
    nextBatchAt: null,
    sessionReleased: [],
    activityLog: [],
  };

  var els = {};

  function log(msg, data) {
    if (data !== undefined) console.log(LOG_PREFIX, msg, data);
    else console.log(LOG_PREFIX, msg);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseDate(iso) {
    if (!iso) return 0;
    var t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  }

  function formatTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatPhone(p) {
    if (!p) return "—";
    var d = String(p).replace(/\D/g, "");
    while (d.length > 10 && d.charAt(0) === "1") d = d.slice(1);
    if (d.length === 10) {
      return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    }
    return String(p);
  }

  function isToday(iso) {
    if (!iso) return false;
    return new Date(iso).toDateString() === new Date().toDateString();
  }

  function statusEmpty(rec) {
    var s = rec.fields && rec.fields[F.STATUS];
    return s == null || String(s).trim() === "";
  }

  function statusClass(status) {
    if (status === "Pending") return "tt-status-pending";
    if (status === "Success") return "tt-status-success";
    if (status === "Failed") return "tt-status-failed";
    return "tt-status-empty";
  }

  function showToast(kind, message) {
    if (!els.toastArea) return;
    var el = document.createElement("div");
    el.className = "tt-toast tt-toast-" + kind;
    el.textContent = message;
    els.toastArea.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4500);
  }

  function addActivity(message) {
    var entry = { at: new Date(), message: message };
    state.activityLog.unshift(entry);
    if (state.activityLog.length > 100) state.activityLog.length = 100;
    renderActivityLog();
  }

  async function fetchAirtableJson(url, options) {
    var res = await fetch(url, options);
    var text = await res.text();
    var data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      throw new Error("Invalid JSON from Airtable (" + res.status + ")");
    }
    if (!res.ok) {
      var err = data && data.error;
      var msg =
        (typeof err === "string" && err) ||
        (err && err.message) ||
        data.message ||
        text ||
        res.statusText;
      throw new Error(typeof msg === "string" ? msg : "Airtable error " + res.status);
    }
    return data;
  }

  function todayFilterFormula() {
    return "IS_SAME({" + F.CREATED + "}, TODAY(), 'day')";
  }

  async function fetchAllRecords(filterFormula) {
    var url = AIRTABLE_BASE_URL + "/" + encodeURIComponent(TABLE_MESSAGES);
    if (filterFormula) {
      url += "?filterByFormula=" + encodeURIComponent(filterFormula);
    }
    var records = [];
    var offset = null;
    var safety = 0;
    while (safety < 100) {
      safety += 1;
      var pageUrl = url;
      if (offset) {
        pageUrl += (pageUrl.indexOf("?") >= 0 ? "&" : "?") + "offset=" + encodeURIComponent(offset);
      }
      var data = await fetchAirtableJson(pageUrl);
      records = records.concat(data.records || []);
      if (!data.offset) break;
      offset = data.offset;
    }
    return records;
  }

  async function patchRecords(updates) {
    if (!updates.length) return { records: [] };
    var body = JSON.stringify({
      records: updates.map(function (u) {
        return { id: u.id, fields: u.fields };
      }),
    });
    return fetchAirtableJson(AIRTABLE_BASE_URL + "/" + encodeURIComponent(TABLE_MESSAGES), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body,
    });
  }

  function categorizeRecords(records) {
    var queued = [];
    var released = [];
    records.forEach(function (rec) {
      if (!isToday(rec.fields && rec.fields[F.CREATED])) return;
      if (statusEmpty(rec)) queued.push(rec);
      else released.push(rec);
    });
    queued.sort(function (a, b) {
      return parseDate(a.fields[F.CREATED]) - parseDate(b.fields[F.CREATED]);
    });
    released.sort(function (a, b) {
      return parseDate(b.fields[F.CREATED]) - parseDate(a.fields[F.CREATED]);
    });
    return { queued: queued, released: released };
  }

  function getConfig() {
    var intervalMin = parseInt(els.cfgInterval && els.cfgInterval.value, 10);
    var batchMin = parseInt(els.cfgBatchMin && els.cfgBatchMin.value, 10);
    var batchMax = parseInt(els.cfgBatchMax && els.cfgBatchMax.value, 10);
    if (isNaN(intervalMin) || intervalMin < 1) intervalMin = 3;
    if (isNaN(batchMin) || batchMin < 1) batchMin = 5;
    if (isNaN(batchMax) || batchMax < 1) batchMax = 10;
    if (batchMin > batchMax) {
      var tmp = batchMin;
      batchMin = batchMax;
      batchMax = tmp;
    }
    batchMin = Math.min(batchMin, AIRTABLE_PATCH_LIMIT);
    batchMax = Math.min(batchMax, AIRTABLE_PATCH_LIMIT);
    return {
      intervalMs: intervalMin * 60 * 1000,
      batchMin: batchMin,
      batchMax: batchMax,
      firstImmediate: !!(els.cfgFirstImmediate && els.cfgFirstImmediate.checked),
    };
  }

  function randomBatchSize(min, max) {
    if (min >= max) return min;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function buildScheduleFromQueue(queue, cfg, startAt) {
    var remaining = queue.slice();
    var batches = [];
    var batchNum = 0;
    var cursor = new Date(startAt).getTime();

    if (!cfg.firstImmediate) {
      cursor += cfg.intervalMs;
    }

    while (remaining.length) {
      var size = Math.min(randomBatchSize(cfg.batchMin, cfg.batchMax), remaining.length);
      batches.push({
        index: batchNum,
        scheduledAt: new Date(cursor),
        records: remaining.splice(0, size),
        status: "scheduled",
      });
      batchNum += 1;
      cursor += cfg.intervalMs;
    }

    return batches;
  }

  function recordRowCells(rec) {
    var f = rec.fields || {};
    return (
      "<td>" +
      escapeHtml(formatTime(f[F.CREATED])) +
      "</td>" +
      "<td>" +
      escapeHtml(formatPhone(f[F.PHONE])) +
      "</td>" +
      "<td>" +
      escapeHtml(f[F.DIRECTION] || "—") +
      "</td>" +
      '<td class="msg-cell" title="' +
      escapeHtml(f[F.CONTENT] || "") +
      '">' +
      escapeHtml((f[F.CONTENT] || "").slice(0, 80)) +
      "</td>" +
      "<td>" +
      escapeHtml(f[F.BUSINESS] || "—") +
      "</td>"
    );
  }

  function renderQueueTable() {
    if (els.statQueued) els.statQueued.textContent = String(state.queued.length);
    if (els.statPending) {
      els.statPending.textContent = String(
        state.released.filter(function (r) {
          return r.fields[F.STATUS] === "Pending";
        }).length
      );
    }
    if (els.statSuccess) {
      els.statSuccess.textContent = String(
        state.released.filter(function (r) {
          return r.fields[F.STATUS] === "Success";
        }).length
      );
    }
    if (els.statFailed) {
      els.statFailed.textContent = String(
        state.released.filter(function (r) {
          return r.fields[F.STATUS] === "Failed";
        }).length
      );
    }

    if (els.queueCountLabel) {
      els.queueCountLabel.textContent =
        state.queued.length + " record" + (state.queued.length === 1 ? "" : "s");
    }
    if (els.releasedCountLabel) {
      els.releasedCountLabel.textContent =
        state.released.length + " record" + (state.released.length === 1 ? "" : "s");
    }

    if (els.queueTbody) {
      if (state.queued.length === 0) {
        els.queueTbody.innerHTML = "";
        if (els.queueEmpty) els.queueEmpty.classList.remove("hidden");
      } else {
        if (els.queueEmpty) els.queueEmpty.classList.add("hidden");
        els.queueTbody.innerHTML = state.queued
          .map(function (rec) {
            return "<tr>" + recordRowCells(rec) + "</tr>";
          })
          .join("");
      }
    }

    if (els.releasedTbody) {
      if (state.released.length === 0) {
        els.releasedTbody.innerHTML = "";
        if (els.releasedEmpty) els.releasedEmpty.classList.remove("hidden");
      } else {
        if (els.releasedEmpty) els.releasedEmpty.classList.add("hidden");
        els.releasedTbody.innerHTML = state.released
          .slice(0, 50)
          .map(function (rec) {
            var f = rec.fields || {};
            var st = f[F.STATUS] || "—";
            return (
              "<tr>" +
              "<td>" +
              escapeHtml(formatTime(f[F.CREATED])) +
              "</td>" +
              "<td>" +
              escapeHtml(formatPhone(f[F.PHONE])) +
              "</td>" +
              '<td><span class="' +
              statusClass(st) +
              '">' +
              escapeHtml(st) +
              "</span></td>" +
              '<td class="msg-cell" title="' +
              escapeHtml(f[F.CONTENT] || "") +
              '">' +
              escapeHtml((f[F.CONTENT] || "").slice(0, 80)) +
              "</td></tr>"
            );
          })
          .join("");
      }
    }

    if (els.buildScheduleBtn) {
      els.buildScheduleBtn.disabled = state.queued.length === 0;
    }
  }

  function renderPreview() {
    var cfg = getConfig();
    var totalMsgs = state.schedule.reduce(function (n, b) {
      return n + b.records.length;
    }, 0);
    var intervalMin = Math.round(cfg.intervalMs / 60000);

    if (els.previewSummaryText) {
      els.previewSummaryText.textContent =
        state.schedule.length +
        " batch" +
        (state.schedule.length === 1 ? "" : "es") +
        " covering " +
        totalMsgs +
        " message" +
        (totalMsgs === 1 ? "" : "s");
    }

    if (els.previewStats) {
      var firstAt = state.schedule.length ? formatDateTime(state.schedule[0].scheduledAt) : "—";
      var lastAt = state.schedule.length
        ? formatDateTime(state.schedule[state.schedule.length - 1].scheduledAt)
        : "—";
      els.previewStats.innerHTML =
        "<li>First release: <strong>" +
        escapeHtml(firstAt) +
        "</strong></li>" +
        "<li>Last release: <strong>" +
        escapeHtml(lastAt) +
        "</strong></li>" +
        "<li>Interval: every <strong>" +
        intervalMin +
        " min</strong>, " +
        cfg.batchMin +
        "–" +
        cfg.batchMax +
        " per batch</li>";
    }

    if (!els.batchList) return;

    els.batchList.innerHTML = state.schedule
      .map(function (batch, i) {
        var rows = batch.records
          .map(function (rec) {
            return "<tr>" + recordRowCells(rec) + "</tr>";
          })
          .join("");
        return (
          '<div class="tt-batch-card">' +
          '<div class="tt-batch-card-header">' +
          "<span>Batch " +
          (i + 1) +
          " · " +
          batch.records.length +
          " message" +
          (batch.records.length === 1 ? "" : "s") +
          "</span>" +
          '<span class="tt-batch-card-time">' +
          escapeHtml(formatDateTime(batch.scheduledAt)) +
          "</span>" +
          "</div>" +
          '<div class="tt-batch-card-body">' +
          '<div class="tt-table-wrap tt-table-wrap-short"><table class="tt-table"><thead><tr>' +
          "<th>Created</th><th>Phone</th><th>Direction</th><th>Message</th><th>Business</th>" +
          "</tr></thead><tbody>" +
          rows +
          "</tbody></table></div></div></div>"
        );
      })
      .join("");
  }

  function renderActivityLog() {
    if (!els.activityLog) return;
    els.activityLog.innerHTML = state.activityLog
      .map(function (entry) {
        return (
          "<li><span class=\"tt-log-time\">" +
          escapeHtml(formatTime(entry.at.toISOString())) +
          "</span>" +
          escapeHtml(entry.message) +
          "</li>"
        );
      })
      .join("");
  }

  function renderRunPanel() {
    var completed = state.schedule.filter(function (b) {
      return b.status === "done";
    }).length;
    var total = state.schedule.length;
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    if (els.runProgressBar) els.runProgressBar.style.width = pct + "%";
    if (els.runProgressText) {
      els.runProgressText.textContent =
        completed + " / " + total + " batches complete · " + state.sessionReleased.length + " messages released";
    }

    if (els.releasedSessionMeta) {
      els.releasedSessionMeta.textContent =
        state.sessionReleased.length + " message" + (state.sessionReleased.length === 1 ? "" : "s");
    }
    if (els.releasedSessionList) {
      els.releasedSessionList.innerHTML = state.sessionReleased
        .slice(0, 20)
        .map(function (item) {
          return (
            "<li><strong>" +
            escapeHtml(formatPhone(item.phone)) +
            "</strong> · " +
            escapeHtml(formatTime(item.releasedAt)) +
            (item.content ? " · " + escapeHtml(item.content.slice(0, 40)) : "") +
            "</li>"
          );
        })
        .join("");
      if (!state.sessionReleased.length) {
        els.releasedSessionList.innerHTML = '<li class="tt-muted">None yet</li>';
      }
    }

    var pendingBatches = state.schedule.filter(function (b) {
      return b.status === "scheduled";
    });
    var nextBatch = pendingBatches[0] || null;

    if (els.upnextMeta) {
      if (!nextBatch) {
        els.upnextMeta.textContent = "No batches remaining";
      } else {
        els.upnextMeta.textContent =
          "Batch " +
          (nextBatch.index + 1) +
          " · " +
          nextBatch.records.length +
          " messages · " +
          formatDateTime(nextBatch.scheduledAt);
      }
    }

    if (els.upnextDetail) {
      if (!nextBatch) {
        els.upnextDetail.innerHTML = '<p class="tt-muted">All batches have been released.</p>';
      } else {
        els.upnextDetail.innerHTML =
          '<table class="tt-table"><thead><tr><th>Phone</th><th>Message</th></tr></thead><tbody>' +
          nextBatch.records
            .map(function (rec) {
              var f = rec.fields || {};
              return (
                "<tr><td>" +
                escapeHtml(formatPhone(f[F.PHONE])) +
                '</td><td class="msg-cell">' +
                escapeHtml((f[F.CONTENT] || "").slice(0, 60)) +
                "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table>";
      }
    }

    if (els.scheduledMeta) {
      var rest = pendingBatches.length > 1 ? pendingBatches.length - 1 : 0;
      els.scheduledMeta.textContent = rest + " batch" + (rest === 1 ? "" : "es") + " after the next one";
    }

    if (els.scheduledList) {
      var later = pendingBatches.slice(1);
      els.scheduledList.innerHTML = later
        .map(function (batch) {
          return (
            "<li><strong>Batch " +
            (batch.index + 1) +
            "</strong> · " +
            batch.records.length +
            " msgs · " +
            escapeHtml(formatDateTime(batch.scheduledAt)) +
            "</li>"
          );
        })
        .join("");
      if (!later.length) {
        els.scheduledList.innerHTML = '<li class="tt-muted">Nothing else queued</li>';
      }
    }

    updateCountdownDisplay();
    updateRunBanner();
  }

  function updateRunBanner() {
    if (!els.runBanner) return;
    els.runBanner.classList.remove("paused", "complete");
    if (state.timerStopped && state.scheduleIndex >= state.schedule.length) {
      els.runBanner.classList.add("complete");
      if (els.runStateLabel) els.runStateLabel.textContent = "Complete";
    } else if (state.timerPaused) {
      els.runBanner.classList.add("paused");
      if (els.runStateLabel) els.runStateLabel.textContent = "Paused";
    } else if (state.timerRunning) {
      if (els.runStateLabel) els.runStateLabel.textContent = "Running";
    }
  }

  function updateCountdownDisplay() {
    if (!els.runCountdown) return;
    if (state.timerStopped && state.scheduleIndex >= state.schedule.length) {
      els.runCountdown.textContent = "All batches released";
      return;
    }
    if (state.timerPaused) {
      els.runCountdown.textContent = "Timer paused — resume to continue";
      return;
    }
    if (!state.nextBatchAt) {
      els.runCountdown.textContent = "Preparing…";
      return;
    }
    var ms = state.nextBatchAt.getTime() - Date.now();
    if (ms <= 0) {
      els.runCountdown.textContent = "Releasing now…";
      return;
    }
    var sec = Math.ceil(ms / 1000);
    var min = Math.floor(sec / 60);
    var remSec = sec % 60;
    els.runCountdown.textContent =
      "Next batch in " + (min > 0 ? min + "m " : "") + remSec + "s · " + formatDateTime(state.nextBatchAt);
  }

  function setStep(step) {
    state.step = step;
    [1, 2, 3].forEach(function (n) {
      var panel = document.getElementById("panel-step-" + n);
      if (panel) panel.classList.toggle("hidden", n !== step);
    });
    document.querySelectorAll(".tt-step-item").forEach(function (el) {
      var s = parseInt(el.getAttribute("data-step"), 10);
      el.classList.toggle("active", s === step);
      el.classList.toggle("done", s < step);
    });
  }

  async function loadData(silent) {
    if (state.loading || state.timerRunning) return;
    state.loading = true;
    if (els.loadStatus) els.loadStatus.textContent = "Loading today's messages…";
    if (els.refreshBtn) els.refreshBtn.disabled = true;
    if (els.buildScheduleBtn) els.buildScheduleBtn.disabled = true;

    try {
      var records = await fetchAllRecords(todayFilterFormula());
      state.allToday = records;
      var split = categorizeRecords(records);
      state.queued = split.queued;
      state.released = split.released;
      renderQueueTable();
      if (els.loadStatus) {
        els.loadStatus.textContent =
          "Showing " +
          state.allToday.length +
          " record" +
          (state.allToday.length === 1 ? "" : "s") +
          " created today.";
      }
      if (!silent) showToast("success", "Loaded " + state.allToday.length + " records for today");
    } catch (err) {
      log("load failed", err);
      if (els.loadStatus) els.loadStatus.textContent = "Load failed: " + (err.message || "error");
      showToast("error", err.message || "Failed to load messages");
    } finally {
      state.loading = false;
      if (els.refreshBtn) els.refreshBtn.disabled = false;
    }
  }

  function onBuildSchedule() {
    if (!state.queued.length) return;
    var cfg = getConfig();
    state.schedule = buildScheduleFromQueue(state.queued, cfg, new Date());
    renderPreview();
    setStep(2);
  }

  function clearTimers() {
    if (state.nextTimeoutId) {
      clearTimeout(state.nextTimeoutId);
      state.nextTimeoutId = null;
    }
    if (state.countdownIntervalId) {
      clearInterval(state.countdownIntervalId);
      state.countdownIntervalId = null;
    }
  }

  function onBeforeUnload(e) {
    if (state.timerRunning && !state.timerStopped) {
      e.preventDefault();
      e.returnValue = "Text timer is running. Closing may interrupt scheduled releases.";
      return e.returnValue;
    }
  }

  async function releaseBatch(batch) {
    var chunks = [];
    for (var i = 0; i < batch.records.length; i += AIRTABLE_PATCH_LIMIT) {
      chunks.push(batch.records.slice(i, i + AIRTABLE_PATCH_LIMIT));
    }

    for (var c = 0; c < chunks.length; c++) {
      var chunk = chunks[c];
      var updates = chunk.map(function (rec) {
        return { id: rec.id, fields: { Status: "Pending" } };
      });
      await patchRecords(updates);

      chunk.forEach(function (rec) {
        rec.fields[F.STATUS] = "Pending";
        var f = rec.fields || {};
        state.sessionReleased.unshift({
          id: rec.id,
          phone: f[F.PHONE],
          content: f[F.CONTENT] || "",
          releasedAt: new Date().toISOString(),
        });
        addActivity(
          "Set Pending: " +
            formatPhone(f[F.PHONE]) +
            (f[F.CONTENT] ? ' — "' + String(f[F.CONTENT]).slice(0, 50) + '"' : "")
        );
      });
    }

    batch.status = "done";
    batch.releasedAt = new Date();
    state.scheduleIndex += 1;
    renderRunPanel();
  }

  function scheduleNextBatch() {
    clearTimers();
    if (state.timerStopped) return;

    var next = state.schedule.find(function (b) {
      return b.status === "scheduled";
    });
    if (!next) {
      finishTimer();
      return;
    }

    state.nextBatchAt = next.scheduledAt;
    renderRunPanel();

    var delay = Math.max(0, next.scheduledAt.getTime() - Date.now());

    state.countdownIntervalId = setInterval(updateCountdownDisplay, 1000);

    state.nextTimeoutId = setTimeout(async function () {
      if (state.timerPaused || state.timerStopped) return;
      try {
        addActivity(
          "Releasing batch " +
            (next.index + 1) +
            " (" +
            next.records.length +
            " messages)…"
        );
        await releaseBatch(next);
        showToast("success", "Batch " + (next.index + 1) + " released (" + next.records.length + " messages)");
      } catch (err) {
        log("batch release failed", err);
        addActivity("Batch " + (next.index + 1) + " failed: " + (err.message || "error"));
        showToast("error", err.message || "Failed to release batch");
        state.timerPaused = true;
        updateRunBanner();
        if (els.pauseBtn) els.pauseBtn.textContent = "Resume";
        return;
      }
      scheduleNextBatch();
    }, delay);
  }

  function finishTimer() {
    clearTimers();
    state.timerRunning = false;
    state.timerStopped = true;
    state.nextBatchAt = null;
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (els.runComplete) els.runComplete.classList.remove("hidden");
    if (els.runCompleteText) {
      els.runCompleteText.textContent =
        "Done. Released " +
        state.sessionReleased.length +
        " message" +
        (state.sessionReleased.length === 1 ? "" : "s") +
        " across " +
        state.schedule.filter(function (b) {
          return b.status === "done";
        }).length +
        " batches.";
    }
    if (els.pauseBtn) els.pauseBtn.disabled = true;
    if (els.stopBtn) els.stopBtn.disabled = true;
    renderRunPanel();
    loadData(true);
  }

  function startTimer() {
    if (!state.schedule.length) return;
    if (
      !window.confirm(
        "Start the timer?\n\n" +
          state.schedule.length +
          " batches will be released on schedule. Keep this tab open until complete."
      )
    ) {
      return;
    }

    state.timerRunning = true;
    state.timerPaused = false;
    state.timerStopped = false;
    state.scheduleIndex = 0;
    state.sessionReleased = [];
    state.activityLog = [];
    state.schedule.forEach(function (b) {
      b.status = "scheduled";
      b.releasedAt = null;
    });

    if (els.runComplete) els.runComplete.classList.add("hidden");
    if (els.pauseBtn) {
      els.pauseBtn.disabled = false;
      els.pauseBtn.textContent = "Pause";
    }
    if (els.stopBtn) els.stopBtn.disabled = false;

    addActivity("Timer started — " + state.schedule.length + " batches scheduled");
    setStep(3);
    window.addEventListener("beforeunload", onBeforeUnload);
    scheduleNextBatch();
    renderRunPanel();
  }

  function pauseTimer() {
    if (!state.timerRunning || state.timerStopped) return;
    if (state.timerPaused) {
      state.timerPaused = false;
      if (els.pauseBtn) els.pauseBtn.textContent = "Pause";
      addActivity("Timer resumed");
      scheduleNextBatch();
    } else {
      state.timerPaused = true;
      clearTimers();
      if (els.pauseBtn) els.pauseBtn.textContent = "Resume";
      addActivity("Timer paused");
      updateRunBanner();
      updateCountdownDisplay();
    }
  }

  function stopTimer() {
    if (!state.timerRunning) return;
    if (!window.confirm("Stop the timer? Remaining batches will not be released.")) return;
    state.timerStopped = true;
    state.timerRunning = false;
    state.timerPaused = false;
    clearTimers();
    window.removeEventListener("beforeunload", onBeforeUnload);
    addActivity("Timer stopped by user");
    if (els.runComplete) els.runComplete.classList.remove("hidden");
    if (els.runCompleteText) {
      var doneCount = state.schedule.filter(function (b) {
        return b.status === "done";
      }).length;
      els.runCompleteText.textContent =
        "Stopped. Released " +
        state.sessionReleased.length +
        " message(s) in " +
        doneCount +
        " batch(es). Remaining batches were skipped.";
    }
    if (els.pauseBtn) els.pauseBtn.disabled = true;
    if (els.stopBtn) els.stopBtn.disabled = true;
    renderRunPanel();
  }

  function bindEvents() {
    if (els.refreshBtn) {
      els.refreshBtn.addEventListener("click", function () {
        loadData(false);
      });
    }
    if (els.buildScheduleBtn) {
      els.buildScheduleBtn.addEventListener("click", onBuildSchedule);
    }
    if (els.backToReviewBtn) {
      els.backToReviewBtn.addEventListener("click", function () {
        setStep(1);
      });
    }
    if (els.startTimerBtn) {
      els.startTimerBtn.addEventListener("click", startTimer);
    }
    if (els.pauseBtn) {
      els.pauseBtn.addEventListener("click", pauseTimer);
    }
    if (els.stopBtn) {
      els.stopBtn.addEventListener("click", stopTimer);
    }
    if (els.runDoneBtn) {
      els.runDoneBtn.addEventListener("click", function () {
        setStep(1);
        loadData(true);
      });
    }

    ["cfgInterval", "cfgBatchMin", "cfgBatchMax", "cfgFirstImmediate"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", function () {
          if (state.step === 2 && state.queued.length) {
            state.schedule = buildScheduleFromQueue(state.queued, getConfig(), new Date());
            renderPreview();
          }
        });
      }
    });
  }

  function cacheElements() {
    els.toastArea = document.getElementById("toast-area");
    els.refreshBtn = document.getElementById("refresh-btn");
    els.loadStatus = document.getElementById("load-status");
    els.statQueued = document.getElementById("stat-queued");
    els.statPending = document.getElementById("stat-pending");
    els.statSuccess = document.getElementById("stat-success");
    els.statFailed = document.getElementById("stat-failed");
    els.cfgInterval = document.getElementById("cfg-interval");
    els.cfgBatchMin = document.getElementById("cfg-batch-min");
    els.cfgBatchMax = document.getElementById("cfg-batch-max");
    els.cfgFirstImmediate = document.getElementById("cfg-first-immediate");
    els.queueCountLabel = document.getElementById("queue-count-label");
    els.queueTbody = document.getElementById("queue-tbody");
    els.queueEmpty = document.getElementById("queue-empty");
    els.releasedCountLabel = document.getElementById("released-count-label");
    els.releasedTbody = document.getElementById("released-tbody");
    els.releasedEmpty = document.getElementById("released-empty");
    els.buildScheduleBtn = document.getElementById("build-schedule-btn");
    els.previewSummaryText = document.getElementById("preview-summary-text");
    els.previewStats = document.getElementById("preview-stats");
    els.batchList = document.getElementById("batch-list");
    els.backToReviewBtn = document.getElementById("back-to-review-btn");
    els.startTimerBtn = document.getElementById("start-timer-btn");
    els.runBanner = document.getElementById("run-banner");
    els.runStateLabel = document.getElementById("run-state-label");
    els.runCountdown = document.getElementById("run-countdown");
    els.pauseBtn = document.getElementById("pause-btn");
    els.stopBtn = document.getElementById("stop-btn");
    els.runProgressBar = document.getElementById("run-progress-bar");
    els.runProgressText = document.getElementById("run-progress-text");
    els.releasedSessionMeta = document.getElementById("released-session-meta");
    els.releasedSessionList = document.getElementById("released-session-list");
    els.upnextMeta = document.getElementById("upnext-meta");
    els.upnextDetail = document.getElementById("upnext-detail");
    els.scheduledMeta = document.getElementById("scheduled-meta");
    els.scheduledList = document.getElementById("scheduled-list");
    els.activityLog = document.getElementById("activity-log");
    els.runComplete = document.getElementById("run-complete");
    els.runCompleteText = document.getElementById("run-complete-text");
    els.runDoneBtn = document.getElementById("run-done-btn");
  }

  function boot() {
    cacheElements();
    bindEvents();
    loadData(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
