/**
 * 360 Tour - mobile-friendly reply inbox for WTP 360 College Tour SMS.
 * Reads/writes PLG Messages via same-origin /api/airtable proxy.
 */
(function () {
  "use strict";

  var PLG_BASE = "appmBb0lzqRK9dI8v";
  var WTP_BASE = "appKxMIaIyWSZ90kO";
  var TABLE_MESSAGES = "Messages";
  var TABLE_LEADS = "LEADS";
  var AIRTABLE = "/api/airtable/v0/";
  var BUSINESS = "WTP";
  var TAG = "360 College Tour";
  var REFRESH_MS = 20000;
  var MANNY_PHONE_KEY = "6127705296";

  var F = {
    STATUS: "Status",
    CREATED: "Created",
    PHONE: "Phone",
    DIRECTION: "Direction",
    CONTENT: "Message Content",
    BUSINESS: "Business",
    TAG: "Tag",
    MESSAGE_TYPE: "Message Type",
    NAME: "Name",
    SCHOOL: "What school do you go to?",
    HERMES_STATUS: "Hermes Status",
  };

  var state = {
    records: [],
    threads: [],
    leadByPhone: {},
    selectedPhoneKey: null,
    filter: "needs_reply",
    search: "",
    loading: false,
    refreshTimer: null,
  };

  var els = {};

  function $(id) {
    return document.getElementById(id);
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
    if (!d) return "";
    while (d.length > 10 && d.charAt(0) === "1") d = d.slice(1);
    if (d.length > 10) d = d.slice(-10);
    return d.length === 10 ? d : "";
  }

  function formatPhoneDisplay(keyOrPhone) {
    var k = normalizePhoneKey(keyOrPhone);
    if (k.length !== 10) return String(keyOrPhone || "-");
    return "(" + k.slice(0, 3) + ") " + k.slice(3, 6) + "-" + k.slice(6);
  }

  /** Prefer national format that has been reliable for Manny/router. */
  function phoneForAirtable(keyOrPhone) {
    var k = normalizePhoneKey(keyOrPhone);
    if (k.length !== 10) return String(keyOrPhone || "");
    return "(" + k.slice(0, 3) + ") " + k.slice(3, 6) + "-" + k.slice(6);
  }

  function parseDate(iso) {
    if (!iso) return 0;
    var t = new Date(iso).getTime();
    return isNaN(t) ? 0 : t;
  }

  function formatRelativeTime(iso) {
    if (!iso) return "";
    var diff = Date.now() - parseDate(iso);
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h";
    if (diff < 604800000) return Math.floor(diff / 86400000) + "d";
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

  function isCarrierNoise(content) {
    var c = String(content || "").toLowerCase();
    return (
      c.indexOf("unable to receive") >= 0 ||
      c.indexOf("message blocking") >= 0 ||
      c.indexOf("free msg:") === 0 ||
      c.indexOf("this is an automated") >= 0
    );
  }

function guessNameFromOutbound(messages) {
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if ((m.fields || {})[F.DIRECTION] !== "Outbound") continue;
      var text = String((m.fields || {})[F.CONTENT] || "").trim();
      var match = text.match(/^(?:yo|hey|hi)\s+([A-Za-z][A-Za-z'-]{1,20})\b/);
      if (match) return match[1];
      match = text.match(/^([A-Za-z][A-Za-z'-]{1,20})\s*[-,]\s+(?:manny|quick|just)/i);
      if (match) return match[1];
    }
    return "";
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

  async function fetchAllRecords(baseId, table, filterFormula, fields) {
    var url = AIRTABLE + baseId + "/" + encodeURIComponent(table) + "?pageSize=100";
    if (filterFormula) url += "&filterByFormula=" + encodeURIComponent(filterFormula);
    if (fields && fields.length) {
      fields.forEach(function (f) {
        url += "&fields[]=" + encodeURIComponent(f);
      });
    }
    var records = [];
    var offset = null;
    var safety = 0;
    while (safety < 80) {
      safety += 1;
      var pageUrl = url + (offset ? "&offset=" + encodeURIComponent(offset) : "");
      var data = await fetchAirtableJson(pageUrl);
      records = records.concat(data.records || []);
      if (!data.offset) break;
      offset = data.offset;
    }
    return records;
  }

  async function createOutboundRecord(fields) {
    var body = JSON.stringify({ records: [{ fields: fields }] });
    return fetchAirtableJson(AIRTABLE + PLG_BASE + "/" + encodeURIComponent(TABLE_MESSAGES), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body,
    });
  }

  function showToast(kind, message) {
    if (!els.toastArea) return;
    var el = document.createElement("div");
    el.className = "t-toast t-toast-" + kind;
    el.textContent = message;
    els.toastArea.appendChild(el);
    setTimeout(function () {
      el.remove();
    }, 3500);
  }

  function isWtp360Outbound(fields) {
    if (!fields) return false;
    if (fields[F.DIRECTION] !== "Outbound") return false;
    if (String(fields[F.BUSINESS] || "") !== BUSINESS) return false;
    var tags = fieldAsArray(fields[F.TAG]).join(" ").toLowerCase();
    // Prefer 360 tag, but still count plain WTP outbound from this campaign window.
    return !tags || tags.indexOf("360") >= 0 || tags.indexOf("college tour") >= 0;
  }

  function buildThreads(records) {
    var byPhone = {};
    records.forEach(function (rec) {
      var key = normalizePhoneKey(rec.fields && rec.fields[F.PHONE]);
      if (!key || key === MANNY_PHONE_KEY) return;
      if (!byPhone[key]) byPhone[key] = [];
      byPhone[key].push(rec);
    });

    var threads = [];
    Object.keys(byPhone).forEach(function (key) {
      var messages = byPhone[key].slice().sort(function (a, b) {
        return parseDate(a.fields[F.CREATED]) - parseDate(b.fields[F.CREATED]);
      });

      // Only show numbers we actually texted for WTP 360.
      // Inbounds often land with blank Business/Tag from the SMS webhook.
      var hasWtpOutbound = messages.some(function (m) {
        return isWtp360Outbound(m.fields || {});
      });
      if (!hasWtpOutbound) return;

      var humanInbound = messages.filter(function (m) {
        return m.fields[F.DIRECTION] === "Inbound" && !isCarrierNoise(m.fields[F.CONTENT]);
      });
      if (!humanInbound.length) return;

      var last = messages[messages.length - 1];
      var lastHumanInbound = humanInbound[humanInbound.length - 1];
      var lastDirection = (last.fields || {})[F.DIRECTION];
      var needsReply =
        lastDirection === "Inbound" && !isCarrierNoise((last.fields || {})[F.CONTENT]);

      var lead = state.leadByPhone[key] || {};
      var guessed = guessNameFromOutbound(messages);
      var name = lead.name || guessed || formatPhoneDisplay(key);
      var school = lead.school || "";
      var hermesStatus = lead.hermesStatus || "";

      threads.push({
        phoneKey: key,
        displayPhone: formatPhoneDisplay(key),
        rawPhone: phoneForAirtable(key),
        name: name,
        school: school,
        hermesStatus: hermesStatus,
        messages: messages,
        lastCreated: (last.fields || {})[F.CREATED],
        lastInboundAt: (lastHumanInbound.fields || {})[F.CREATED],
        lastPreview: String((last.fields || {})[F.CONTENT] || "").slice(0, 120),
        lastDirection: lastDirection,
        needsReply: needsReply,
        inboundCount: humanInbound.length,
      });
    });

    threads.sort(function (a, b) {
      // needs reply first, then latest activity
      if (a.needsReply !== b.needsReply) return a.needsReply ? -1 : 1;
      return parseDate(b.lastCreated) - parseDate(a.lastCreated);
    });
    return threads;
  }

  function mergeRecordsById(lists) {
    var map = {};
    lists.forEach(function (list) {
      (list || []).forEach(function (rec) {
        if (rec && rec.id) map[rec.id] = rec;
      });
    });
    return Object.keys(map).map(function (id) {
      return map[id];
    });
  }

  async function loadLeadMap(phoneKeys) {
    // Best-effort: PLG proxy key may or may not have WTP LEADS access.
    if (!phoneKeys.length) return;
    var map = Object.assign({}, state.leadByPhone);
    // Airtable OR formula gets huge; chunk FIND queries
    var chunkSize = 15;
    for (var i = 0; i < phoneKeys.length; i += chunkSize) {
      var chunk = phoneKeys.slice(i, i + chunkSize);
      var parts = chunk.map(function (k) {
        return "FIND('" + k + "', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Phone}&'',')',''),'(',''),'-',''),' ',''))";
      });
      var formula = "OR(" + parts.join(",") + ")";
      try {
        var recs = await fetchAllRecords(WTP_BASE, TABLE_LEADS, formula, [
          F.NAME,
          F.PHONE,
          F.SCHOOL,
          F.HERMES_STATUS,
        ]);
        recs.forEach(function (r) {
          var key = normalizePhoneKey((r.fields || {})[F.PHONE]);
          if (!key) return;
          map[key] = {
            name: (r.fields || {})[F.NAME] || "",
            school: (r.fields || {})[F.SCHOOL] || "",
            hermesStatus: (r.fields || {})[F.HERMES_STATUS] || "",
            id: r.id,
          };
        });
      } catch (e) {
        // ignore enrichment failures
        console.warn("[360tour] lead enrich skipped", e && e.message);
        break;
      }
    }
    state.leadByPhone = map;
  }

  function getFilteredThreads() {
    var q = (state.search || "").trim().toLowerCase();
    var qDigits = q.replace(/\D/g, "");
    return state.threads.filter(function (t) {
      if (state.filter === "needs_reply" && !t.needsReply) return false;
      if (state.filter === "waiting" && t.needsReply) return false;
      if (!q) return true;
      if (t.name.toLowerCase().indexOf(q) >= 0) return true;
      if ((t.school || "").toLowerCase().indexOf(q) >= 0) return true;
      if (t.displayPhone.toLowerCase().indexOf(q) >= 0) return true;
      if (qDigits && t.phoneKey.indexOf(qDigits.slice(-10)) >= 0) return true;
      if (t.lastPreview.toLowerCase().indexOf(q) >= 0) return true;
      return t.messages.some(function (m) {
        return String((m.fields || {})[F.CONTENT] || "")
          .toLowerCase()
          .indexOf(q) >= 0;
      });
    });
  }

  function renderThreadList() {
    var filtered = getFilteredThreads();
    if (els.threadCount) {
      var need = state.threads.filter(function (t) {
        return t.needsReply;
      }).length;
      els.threadCount.textContent =
        filtered.length +
        " shown · " +
        state.threads.length +
        " replied · " +
        need +
        " need reply";
    }
    if (!els.threadList) return;

    if (!filtered.length) {
      els.threadList.innerHTML = "";
      if (els.threadEmpty) els.threadEmpty.classList.remove("hidden");
      return;
    }
    if (els.threadEmpty) els.threadEmpty.classList.add("hidden");

    els.threadList.innerHTML = filtered
      .map(function (t) {
        var prefix = t.lastDirection === "Outbound" ? "You: " : "";
        var badge = t.needsReply
          ? '<span class="t-badge t-badge-need">Needs reply</span>'
          : '<span class="t-badge t-badge-wait">Waiting</span>';
        var meta = [t.displayPhone];
        if (t.school) meta.push(t.school);
        return (
          '<button type="button" class="t-thread' +
          (t.needsReply ? " needs-reply" : "") +
          (t.phoneKey === state.selectedPhoneKey ? " active" : "") +
          '" data-phone-key="' +
          escapeHtml(t.phoneKey) +
          '" role="listitem">' +
          '<div class="t-thread-top">' +
          "<div>" +
          '<p class="t-thread-name">' +
          escapeHtml(t.name) +
          "</p>" +
          '<p class="t-thread-meta">' +
          escapeHtml(meta.join(" · ")) +
          "</p>" +
          "</div>" +
          '<span class="t-thread-time">' +
          escapeHtml(formatRelativeTime(t.lastCreated)) +
          "</span>" +
          "</div>" +
          '<p class="t-thread-preview">' +
          escapeHtml(prefix + t.lastPreview) +
          "</p>" +
          badge +
          "</button>"
        );
      })
      .join("");
  }

  function statusHtml(status) {
    if (status === "Pending") return '<span class="t-status-pending">Pending</span>';
    if (status === "Failed") return '<span class="t-status-failed">Failed</span>';
    if (status === "Success") return '<span class="t-status-success">Sent</span>';
    return escapeHtml(status || "");
  }

  function renderChat() {
    var thread = state.threads.find(function (t) {
      return t.phoneKey === state.selectedPhoneKey;
    });

    if (!thread) {
      if (window.matchMedia("(min-width: 900px)").matches) {
        if (els.messageScroll) {
          els.messageScroll.innerHTML =
            '<p class="t-empty">Select a replied conversation.</p>';
        }
        if (els.chatName) els.chatName.textContent = "360 Tour";
        if (els.chatSub) els.chatSub.textContent = "Pick a thread on the left";
        if (els.chatCall) els.chatCall.removeAttribute("href");
      }
      return;
    }

    if (els.chatName) els.chatName.textContent = thread.name;
    if (els.chatSub) {
      var bits = [thread.displayPhone];
      if (thread.school) bits.push(thread.school);
      if (thread.hermesStatus) bits.push(thread.hermesStatus);
      els.chatSub.textContent = bits.join(" · ");
    }
    if (els.chatCall) els.chatCall.href = "tel:+1" + thread.phoneKey;

    if (!els.messageScroll) return;
    var html = [];
    var lastDay = "";
    thread.messages.forEach(function (m) {
      var f = m.fields || {};
      var created = f[F.CREATED];
      var day = formatDayLabel(created);
      if (day !== lastDay) {
        html.push('<div class="t-day">' + escapeHtml(day) + "</div>");
        lastDay = day;
      }
      var dir = f[F.DIRECTION] === "Inbound" ? "inbound" : "outbound";
      var meta = formatTime(created);
      if (dir === "outbound" && f[F.STATUS]) meta += " · " + statusHtml(f[F.STATUS]);
      if (dir === "inbound" && isCarrierNoise(f[F.CONTENT])) meta += " · system";
      html.push(
        '<div class="t-row ' +
          dir +
          '"><div><div class="t-bubble">' +
          escapeHtml(f[F.CONTENT] || "") +
          '</div><div class="t-bubble-meta">' +
          meta +
          "</div></div></div>"
      );
    });
    els.messageScroll.innerHTML = html.join("");
    els.messageScroll.scrollTop = els.messageScroll.scrollHeight;
    updateSendEnabled();
  }

  function showList() {
    if (els.viewList) els.viewList.classList.remove("hidden");
    if (els.viewChat) els.viewChat.classList.add("hidden");
  }

  function showChat() {
    if (window.matchMedia("(min-width: 900px)").matches) {
      if (els.viewChat) els.viewChat.classList.remove("hidden");
      return;
    }
    if (els.viewList) els.viewList.classList.add("hidden");
    if (els.viewChat) els.viewChat.classList.remove("hidden");
  }

  function selectThread(phoneKey) {
    state.selectedPhoneKey = phoneKey;
    renderThreadList();
    renderChat();
    showChat();
    if (els.composeInput) {
      requestAnimationFrame(function () {
        els.composeInput.focus();
      });
    }
  }

  function updateSendEnabled() {
    if (!els.composeSend || !els.composeInput) return;
    els.composeSend.disabled = !els.composeInput.value.trim() || !state.selectedPhoneKey;
  }

  function autosizeCompose() {
    if (!els.composeInput) return;
    els.composeInput.style.height = "auto";
    els.composeInput.style.height = Math.min(els.composeInput.scrollHeight, 140) + "px";
  }

  async function loadAll(silent) {
    if (state.loading) return;
    state.loading = true;
    if (!silent && els.threadCount) els.threadCount.textContent = "Loading…";
    if (els.refreshBtn) els.refreshBtn.disabled = true;
    try {
      // SMS webhook usually writes inbound with blank Business/Tag.
      // Pull:
      //  1) all WTP messages (our outbound + rare tagged inbound)
      //  2) all recent inbound (any business) so replies attach to WTP phones
      var since = "2026-07-01";
      var wtpFormula =
        'AND({Business}="' + BUSINESS + '", IS_AFTER(CREATED_TIME(), "' + since + '"))';
      var inboundFormula =
        'AND({Direction}="Inbound", IS_AFTER(CREATED_TIME(), "' + since + '"))';

      var settled = await Promise.all([
        fetchAllRecords(PLG_BASE, TABLE_MESSAGES, wtpFormula),
        fetchAllRecords(PLG_BASE, TABLE_MESSAGES, inboundFormula),
      ]);
      var records = mergeRecordsById(settled);
      state.records = records;

      // provisional threads to know which phones to enrich
      state.threads = buildThreads(records);
      var phones = state.threads.map(function (t) {
        return t.phoneKey;
      });
      await loadLeadMap(phones);
      state.threads = buildThreads(records);

      if (
        state.selectedPhoneKey &&
        !state.threads.some(function (t) {
          return t.phoneKey === state.selectedPhoneKey;
        })
      ) {
        // keep selection even if filter hides it; only clear if thread gone entirely
      }

      renderThreadList();
      renderChat();
      if (!silent) showToast("success", state.threads.length + " replied threads");
    } catch (err) {
      console.error(err);
      showToast("error", err.message || "Failed to load");
      if (els.threadCount) els.threadCount.textContent = "Load failed";
    } finally {
      state.loading = false;
      if (els.refreshBtn) els.refreshBtn.disabled = false;
    }
  }

  async function sendReply(content) {
    var thread = state.threads.find(function (t) {
      return t.phoneKey === state.selectedPhoneKey;
    });
    if (!thread) return;

    var fields = {
      Phone: phoneForAirtable(thread.phoneKey),
      Direction: "Outbound",
      Status: "Pending",
      "Message Content": content,
      Business: BUSINESS,
      "Message Type": "Text",
      Tag: [TAG],
    };

    if (els.composeSend) els.composeSend.disabled = true;
    try {
      var result = await createOutboundRecord(fields);
      var created = result.records && result.records[0];
      if (created) {
        state.records.push(created);
        state.threads = buildThreads(state.records);
        if (els.composeInput) {
          els.composeInput.value = "";
          autosizeCompose();
        }
        renderThreadList();
        renderChat();
        showToast("success", "Queued in Airtable");
      }
    } catch (err) {
      // retry Tag as string if multi-select rejected
      try {
        fields.Tag = TAG;
        var result2 = await createOutboundRecord(fields);
        var created2 = result2.records && result2.records[0];
        if (created2) {
          state.records.push(created2);
          state.threads = buildThreads(state.records);
          if (els.composeInput) {
            els.composeInput.value = "";
            autosizeCompose();
          }
          renderThreadList();
          renderChat();
          showToast("success", "Queued in Airtable");
          return;
        }
      } catch (err2) {
        showToast("error", err2.message || err.message || "Send failed");
      }
    } finally {
      updateSendEnabled();
    }
  }

  function bind() {
    els.viewList = $("view-list");
    els.viewChat = $("view-chat");
    els.threadList = $("thread-list");
    els.threadEmpty = $("thread-empty");
    els.threadCount = $("thread-count");
    els.search = $("search");
    els.refreshBtn = $("refresh-btn");
    els.backBtn = $("back-btn");
    els.chatName = $("chat-name");
    els.chatSub = $("chat-sub");
    els.chatCall = $("chat-call");
    els.messageScroll = $("message-scroll");
    els.composeForm = $("compose-form");
    els.composeInput = $("compose-input");
    els.composeSend = $("compose-send");
    els.toastArea = $("toast-area");

    if (els.refreshBtn) {
      els.refreshBtn.addEventListener("click", function () {
        loadAll(false);
      });
    }
    if (els.backBtn) {
      els.backBtn.addEventListener("click", function () {
        state.selectedPhoneKey = null;
        showList();
        renderThreadList();
      });
    }
    if (els.search) {
      els.search.addEventListener("input", function () {
        state.search = els.search.value || "";
        renderThreadList();
      });
    }
    document.querySelectorAll(".t-chip").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelectorAll(".t-chip").forEach(function (b) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        state.filter = btn.getAttribute("data-filter") || "all";
        renderThreadList();
      });
    });
    if (els.threadList) {
      els.threadList.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-phone-key]");
        if (!btn) return;
        selectThread(btn.getAttribute("data-phone-key"));
      });
    }
    if (els.composeInput) {
      els.composeInput.addEventListener("input", function () {
        updateSendEnabled();
        autosizeCompose();
      });
      els.composeInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (els.composeForm) els.composeForm.requestSubmit();
        }
      });
    }
    if (els.composeForm) {
      els.composeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var content = (els.composeInput && els.composeInput.value.trim()) || "";
        if (!content) return;
        sendReply(content);
      });
    }

    // desktop: show both panes
    if (window.matchMedia("(min-width: 900px)").matches) {
      if (els.viewChat) els.viewChat.classList.remove("hidden");
    }
  }

  function start() {
    bind();
    loadAll(true);
    state.refreshTimer = setInterval(function () {
      loadAll(true);
    }, REFRESH_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
