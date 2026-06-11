/**
 * Ads Tool — Meta Ads Library swipe file (endless random words)
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[AdsTool]";
  var STORAGE_KEY = "adstool_swipe_v1";
  var MAX_SESSIONS = 30;
  var POLL_INTERVAL_MS = 4000;
  var MAX_POLL_ATTEMPTS = 90;
  var INITIAL_WORD_COUNT = 3;

  var state = {
    sessions: [],
    activeSessionId: null,
    index: 0,
    scraping: false,
    endlessStarting: false,
    runId: null,
    builtMediaSessionId: null,
    builtMediaSlotCount: 0,
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
      if (Array.isArray(data.sessions)) {
        state.sessions = data.sessions.map(normalizeStoredSession);
      }
      if (data.activeSessionId) state.activeSessionId = data.activeSessionId;
    } catch (e) {
      log("storage load failed", e);
    }
  }

  function normalizeStoredSession(session) {
    if (session.type === "endless") {
      session.endless = session.endless || {
        loadingCount: 0,
        lastPrefetchAtLength: 0,
      };
      session.keywords = session.keywords || [];
      session.endless.loadingCount = 0;
    }
    return session;
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
    var count = session.ads ? session.ads.length : 0;

    if (session.type === "endless") {
      var wordCount = session.keywords ? session.keywords.length : 0;
      return (
        "Endless · " +
        count +
        " videos · " +
        wordCount +
        " word" +
        (wordCount === 1 ? "" : "s") +
        (when ? " · " + when : "")
      );
    }

    return (
      '"' +
      (session.keyword || "?") +
      '" · ' +
      count +
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

  function setBusyUi(busy, statusText) {
    state.scraping = busy;
    if (els.searchBtn) els.searchBtn.disabled = busy || state.endlessStarting;
    if (els.keywordInput) els.keywordInput.disabled = busy || state.endlessStarting;
    if (els.endlessBtn) els.endlessBtn.disabled = busy || state.endlessStarting;
    setStatusVisible(busy || state.endlessStarting, statusText || (busy ? "Scraping Meta Ads Library…" : ""));
  }

  function destroyMediaStack() {
    if (!els.mediaStack) return;
    els.mediaStack.querySelectorAll("video").forEach(function (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
    els.mediaStack.innerHTML = "";
    state.builtMediaSessionId = null;
    state.builtMediaSlotCount = 0;
  }

  function createThumbFallback(ad) {
    var thumbLink = document.createElement("a");
    thumbLink.className = "ads-thumb-link";
    thumbLink.href = ad.adLibraryUrl || "#";
    thumbLink.target = "_blank";
    thumbLink.rel = "noopener noreferrer";

    if (ad.videoPreviewUrl) {
      var img = document.createElement("img");
      img.className = "ads-thumb";
      img.src = ad.videoPreviewUrl;
      img.alt = "Preview for " + (ad.pageName || "ad");
      thumbLink.appendChild(img);
    }

    var label = document.createElement("span");
    label.textContent = "Open ad in Ads Library";
    thumbLink.appendChild(label);

    return thumbLink;
  }

  function appendMediaSlot(ad, index) {
    if (!els.mediaStack) return;

    var slot = document.createElement("div");
    slot.className = "ads-media-slot" + (index === state.index ? " ads-media-slot-active" : "");
    slot.setAttribute("data-index", String(index));

    var videoUrl = ad.videoHdUrl || ad.videoSdUrl;
    var thumbLink = createThumbFallback(ad);

    if (videoUrl) {
      var video = document.createElement("video");
      video.className = "ads-video";
      video.controls = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "auto";
      video.src = videoUrl;
      if (ad.videoPreviewUrl) video.poster = ad.videoPreviewUrl;
      video.addEventListener("error", function () {
        video.classList.add("hidden");
        thumbLink.classList.remove("hidden");
      });
      slot.appendChild(video);
      thumbLink.classList.add("hidden");
    }

    slot.appendChild(thumbLink);
    els.mediaStack.appendChild(slot);
  }

  function ensureMediaStack(session) {
    if (!els.mediaStack || !session || !session.ads) return;

    if (state.builtMediaSessionId !== session.id) {
      destroyMediaStack();
      state.builtMediaSessionId = session.id;
    }

    var from = state.builtMediaSlotCount;
    for (var i = from; i < session.ads.length; i++) {
      appendMediaSlot(session.ads[i], i);
    }
    state.builtMediaSlotCount = session.ads.length;

    if (from === 0 && session.ads.length > 0) {
      log("preloading videos", { sessionId: session.id, count: session.ads.length });
    } else if (from < session.ads.length) {
      log("appended video slots", { from: from, to: session.ads.length - 1 });
    }
  }

  function showMediaAtIndex(index) {
    if (!els.mediaStack) return;
    var slots = els.mediaStack.querySelectorAll(".ads-media-slot");
    slots.forEach(function (slot, i) {
      var active = i === index;
      slot.classList.toggle("ads-media-slot-active", active);
      var video = slot.querySelector("video");
      if (video && !active) video.pause();
    });
  }

  function renderSwipeMeta(ad) {
    if (!els.swipeMeta) return;

    var rows = [
      ["Keyword", ad.keyword],
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

  function isEndlessLoading(session) {
    return !!(session && session.type === "endless" && session.endless && session.endless.loadingCount > 0);
  }

  function renderSwipe() {
    var session = getActiveSession();
    var hasSession = session && session.ads && session.ads.length > 0;
    var endlessLoading = isEndlessLoading(session);

    if (els.emptyPanel) {
      els.emptyPanel.classList.toggle("hidden", !!hasSession || endlessLoading || state.endlessStarting);
    }
    if (els.swipePanel) els.swipePanel.classList.toggle("hidden", !hasSession && !endlessLoading);

    if (!hasSession && !endlessLoading) {
      if (!state.endlessStarting) destroyMediaStack();
      return;
    }

    if (hasSession) {
      ensureMediaStack(session);

      var ads = session.ads;
      if (state.index < 0) state.index = 0;
      if (state.index >= ads.length) state.index = ads.length - 1;

      var ad = ads[state.index];

      if (els.swipeKeyword) {
        if (session.type === "endless") {
          var wordCount = session.keywords ? session.keywords.length : 0;
          els.swipeKeyword.textContent =
            'Keyword: "' +
            (ad.keyword || "?") +
            '" · endless (' +
            wordCount +
            " word" +
            (wordCount === 1 ? "" : "s") +
            ")";
        } else {
          els.swipeKeyword.textContent = 'Keyword: "' + session.keyword + '"';
        }
      }
      if (els.swipeCounter) {
        var counter = "Ad " + (state.index + 1) + " of " + ads.length + " · use ← → keys";
        if (endlessLoading) counter += " · loading more…";
        if (els.swipeCounter) els.swipeCounter.textContent = counter;
      }
      if (els.swipeLibraryLink && ad) {
        els.swipeLibraryLink.href = ad.adLibraryUrl || "#";
        els.swipeLibraryLink.classList.toggle("hidden", !ad.adLibraryUrl);
      }
      if (els.prevBtn) els.prevBtn.disabled = state.index <= 0;
      if (els.nextBtn) els.nextBtn.disabled = state.index >= ads.length - 1;

      showMediaAtIndex(state.index);
      if (ad) renderSwipeMeta(ad);
    } else if (endlessLoading && els.swipeCounter) {
      els.swipeCounter.textContent = "Loading first batch…";
    }

    maybePrefetchNextWord();
  }

  function activateSession(sessionId) {
    state.activeSessionId = sessionId;
    state.index = 0;
    state.builtMediaSessionId = null;
    state.builtMediaSlotCount = 0;
    saveStorage();
    renderSessionSelect();
    renderSwipe();
  }

  function addSession(keyword, ads, meta) {
    var session = {
      id: makeSessionId(),
      type: "keyword",
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

  function createEndlessSession() {
    return {
      id: makeSessionId(),
      type: "endless",
      keyword: "endless",
      keywords: [],
      createdAt: new Date().toISOString(),
      ads: [],
      endless: {
        loadingCount: 0,
        lastPrefetchAtLength: 0,
      },
    };
  }

  function appendAdsToSession(session, keyword, newAds) {
    if (!newAds || !newAds.length) return 0;
    if (session.keywords.indexOf(keyword) === -1) {
      session.keywords.push(keyword);
    }
    session.ads.push.apply(session.ads, newAds);
    return newAds.length;
  }

  async function fetchRandomWords(count) {
    var res = await fetch(apiUrl("/api/ads-library/random-word?count=" + encodeURIComponent(count)));
    var data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || "Failed to fetch random words");
    if (!data.words || !data.words.length) throw new Error("No random words returned");
    return data.words;
  }

  async function fetchUniqueRandomWord(session) {
    var i;
    for (i = 0; i < 8; i++) {
      var words = await fetchRandomWords(1);
      var word = words[0];
      if (!session.keywords || session.keywords.indexOf(word) === -1) return word;
    }
    return (await fetchRandomWords(1))[0];
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
        setStatusVisible(true, 'Scraping "' + keyword + '"… (' + (i + 1) + " checks)");
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

  async function scrapeKeyword(keyword) {
    var res = await fetch(apiUrl("/api/ads-library/scrape"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: keyword }),
    });
    var data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data.error || "Failed to start scrape");
    if (!data.runId) throw new Error("Missing runId from server");

    log("scrape started", { runId: data.runId, keyword: keyword });
    return pollRun(data.runId, keyword);
  }

  async function scrapeKeywordIntoSession(session, keyword) {
    session.endless = session.endless || { loadingCount: 0, lastPrefetchAtLength: 0 };
    session.endless.loadingCount += 1;
    renderSwipe();

    try {
      var result = await scrapeKeyword(keyword);
      var ads = result.ads || [];
      var added = appendAdsToSession(session, keyword, ads);
      saveStorage();
      ensureMediaStack(session);
      renderSessionSelect();
      renderSwipe();

      if (added > 0) {
        log("word scraped", { keyword: keyword, added: added, total: session.ads.length });
      } else {
        log("word had no videos", { keyword: keyword });
      }
      return added;
    } finally {
      session.endless.loadingCount = Math.max(0, session.endless.loadingCount - 1);
      renderSwipe();
    }
  }

  async function startEndlessSwipe() {
    if (state.scraping || state.endlessStarting) return;

    state.endlessStarting = true;
    setBusyUi(true, "Fetching random words…");

    try {
      var words = await fetchRandomWords(INITIAL_WORD_COUNT);
      var session = createEndlessSession();
      state.sessions.unshift(session);
      if (state.sessions.length > MAX_SESSIONS) {
        state.sessions = state.sessions.slice(0, MAX_SESSIONS);
      }
      activateSession(session.id);

      showToast("info", "Loading: " + words.join(", "), 5000);
      setStatusVisible(true, "Scraping " + words.length + " random words…");

      var results = await Promise.all(
        words.map(function (word) {
          return scrapeKeywordIntoSession(session, word);
        })
      );

      var total = results.reduce(function (sum, n) { return sum + n; }, 0);
      if (!total) {
        showToast("error", "No video ads found from initial random words.");
      } else {
        showToast("success", "Ready — " + total + " videos from " + words.length + " words.");
      }
    } catch (err) {
      log("endless start failed", err);
      showToast("error", err.message || "Failed to start endless swipe");
    } finally {
      state.endlessStarting = false;
      setBusyUi(false);
    }
  }

  function maybePrefetchNextWord() {
    var session = getActiveSession();
    if (!session || session.type !== "endless") return;
    if (!session.ads || !session.ads.length) return;
    if (session.endless.loadingCount > 0) return;

    var len = session.ads.length;
    var threshold = Math.floor(len / 2);
    if (state.index < threshold) return;
    if (len <= session.endless.lastPrefetchAtLength) return;

    session.endless.lastPrefetchAtLength = len;
    saveStorage();

    fetchUniqueRandomWord(session)
      .then(function (word) {
        showToast("info", 'Loading more: "' + word + '"…', 3000);
        return scrapeKeywordIntoSession(session, word);
      })
      .then(function (added) {
        if (added > 0) {
          showToast("success", "+" + added + " videos loaded.", 2500);
        }
      })
      .catch(function (err) {
        log("prefetch failed", err);
        session.endless.lastPrefetchAtLength = 0;
        saveStorage();
      });
  }

  async function runSearch(keyword) {
    setBusyUi(true);
    try {
      var result = await scrapeKeyword(keyword);
      var ads = result.ads || [];

      if (!ads.length) {
        showToast("error", 'No video ads found for "' + keyword + '".');
        return;
      }

      addSession(keyword, ads, result.meta);
      showToast("success", "Saved " + ads.length + ' videos for "' + keyword + '".');
    } catch (err) {
      log("scrape failed", err);
      showToast("error", err.message || "Scrape failed");
    } finally {
      setBusyUi(false);
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
    if (els.endlessBtn) {
      els.endlessBtn.addEventListener("click", function () {
        startEndlessSwipe();
      });
    }

    if (els.searchForm) {
      els.searchForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (state.scraping || state.endlessStarting) return;
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
        destroyMediaStack();
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
    els.endlessBtn = document.getElementById("endless-btn");
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
    els.mediaStack = document.getElementById("swipe-media-stack");
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
