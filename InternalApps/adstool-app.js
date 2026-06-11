/**
 * Ads Tool — Meta Ads Library swipe file
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[AdsTool]";
  var STORAGE_KEY = "adstool_swipe_v1";
  var MAX_SESSIONS = 30;
  var POLL_INTERVAL_MS = 4000;
  var MAX_POLL_ATTEMPTS = 90;

  var state = {
    sessions: [],
    activeSessionId: null,
    index: 0,
    scraping: false,
    runId: null,
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

  function apiUrl(path) {
    return new URL(path, window.location.origin).href;
  }

  async function parseJsonSafe(res) {
    var text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (e) {
      return { error: text || res.statusText };
    }
  }

  function showToast(kind, message, durationMs) {
    if (!els.toastArea) return;
    var el = document.createElement("div");
    el.className = "ads-toast ads-toast-" + (kind || "info");
    el.textContent = message;
    els.toastArea.appendChild(el);
    var ms = durationMs == null ? 4000 : durationMs;
    if (ms > 0) {
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, ms);
    }
  }

  function loadStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (Array.isArray(data.sessions)) state.sessions = data.sessions;
      if (data.activeSessionId) state.activeSessionId = data.activeSessionId;
    } catch (e) {
      log("storage load failed", e);
    }
  }

  function saveStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessions: state.sessions,
          activeSessionId: state.activeSessionId,
        })
      );
    } catch (e) {
      log("storage save failed", e);
      showToast("error", "Could not save to local storage (quota?).");
    }
  }

  function makeSessionId() {
    return "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function getActiveSession() {
    if (!state.activeSessionId) return null;
    return state.sessions.find(function (s) {
      return s.id === state.activeSessionId;
    }) || null;
  }

  function formatMetaValue(val) {
    if (val == null || val === "") return "—";
    if (Array.isArray(val)) {
      if (!val.length) return "—";
      return val.map(String).join(", ");
    }
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (typeof val === "object") return JSON.stringify(val);
    return String(val);
  }

  function formatSessionLabel(session) {
    var d = session.createdAt ? new Date(session.createdAt) : null;
    var when = d && !isNaN(d.getTime()) ? d.toLocaleString() : "";
    return (
      '"' +
      session.keyword +
      '" · ' +
      (session.ads ? session.ads.length : 0) +
      " videos" +
      (when ? " · " + when : "")
    );
  }

  function renderSessionSelect() {
    if (!els.sessionSelect) return;
    var prev = els.sessionSelect.value;
    els.sessionSelect.innerHTML = '<option value="">— Select a session —</option>';
    state.sessions
      .slice()
      .sort(function (a, b) {
        return String(b.createdAt).localeCompare(String(a.createdAt));
      })
      .forEach(function (session) {
        var opt = document.createElement("option");
        opt.value = session.id;
        opt.textContent = formatSessionLabel(session);
        els.sessionSelect.appendChild(opt);
      });
    if (prev && state.sessions.some(function (s) { return s.id === prev; })) {
      els.sessionSelect.value = prev;
    } else if (state.activeSessionId) {
      els.sessionSelect.value = state.activeSessionId;
    }
  }

  function setStatusVisible(visible, text) {
    if (!els.statusPanel) return;
    els.statusPanel.classList.toggle("hidden", !visible);
    if (els.statusText && text != null) els.statusText.textContent = text;
  }

  function setScrapingUi(scraping) {
    state.scraping = scraping;
    if (els.searchBtn) els.searchBtn.disabled = scraping;
    if (els.keywordInput) els.keywordInput.disabled = scraping;
    setStatusVisible(scraping, scraping ? "Scraping Meta Ads Library…" : "");
  }

  function renderSwipe() {
    var session = getActiveSession();
    var hasSession = session && session.ads && session.ads.length > 0;

    if (els.emptyPanel) els.emptyPanel.classList.toggle("hidden", !!hasSession);
    if (els.swipePanel) els.swipePanel.classList.toggle("hidden", !hasSession);

    if (!hasSession) return;

    var ads = session.ads;
    if (state.index < 0) state.index = 0;
    if (state.index >= ads.length) state.index = ads.length - 1;

    var ad = ads[state.index];

    if (els.swipeKeyword) {
      els.swipeKeyword.textContent = 'Keyword: "' + session.keyword + '"';
    }
    if (els.swipeCounter) {
      els.swipeCounter.textContent =
        "Ad " + (state.index + 1) + " of " + ads.length + " · use ← → keys";
    }
    if (els.swipeLibraryLink) {
      els.swipeLibraryLink.href = ad.adLibraryUrl || "#";
      els.swipeLibraryLink.classList.toggle("hidden", !ad.adLibraryUrl);
    }
    if (els.prevBtn) els.prevBtn.disabled = state.index <= 0;
    if (els.nextBtn) els.nextBtn.disabled = state.index >= ads.length - 1;

    var videoUrl = ad.videoHdUrl || ad.videoSdUrl;
    var showVideo = false;

    if (els.swipeVideo) {
      els.swipeVideo.pause();
      els.swipeVideo.onerror = null;
      els.swipeVideo.removeAttribute("src");
      els.swipeVideo.load();
      if (videoUrl) {
        els.swipeVideo.src = videoUrl;
        els.swipeVideo.poster = ad.videoPreviewUrl || "";
        showVideo = true;
        els.swipeVideo.onerror = function () {
          els.swipeVideo.classList.add("hidden");
          if (els.swipeThumbLink && ad.videoPreviewUrl) {
            els.swipeThumbLink.classList.remove("hidden");
          }
        };
      }
      els.swipeVideo.classList.toggle("hidden", !showVideo);
    }

    if (els.swipeThumbLink && els.swipeThumb) {
      var thumbUrl = ad.videoPreviewUrl;
      els.swipeThumbLink.href = ad.adLibraryUrl || "#";
      if (thumbUrl) {
        els.swipeThumb.src = thumbUrl;
        els.swipeThumb.alt = "Preview for " + (ad.pageName || "ad");
      }
      els.swipeThumbLink.classList.toggle("hidden", showVideo || !thumbUrl);
    }

    if (els.swipeMeta) {
      var rows = [
        ["Page", ad.pageName],
        ["Ad archive ID", ad.adArchiveId],
        ["Body", ad.bodyText],
        ["Caption", ad.caption],
        ["CTA", ad.ctaText ? ad.ctaText + (ad.ctaType ? " (" + ad.ctaType + ")" : "") : null],
        ["Landing URL", ad.linkUrl],
        ["Display format", ad.displayFormat],
        ["Active", ad.isActive],
        ["Start date", ad.startDate],
        ["End date", ad.endDate],
        ["Spend", ad.spend != null ? formatMetaValue(ad.spend) + (ad.currency ? " " + ad.currency : "") : null],
        ["Reach estimate", ad.reachEstimate],
        ["Impressions index", ad.impressionsWithIndex],
        ["Publisher platforms", ad.publisherPlatforms],
        ["Page categories", ad.pageCategories],
        ["Page likes", ad.pageLikeCount],
        ["Collation count", ad.collationCount],
        ["Entity type", ad.entityType],
        [
          "Page profile",
          ad.pageProfileUri
            ? '<a href="' + escapeHtml(ad.pageProfileUri) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(ad.pageProfileUri) + "</a>"
            : null,
        ],
        [
          "Ads Library",
          ad.adLibraryUrl
            ? '<a href="' + escapeHtml(ad.adLibraryUrl) + '" target="_blank" rel="noopener noreferrer">Open ad</a>'
            : null,
        ],
      ];

      els.swipeMeta.innerHTML = rows
        .map(function (row) {
          var label = row[0];
          var value = row[1];
          if (value == null || value === "" || value === "—") return "";
          var display =
            label === "Landing URL" && typeof value === "string" && value.indexOf("http") === 0
              ? '<a href="' + escapeHtml(value) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(value) + "</a>"
              : typeof value === "string" && value.indexOf("<a ") === 0
                ? value
                : escapeHtml(formatMetaValue(value));
          return "<dt>" + escapeHtml(label) + "</dt><dd>" + display + "</dd>";
        })
        .join("");
    }
  }

  function activateSession(sessionId) {
    state.activeSessionId = sessionId;
    state.index = 0;
    saveStorage();
    renderSessionSelect();
    renderSwipe();
  }

  function addSession(keyword, ads, meta) {
    var session = {
      id: makeSessionId(),
      keyword: keyword,
      createdAt: new Date().toISOString(),
      ads: ads,
      meta: meta || null,
    };
    state.sessions.unshift(session);
    if (state.sessions.length > MAX_SESSIONS) {
      state.sessions = state.sessions.slice(0, MAX_SESSIONS);
    }
    activateSession(session.id);
  }

  async function pollRun(runId, keyword) {
    for (var i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise(function (r) {
        setTimeout(r, POLL_INTERVAL_MS);
      });

      var statusUrl =
        apiUrl("/api/ads-library/status") +
        "?runId=" +
        encodeURIComponent(runId) +
        "&keyword=" +
        encodeURIComponent(keyword);

      var res = await fetch(statusUrl);
      var data = await parseJsonSafe(res);

      if (data.status === "running") {
        setStatusVisible(true, "Scraping… (" + (i + 1) + " checks)");
        continue;
      }

      if (data.status === "failed") {
        throw new Error(data.error || "Scrape failed");
      }

      if (data.status === "completed") {
        return data;
      }
    }
    throw new Error("Timed out waiting for scrape");
  }

  async function runSearch(keyword) {
    setScrapingUi(true);
    try {
      var res = await fetch(apiUrl("/api/ads-library/scrape"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: keyword }),
      });
      var data = await parseJsonSafe(res);
      if (!res.ok) throw new Error(data.error || "Failed to start scrape");
      if (!data.runId) throw new Error("Missing runId from server");

      state.runId = data.runId;
      log("scrape started", { runId: data.runId, keyword: keyword });

      var result = await pollRun(data.runId, keyword);
      var ads = result.ads || [];

      if (!ads.length) {
        showToast("error", 'No video ads found for "' + keyword + '".');
        return;
      }

      addSession(keyword, ads, result.meta);
      var msg =
        "Saved " +
        ads.length +
        " video" +
        (ads.length === 1 ? "" : "s") +
        ' for "' +
        keyword +
        '".';
      if (result.meta && result.meta.videoCount < result.meta.rawCount) {
        msg += " (" + result.meta.rawCount + " raw results filtered to video.)";
      }
      showToast("success", msg);
    } catch (err) {
      log("scrape failed", err);
      showToast("error", err.message || "Scrape failed");
    } finally {
      setScrapingUi(false);
    }
  }

  function goPrev() {
    if (state.index > 0) {
      state.index -= 1;
      renderSwipe();
    }
  }

  function goNext() {
    var session = getActiveSession();
    if (session && session.ads && state.index < session.ads.length - 1) {
      state.index += 1;
      renderSwipe();
    }
  }

  function bindEvents() {
    if (els.searchForm) {
      els.searchForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (state.scraping) return;
        var keyword = (els.keywordInput && els.keywordInput.value || "").trim();
        if (!keyword) return;
        runSearch(keyword);
      });
    }

    if (els.prevBtn) els.prevBtn.addEventListener("click", goPrev);
    if (els.nextBtn) els.nextBtn.addEventListener("click", goNext);

    if (els.sessionSelect) {
      els.sessionSelect.addEventListener("change", function () {
        var id = els.sessionSelect.value;
        if (!id) return;
        activateSession(id);
      });
    }

    if (els.clearSessionsBtn) {
      els.clearSessionsBtn.addEventListener("click", function () {
        if (!state.sessions.length) return;
        if (!window.confirm("Clear all saved swipe sessions from this browser?")) return;
        state.sessions = [];
        state.activeSessionId = null;
        state.index = 0;
        saveStorage();
        renderSessionSelect();
        renderSwipe();
        showToast("info", "Cleared saved sessions.");
      });
    }

    document.addEventListener("keydown", function (e) {
      if (!getActiveSession()) return;
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    });
  }

  function initDom() {
    els.toastArea = document.getElementById("toast-area");
    els.searchForm = document.getElementById("search-form");
    els.keywordInput = document.getElementById("keyword-input");
    els.searchBtn = document.getElementById("search-btn");
    els.sessionSelect = document.getElementById("session-select");
    els.clearSessionsBtn = document.getElementById("clear-sessions-btn");
    els.statusPanel = document.getElementById("status-panel");
    els.statusText = document.getElementById("status-text");
    els.emptyPanel = document.getElementById("empty-panel");
    els.swipePanel = document.getElementById("swipe-panel");
    els.swipeKeyword = document.getElementById("swipe-keyword");
    els.swipeCounter = document.getElementById("swipe-counter");
    els.swipeLibraryLink = document.getElementById("swipe-library-link");
    els.prevBtn = document.getElementById("prev-btn");
    els.nextBtn = document.getElementById("next-btn");
    els.swipeVideo = document.getElementById("swipe-video");
    els.swipeThumb = document.getElementById("swipe-thumb");
    els.swipeThumbLink = document.getElementById("swipe-thumb-link");
    els.swipeMeta = document.getElementById("swipe-meta");
  }

  function init() {
    initDom();
    loadStorage();
    renderSessionSelect();
    renderSwipe();
    bindEvents();
    log("initialized", { sessions: state.sessions.length });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
