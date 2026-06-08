/**
 * Messages — InternalApps SMS thread viewer + mass drip send
 * Creates Pending Outbound rows in Airtable; polling router sends SMS.
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
    TAG: "Tag",
    MESSAGE_TYPE: "Message Type",
  };

  var TAG_OPTIONS = ["360 College Tour", "AMOUR"];
  var REFRESH_MS = 30000;
  var LOG_PREFIX = "[Messages]";

  var state = {
    business: "PLG",
    records: [],
    threads: [],
    selectedPhoneKey: null,
    loading: false,
    refreshTimer: null,
    dripRunning: false,
    dripCancelled: false,
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

  function normalizePhoneKey(p) {
    if (p == null || p === "") return "";
    var d = String(p).replace(/\D/g, "");
    if (d.length === 11 && d[0] === "1") d = d.slice(1);
    return d.length >= 10 ? d.slice(-10) : d;
  }

  function formatPhoneDisplay(key) {
    if (!key || key.length !== 10) return key || "—";
    return "(" + key.slice(0, 3) + ") " + key.slice(3, 6) + "-" + key.slice(6);
  }

  function phoneForAirtable(key) {
    if (!key || key.length !== 10) return key;
    return "+1" + key;
  }

  function parseDate(iso) {
    if (!iso) return 0;
    var t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  }

  function formatRelativeTime(iso) {
    if (!iso) return "";
    var diff = Date.now() - parseDate(iso);
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function formatDayLabel(iso) {
    var d = new Date(iso);
    var today = new Date();
    var yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function fieldAsArray(v) {
    if (v == null) return [];
    if (Array.isArray(v)) return v.map(String);
    return [String(v)];
  }

  function tagsFromRecord(rec) {
    var raw = rec.fields && rec.fields[F.TAG];
    return fieldAsArray(raw);
  }

  function tagsForThread(messages) {
    var set = {};
    messages.forEach(function (m) {
      tagsFromRecord(m).forEach(function (t) {
        set[t] = true;
      });
    });
    return Object.keys(set);
  }

  function threadHasResponded(messages) {
    if (!messages.length) return false;
    var sorted = messages.slice().sort(function (a, b) {
      return parseDate(a.fields[F.CREATED]) - parseDate(b.fields[F.CREATED]);
    });
    var last = sorted[sorted.length - 1];
    if (last.fields[F.DIRECTION] === "Inbound") return true;
    var lastOutboundTime = null;
    for (var i = 0; i < sorted.length; i++) {
      var m = sorted[i];
      if (m.fields[F.DIRECTION] === "Outbound") {
        lastOutboundTime = parseDate(m.fields[F.CREATED]);
      } else if (m.fields[F.DIRECTION] === "Inbound" && lastOutboundTime != null) {
        if (parseDate(m.fields[F.CREATED]) > lastOutboundTime) return true;
      }
    }
    return false;
  }

  function buildThreads(records) {
    var byPhone = {};
    records.forEach(function (rec) {
      var key = normalizePhoneKey(rec.fields && rec.fields[F.PHONE]);
      if (!key) return;
      if (!byPhone[key]) byPhone[key] = [];
      byPhone[key].push(rec);
    });

    var threads = Object.keys(byPhone).map(function (key) {
      var messages = byPhone[key].slice().sort(function (a, b) {
        return parseDate(a.fields[F.CREATED]) - parseDate(b.fields[F.CREATED]);
      });
      var last = messages[messages.length - 1];
      var lastFields = last.fields || {};
      return {
        phoneKey: key,
        displayPhone: formatPhoneDisplay(key),
        rawPhone: lastFields[F.PHONE] || phoneForAirtable(key),
        messages: messages,
        lastCreated: lastFields[F.CREATED],
        lastPreview: (lastFields[F.CONTENT] || "").slice(0, 80),
        lastDirection: lastFields[F.DIRECTION],
        tags: tagsForThread(messages),
        hasResponded: threadHasResponded(messages),
      };
    });

    threads.sort(function (a, b) {
      return parseDate(b.lastCreated) - parseDate(a.lastCreated);
    });
    return threads;
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

  async function createOutboundRecord(fields) {
    var body = JSON.stringify({ records: [{ fields: fields }] });
    return fetchAirtableJson(AIRTABLE_BASE_URL + "/" + encodeURIComponent(TABLE_MESSAGES), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body,
    });
  }

  function businessFilterFormula(business) {
    return "{" + F.BUSINESS + '}="' + business.replace(/"/g, '\\"') + '"';
  }

  function showToast(kind, message) {
    if (!els.toastArea) return;
    var el = document.createElement("div");
    el.className = "msg-toast msg-toast-" + kind;
    el.textContent = message;
    els.toastArea.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 4500);
  }

  function getFilteredThreads() {
    var search = (els.threadSearch && els.threadSearch.value.trim().toLowerCase()) || "";
    var responseFilter = els.threadResponseFilter ? els.threadResponseFilter.value : "all";

    return state.threads.filter(function (t) {
      if (responseFilter === "responded" && !t.hasResponded) return false;
      if (responseFilter === "no-response" && t.hasResponded) return false;
      if (!search) return true;
      if (t.displayPhone.toLowerCase().indexOf(search) >= 0) return true;
      if (t.phoneKey.indexOf(search.replace(/\D/g, "")) >= 0) return true;
      if (t.lastPreview.toLowerCase().indexOf(search) >= 0) return true;
      return t.messages.some(function (m) {
        return String(m.fields[F.CONTENT] || "")
          .toLowerCase()
          .indexOf(search) >= 0;
      });
    });
  }

  function renderThreadList() {
    var filtered = getFilteredThreads();
    if (els.threadCount) {
      els.threadCount.textContent =
        filtered.length + " conversation" + (filtered.length === 1 ? "" : "s") + " · " + state.business;
    }
    if (!els.threadList) return;

    if (filtered.length === 0) {
      els.threadList.innerHTML = "";
      if (els.threadEmpty) els.threadEmpty.classList.remove("hidden");
      return;
    }
    if (els.threadEmpty) els.threadEmpty.classList.add("hidden");

    els.threadList.innerHTML = filtered
      .map(function (t) {
        var active = t.phoneKey === state.selectedPhoneKey ? " active" : "";
        var badgeClass = t.hasResponded ? "msg-badge-responded" : "msg-badge-awaiting";
        var badgeText = t.hasResponded ? "Responded" : "Awaiting";
        var prefix = t.lastDirection === "Outbound" ? "You: " : "";
        return (
          '<li><button type="button" class="msg-thread-item' +
          active +
          '" data-phone-key="' +
          escapeHtml(t.phoneKey) +
          '">' +
          '<div class="msg-thread-phone">' +
          escapeHtml(t.displayPhone) +
          "</div>" +
          '<p class="msg-thread-preview">' +
          escapeHtml(prefix + t.lastPreview) +
          "</p>" +
          '<div class="msg-thread-meta">' +
          '<span class="msg-badge ' +
          badgeClass +
          '">' +
          badgeText +
          "</span>" +
          '<span class="msg-thread-time">' +
          escapeHtml(formatRelativeTime(t.lastCreated)) +
          "</span>" +
          "</div></button></li>"
        );
      })
      .join("");
  }

  function statusLabel(status) {
    if (status === "Pending") return '<span class="msg-status-pending">Pending</span>';
    if (status === "Failed") return '<span class="msg-status-failed">Failed</span>';
    if (status === "Success") return '<span class="msg-status-success">Sent</span>';
    return "";
  }

  function renderChat() {
    var thread = state.threads.find(function (t) {
      return t.phoneKey === state.selectedPhoneKey;
    });

    if (!thread) {
      if (els.chatPlaceholder) els.chatPlaceholder.classList.remove("hidden");
      if (els.chatActive) els.chatActive.classList.add("hidden");
      return;
    }

    if (els.chatPlaceholder) els.chatPlaceholder.classList.add("hidden");
    if (els.chatActive) els.chatActive.classList.remove("hidden");

    if (els.chatPhone) els.chatPhone.textContent = thread.displayPhone;

    if (els.chatTags) {
      els.chatTags.innerHTML = thread.tags.length
        ? thread.tags.map(function (tag) {
            return '<span class="msg-tag">' + escapeHtml(tag) + "</span>";
          }).join("")
        : "";
    }

    if (els.chatResponseBadge) {
      els.chatResponseBadge.className =
        "msg-badge " + (thread.hasResponded ? "msg-badge-responded" : "msg-badge-awaiting");
      els.chatResponseBadge.textContent = thread.hasResponded ? "Responded" : "Awaiting reply";
    }

    if (!els.messageScroll) return;

    var html = [];
    var lastDay = "";
    thread.messages.forEach(function (m) {
      var f = m.fields || {};
      var created = f[F.CREATED];
      var day = formatDayLabel(created);
      if (day !== lastDay) {
        html.push('<div class="msg-day-divider">' + escapeHtml(day) + "</div>");
        lastDay = day;
      }
      var dir = f[F.DIRECTION] === "Inbound" ? "inbound" : "outbound";
      var meta = formatTime(created);
      if (dir === "outbound" && f[F.STATUS]) {
        meta += " · " + statusLabel(f[F.STATUS]);
      }
      html.push(
        '<div class="msg-bubble-row ' +
          dir +
          '">' +
          '<div class="msg-bubble">' +
          escapeHtml(f[F.CONTENT] || "") +
          "</div>" +
          '<div class="msg-bubble-meta">' +
          meta +
          "</div></div>"
      );
    });

    els.messageScroll.innerHTML = html.join("");
    els.messageScroll.scrollTop = els.messageScroll.scrollHeight;
  }

  function renderAll() {
    renderThreadList();
    renderChat();
  }

  async function loadMessages(silent) {
    if (state.loading) return;
    state.loading = true;
    if (!silent && els.threadCount) els.threadCount.textContent = "Loading…";
    if (els.refreshBtn) els.refreshBtn.disabled = true;

    try {
      var records = await fetchAllRecords(businessFilterFormula(state.business));
      state.records = records;
      state.threads = buildThreads(records);

      if (
        state.selectedPhoneKey &&
        !state.threads.some(function (t) {
          return t.phoneKey === state.selectedPhoneKey;
        })
      ) {
        state.selectedPhoneKey = null;
      }

      renderAll();
      if (!silent) showToast("success", "Loaded " + state.threads.length + " conversations");
    } catch (err) {
      log("load failed", err);
      showToast("error", err.message || "Failed to load messages");
      if (els.threadCount) els.threadCount.textContent = "Load failed";
    } finally {
      state.loading = false;
      if (els.refreshBtn) els.refreshBtn.disabled = false;
      updateMassPreview();
    }
  }

  function selectThread(phoneKey) {
    state.selectedPhoneKey = phoneKey;
    renderAll();
  }

  async function sendSingleReply(content) {
    var thread = state.threads.find(function (t) {
      return t.phoneKey === state.selectedPhoneKey;
    });
    if (!thread) return;

    var fields = {
      Phone: thread.rawPhone || phoneForAirtable(thread.phoneKey),
      Direction: "Outbound",
      Status: "Pending",
      "Message Content": content,
      Business: state.business,
      "Message Type": "Text",
    };
    if (thread.tags.length) fields[F.TAG] = thread.tags;

    if (els.composeSend) els.composeSend.disabled = true;
    try {
      var result = await createOutboundRecord(fields);
      var created = result.records && result.records[0];
      if (created) {
        state.records.push(created);
        state.threads = buildThreads(state.records);
        if (els.composeInput) els.composeInput.value = "";
        renderAll();
        showToast("success", "Message queued for send");
      }
    } catch (err) {
      showToast("error", err.message || "Failed to send");
    } finally {
      if (els.composeSend) els.composeSend.disabled = false;
    }
  }

  function getSelectedMassTags() {
    var boxes = document.querySelectorAll('input[name="mass-tag"]:checked');
    var tags = [];
    boxes.forEach(function (cb) {
      tags.push(cb.value);
    });
    return tags;
  }

  function threadHasAnyTag(thread, selectedTags) {
    if (!selectedTags.length) return false;
    return selectedTags.some(function (tag) {
      return thread.tags.indexOf(tag) >= 0;
    });
  }

  function getMassRecipients() {
    var selectedTags = getSelectedMassTags();
    var audience = els.massAudience ? els.massAudience.value : "all";
    if (!selectedTags.length) return [];

    var candidates = state.threads.filter(function (t) {
      return threadHasAnyTag(t, selectedTags);
    });

    if (audience === "responded") {
      candidates = candidates.filter(function (t) {
        return t.hasResponded;
      });
    } else if (audience === "no-response") {
      candidates = candidates.filter(function (t) {
        return !t.hasResponded;
      });
    }

    return candidates.map(function (t) {
      return {
        phoneKey: t.phoneKey,
        rawPhone: t.rawPhone || phoneForAirtable(t.phoneKey),
        tags: t.tags,
      };
    });
  }

  function getDripDurationHours() {
    var sel = els.massDuration ? els.massDuration.value : "4";
    if (sel === "custom") {
      var custom = parseFloat(els.massCustomHours && els.massCustomHours.value, 10);
      return isNaN(custom) || custom <= 0 ? 4 : custom;
    }
    return parseFloat(sel, 10) || 4;
  }

  function updateMassPreview() {
    if (!els.massPreview || !els.massStartBtn) return;

    var tags = getSelectedMassTags();
    var message = (els.massMessage && els.massMessage.value.trim()) || "";
    var recipients = getMassRecipients();
    var hours = getDripDurationHours();

    if (!tags.length) {
      els.massPreview.textContent = "Select at least one tag to preview recipients.";
      els.massStartBtn.disabled = true;
      return;
    }

    if (recipients.length === 0) {
      els.massPreview.textContent = "No recipients match the selected tags and audience filter.";
      els.massStartBtn.disabled = true;
      return;
    }

    var intervalSec =
      recipients.length > 1 ? Math.round((hours * 3600) / (recipients.length - 1)) : 0;
    els.massPreview.textContent =
      recipients.length +
      " recipient" +
      (recipients.length === 1 ? "" : "s") +
      " · ~" +
      hours +
      "h drip" +
      (intervalSec > 0 ? " (~1 every " + formatInterval(intervalSec) + ")" : "");

    els.massStartBtn.disabled = !message;
  }

  function formatInterval(sec) {
    if (sec >= 60) {
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return s > 0 ? m + "m " + s + "s" : m + "m";
    }
    return sec + "s";
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function jitterMs(baseMs) {
    var jitter = baseMs * 0.1 * (Math.random() * 2 - 1);
    return Math.max(500, Math.round(baseMs + jitter));
  }

  function openMassModal() {
    if (els.massModal) els.massModal.classList.remove("hidden");
    updateMassPreview();
  }

  function closeMassModal() {
    if (els.massModal) els.massModal.classList.add("hidden");
  }

  function onBeforeUnload(e) {
    if (state.dripRunning) {
      e.preventDefault();
      e.returnValue = "Drip send in progress. Closing will stop remaining messages.";
      return e.returnValue;
    }
  }

  function updateDripUi(sent, total, startTime, durationMs, logLines, failed) {
    var pct = total > 0 ? Math.round((sent / total) * 100) : 0;
    if (els.dripProgressBar) els.dripProgressBar.style.width = pct + "%";
    if (els.dripProgressText) {
      els.dripProgressText.textContent = sent + " / " + total + (failed ? " (" + failed + " failed)" : "");
    }
    if (els.dripEta && startTime && sent < total) {
      var elapsed = Date.now() - startTime;
      var rate = sent > 0 ? elapsed / sent : 0;
      var remaining = (total - sent) * rate;
      var etaMin = Math.ceil(remaining / 60000);
      els.dripEta.textContent = "About " + etaMin + " min remaining";
    }
    if (els.dripLog && logLines) {
      els.dripLog.innerHTML = logLines
        .slice(-5)
        .map(function (line) {
          return "<li>" + escapeHtml(line) + "</li>";
        })
        .join("");
    }
  }

  async function runDripSend(recipients, message, tags, durationHours) {
    state.dripRunning = true;
    state.dripCancelled = false;
    var total = recipients.length;
    var sent = 0;
    var failed = 0;
    var logLines = [];
    var startTime = Date.now();
    var totalMs = durationHours * 60 * 60 * 1000;
    var intervalMs = total > 1 ? totalMs / (total - 1) : 0;

    if (els.dripModal) els.dripModal.classList.remove("hidden");
    if (els.dripDone) els.dripDone.classList.add("hidden");
    if (els.dripCancelBtn) els.dripCancelBtn.classList.remove("hidden");
    if (els.dripActions) els.dripActions.classList.remove("hidden");
    window.addEventListener("beforeunload", onBeforeUnload);

    closeMassModal();

    for (var i = 0; i < recipients.length; i++) {
      if (state.dripCancelled) break;
      if (i > 0) await sleep(jitterMs(intervalMs));

      var rec = recipients[i];
      var fields = {
        Phone: rec.rawPhone,
        Direction: "Outbound",
        Status: "Pending",
        "Message Content": message,
        Business: state.business,
        "Message Type": "Text",
        Tag: tags,
      };

      try {
        await createOutboundRecord(fields);
        sent += 1;
        logLines.push("Queued " + formatPhoneDisplay(rec.phoneKey));
      } catch (err) {
        failed += 1;
        logLines.push("Failed " + formatPhoneDisplay(rec.phoneKey) + ": " + (err.message || "error"));
      }

      updateDripUi(sent + failed, total, startTime, totalMs, logLines, failed);
    }

    state.dripRunning = false;
    window.removeEventListener("beforeunload", onBeforeUnload);

    if (els.dripEta) els.dripEta.textContent = "";
    if (els.dripCancelBtn) els.dripCancelBtn.classList.add("hidden");
    if (els.dripActions) els.dripActions.classList.add("hidden");
    if (els.dripDone) els.dripDone.classList.remove("hidden");
    if (els.dripSummary) {
      var summary = state.dripCancelled
        ? "Cancelled. Queued " + sent + " of " + total + "."
        : "Done. Queued " + sent + " message" + (sent === 1 ? "" : "s") + ".";
      if (failed) summary += " " + failed + " failed.";
      els.dripSummary.textContent = summary;
    }

    await loadMessages(true);
  }

  function closeDripModal() {
    if (els.dripModal) els.dripModal.classList.add("hidden");
  }

  function setupRefreshTimer() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(function () {
      if (document.visibilityState === "visible" && !state.dripRunning) {
        loadMessages(true);
      }
    }, REFRESH_MS);
  }

  function bindEvents() {
    document.querySelectorAll(".msg-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var business = tab.getAttribute("data-business");
        if (!business || business === state.business) return;
        state.business = business;
        state.selectedPhoneKey = null;
        document.querySelectorAll(".msg-tab").forEach(function (t) {
          var active = t.getAttribute("data-business") === business;
          t.classList.toggle("active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        loadMessages(true);
      });
    });

    if (els.refreshBtn) {
      els.refreshBtn.addEventListener("click", function () {
        loadMessages(false);
      });
    }

    if (els.threadSearch) {
      els.threadSearch.addEventListener("input", renderThreadList);
    }
    if (els.threadResponseFilter) {
      els.threadResponseFilter.addEventListener("change", renderThreadList);
    }

    if (els.threadList) {
      els.threadList.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-phone-key]");
        if (!btn) return;
        selectThread(btn.getAttribute("data-phone-key"));
      });
    }

    if (els.composeForm) {
      els.composeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var content = (els.composeInput && els.composeInput.value.trim()) || "";
        if (!content || !state.selectedPhoneKey) return;
        sendSingleReply(content);
      });
    }

    if (els.massSendBtn) {
      els.massSendBtn.addEventListener("click", openMassModal);
    }

    document.querySelectorAll("[data-close-mass]").forEach(function (el) {
      el.addEventListener("click", closeMassModal);
    });

    document.querySelectorAll('input[name="mass-tag"]').forEach(function (cb) {
      cb.addEventListener("change", updateMassPreview);
    });
    if (els.massMessage) els.massMessage.addEventListener("input", updateMassPreview);
    if (els.massAudience) els.massAudience.addEventListener("change", updateMassPreview);
    if (els.massDuration) {
      els.massDuration.addEventListener("change", function () {
        var custom = els.massDuration.value === "custom";
        if (els.massCustomHoursWrap) els.massCustomHoursWrap.classList.toggle("hidden", !custom);
        updateMassPreview();
      });
    }
    if (els.massCustomHours) els.massCustomHours.addEventListener("input", updateMassPreview);

    if (els.massStartBtn) {
      els.massStartBtn.addEventListener("click", function () {
        var message = (els.massMessage && els.massMessage.value.trim()) || "";
        var tags = getSelectedMassTags();
        var recipients = getMassRecipients();
        var hours = getDripDurationHours();
        if (!message || !tags.length || !recipients.length) return;

        var confirmMsg =
          "Send to " +
          recipients.length +
          " recipient" +
          (recipients.length === 1 ? "" : "s") +
          " over ~" +
          hours +
          " hours?\n\nDo not close the browser until the drip completes.";
        if (!window.confirm(confirmMsg)) return;

        runDripSend(recipients, message, tags, hours);
      });
    }

    if (els.dripCancelBtn) {
      els.dripCancelBtn.addEventListener("click", function () {
        if (window.confirm("Stop queuing remaining messages?")) {
          state.dripCancelled = true;
        }
      });
    }

    if (els.dripCloseBtn) {
      els.dripCloseBtn.addEventListener("click", closeDripModal);
    }
  }

  function cacheElements() {
    els.toastArea = document.getElementById("toast-area");
    els.threadSearch = document.getElementById("thread-search");
    els.threadResponseFilter = document.getElementById("thread-response-filter");
    els.threadCount = document.getElementById("thread-count");
    els.threadList = document.getElementById("thread-list");
    els.threadEmpty = document.getElementById("thread-empty");
    els.chatPlaceholder = document.getElementById("chat-placeholder");
    els.chatActive = document.getElementById("chat-active");
    els.chatPhone = document.getElementById("chat-phone");
    els.chatTags = document.getElementById("chat-tags");
    els.chatResponseBadge = document.getElementById("chat-response-badge");
    els.messageScroll = document.getElementById("message-scroll");
    els.composeForm = document.getElementById("compose-form");
    els.composeInput = document.getElementById("compose-input");
    els.composeSend = document.getElementById("compose-send");
    els.refreshBtn = document.getElementById("refresh-btn");
    els.massSendBtn = document.getElementById("mass-send-btn");
    els.massModal = document.getElementById("mass-modal");
    els.massMessage = document.getElementById("mass-message");
    els.massAudience = document.getElementById("mass-audience");
    els.massDuration = document.getElementById("mass-duration");
    els.massCustomHoursWrap = document.getElementById("mass-custom-hours-wrap");
    els.massCustomHours = document.getElementById("mass-custom-hours");
    els.massPreview = document.getElementById("mass-preview");
    els.massStartBtn = document.getElementById("mass-start-btn");
    els.dripModal = document.getElementById("drip-modal");
    els.dripProgressBar = document.getElementById("drip-progress-bar");
    els.dripProgressText = document.getElementById("drip-progress-text");
    els.dripEta = document.getElementById("drip-eta");
    els.dripLog = document.getElementById("drip-log");
    els.dripCancelBtn = document.getElementById("drip-cancel-btn");
    els.dripActions = document.querySelector(".msg-drip-actions");
    els.dripDone = document.getElementById("drip-done");
    els.dripSummary = document.getElementById("drip-summary");
    els.dripCloseBtn = document.getElementById("drip-close-btn");
  }

  function boot() {
    cacheElements();
    bindEvents();
    setupRefreshTimer();
    loadMessages(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
