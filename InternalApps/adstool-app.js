/**
 * Ads Tool — Meta Ads Library endless swipe file
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[AdsTool]";
  var POLL_INTERVAL_MS = 4000;
  var MAX_POLL_ATTEMPTS = 90;
  var INITIAL_WORD_COUNT = 3;
  var PRELOAD_BEHIND = 1;
  var PRELOAD_AHEAD = 2;

  var state = {
    session: null,
    index: 0,
    scraping: false,
    endlessStarting: false,
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

  function makeSessionId() {
    return "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function getSession() {
    return state.session;
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

  function normalizeDedupText(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s]/g, "")
      .trim();
  }

  function videoUrlFingerprint(url) {
    if (!url) return "";
    try {
      var u = new URL(url);
      return u.origin + u.pathname;
    } catch (e) {
      return String(url).split("?")[0];
    }
  }

  function getAdDedupKeys(ad) {
    var keys = [];
    var videoFp = videoUrlFingerprint(ad.videoHdUrl || ad.videoSdUrl);
    if (videoFp) keys.push("v:" + videoFp);

    var body = normalizeDedupText(ad.bodyText);
    if (body.length >= 12) keys.push("b:" + body);

    var combined = normalizeDedupText(
      [ad.bodyText, ad.caption, ad.ctaText].filter(Boolean).join(" ")
    );
    if (combined.length >= 12) keys.push("t:" + combined);

    if (ad.pageId && body.length >= 12) {
      keys.push("p:" + ad.pageId + ":" + body.slice(0, 150));
    }

    return keys;
  }

  function buildDedupKeySet(ads) {
    var seen = new Set();
    (ads || []).forEach(function (ad) {
      getAdDedupKeys(ad).forEach(function (key) {
        seen.add(key);
      });
    });
    return seen;
  }

  function isDuplicateAd(ad, seen) {
    var keys = getAdDedupKeys(ad);
    if (!keys.length) return false;
    return keys.some(function (key) {
      return seen.has(key);
    });
  }

  function registerAdDedupKeys(ad, seen) {
    getAdDedupKeys(ad).forEach(function (key) {
      seen.add(key);
    });
  }

  function filterNewAds(existingAds, incomingAds) {
    var seen = buildDedupKeySet(existingAds);
    var unique = [];
    var skipped = 0;

    (incomingAds || []).forEach(function (ad) {
      if (isDuplicateAd(ad, seen)) {
        skipped += 1;
        return;
      }
      registerAdDedupKeys(ad, seen);
      unique.push(ad);
    });

    return { ads: unique, skipped: skipped };
  }

  function setStatusVisible(visible, text) {
    if (!els.statusPanel) return;
    els.statusPanel.classList.toggle("hidden", !visible);
    if (els.statusText && text != null) els.statusText.textContent = text;
  }

  function setBusyUi(busy, statusText) {
    state.scraping = busy;
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
      video.preload = "none";
      video.dataset.src = videoUrl;
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

    if (from < session.ads.length) {
      log("media slots ready", { total: session.ads.length, newFrom: from });
    }
    updateVideoPreloadWindow(state.index);
  }

  function isInPreloadWindow(slotIndex, currentIndex) {
    return slotIndex >= currentIndex - PRELOAD_BEHIND && slotIndex <= currentIndex + PRELOAD_AHEAD;
  }

  function unloadVideo(video) {
    if (!video || !video.src) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.preload = "none";
  }

  function loadVideoForSlot(video, slotIndex, currentIndex) {
    var url = video.dataset.src;
    if (!url) return;
    if (video.src) return;

    video.preload = slotIndex === currentIndex ? "auto" : "metadata";
    video.src = url;
    video.load();
  }

  function updateVideoPreloadWindow(currentIndex) {
    if (!els.mediaStack) return;
    var slots = els.mediaStack.querySelectorAll(".ads-media-slot");
    slots.forEach(function (slot) {
      var slotIndex = parseInt(slot.getAttribute("data-index"), 10);
      if (isNaN(slotIndex)) return;
      var video = slot.querySelector("video");
      if (!video) return;

      if (isInPreloadWindow(slotIndex, currentIndex)) {
        loadVideoForSlot(video, slotIndex, currentIndex);
      } else {
        unloadVideo(video);
      }
    });
  }

  function tryAutoplayVideo(video) {
    if (!video || video.classList.contains("hidden")) return;

    function play() {
      video.currentTime = 0;
      var playPromise = video.play();
      if (!playPromise || typeof playPromise.catch !== "function") return;
      playPromise.catch(function () {
        video.muted = true;
        video.play().catch(function () {});
      });
    }

    if (!video.src && video.dataset.src) {
      video.preload = "auto";
      video.src = video.dataset.src;
      video.load();
    }

    if (video.readyState >= 2) {
      play();
      return;
    }

    video.addEventListener(
      "loadeddata",
      function () {
        play();
      },
      { once: true }
    );
  }

  function showMediaAtIndex(index) {
    if (!els.mediaStack) return;
    updateVideoPreloadWindow(index);

    var slots = els.mediaStack.querySelectorAll(".ads-media-slot");
    slots.forEach(function (slot, i) {
      var active = i === index;
      slot.classList.toggle("ads-media-slot-active", active);
      var video = slot.querySelector("video");
      if (!video) return;
      if (!active) {
        video.pause();
        return;
      }
      tryAutoplayVideo(video);
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

  function isSessionLoading(session) {
    return !!(session && session.loadingCount > 0);
  }

  function renderSwipe() {
    var session = getSession();
    var hasAds = session && session.ads && session.ads.length > 0;
    var loading = isSessionLoading(session);

    if (els.emptyPanel) {
      els.emptyPanel.classList.toggle("hidden", !!hasAds || loading || state.endlessStarting);
    }
    if (els.swipePanel) els.swipePanel.classList.toggle("hidden", !hasAds && !loading);

    if (!hasAds && !loading) {
      if (!state.endlessStarting) destroyMediaStack();
      return;
    }

    if (hasAds) {
      ensureMediaStack(session);

      var ads = session.ads;
      if (state.index < 0) state.index = 0;
      if (state.index >= ads.length) state.index = ads.length - 1;

      var ad = ads[state.index];
      var wordCount = session.keywords ? session.keywords.length : 0;

      if (els.swipeKeyword) {
        els.swipeKeyword.textContent =
          'Keyword: "' +
          (ad.keyword || "?") +
          '" · ' +
          wordCount +
          " word" +
          (wordCount === 1 ? "" : "s");
      }
      if (els.swipeCounter) {
        var counter = "Ad " + (state.index + 1) + " of " + ads.length + " · use ← → keys";
        if (loading) counter += " · loading more…";
        els.swipeCounter.textContent = counter;
      }
      if (els.swipeLibraryLink && ad) {
        els.swipeLibraryLink.href = ad.adLibraryUrl || "#";
        els.swipeLibraryLink.classList.toggle("hidden", !ad.adLibraryUrl);
      }
      if (els.prevBtn) els.prevBtn.disabled = state.index <= 0;
      if (els.nextBtn) els.nextBtn.disabled = state.index >= ads.length - 1;

      showMediaAtIndex(state.index);
      if (ad) renderSwipeMeta(ad);
    } else if (loading && els.swipeCounter) {
      els.swipeCounter.textContent = "Loading first batch…";
    }

    maybePrefetchNextWord();
  }

  function createSession() {
    return {
      id: makeSessionId(),
      keywords: [],
      ads: [],
      loadingCount: 0,
      lastPrefetchAtLength: 0,
    };
  }

  function appendAdsToSession(session, keyword, newAds) {
    if (!newAds || !newAds.length) return { added: 0, skipped: 0 };
    var filtered = filterNewAds(session.ads, newAds);
    if (!filtered.ads.length) {
      return { added: 0, skipped: filtered.skipped };
    }
    if (session.keywords.indexOf(keyword) === -1) {
      session.keywords.push(keyword);
    }
    session.ads.push.apply(session.ads, filtered.ads);
    return { added: filtered.ads.length, skipped: filtered.skipped };
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
    session.loadingCount += 1;
    renderSwipe();

    try {
      var result = await scrapeKeyword(keyword);
      var ads = result.ads || [];
      var appendResult = appendAdsToSession(session, keyword, ads);
      ensureMediaStack(session);
      renderSwipe();

      if (appendResult.added > 0) {
        log("word scraped", {
          keyword: keyword,
          added: appendResult.added,
          skippedDupes: appendResult.skipped,
          total: session.ads.length,
        });
      } else {
        log("word had no new videos", {
          keyword: keyword,
          skippedDupes: appendResult.skipped,
        });
      }
      return appendResult;
    } finally {
      session.loadingCount = Math.max(0, session.loadingCount - 1);
      renderSwipe();
    }
  }

  async function startEndlessSwipe() {
    if (state.scraping || state.endlessStarting) return;

    state.endlessStarting = true;
    destroyMediaStack();
    state.session = createSession();
    state.index = 0;
    setBusyUi(true, "Fetching random words…");

    try {
      var words = await fetchRandomWords(INITIAL_WORD_COUNT);
      renderSwipe();

      showToast("info", "Loading: " + words.join(", "), 5000);
      setStatusVisible(true, "Scraping " + words.length + " random words…");

      var results = await Promise.all(
        words.map(function (word) {
          return scrapeKeywordIntoSession(state.session, word);
        })
      );

      var total = results.reduce(function (sum, r) { return sum + r.added; }, 0);
      var skipped = results.reduce(function (sum, r) { return sum + r.skipped; }, 0);
      if (!total) {
        showToast("error", "No video ads found from initial random words.");
        state.session = null;
        destroyMediaStack();
        renderSwipe();
      } else {
        var msg = "Ready — " + total + " videos from " + words.length + " words.";
        if (skipped > 0) msg += " (" + skipped + " duplicates skipped.)";
        showToast("success", msg);
      }
    } catch (err) {
      log("endless start failed", err);
      showToast("error", err.message || "Failed to start endless swipe");
      state.session = null;
      destroyMediaStack();
      renderSwipe();
    } finally {
      state.endlessStarting = false;
      setBusyUi(false);
    }
  }

  function maybePrefetchNextWord() {
    var session = getSession();
    if (!session || !session.ads || !session.ads.length) return;
    if (session.loadingCount > 0) return;

    var len = session.ads.length;
    var threshold = Math.floor(len / 2);
    if (state.index < threshold) return;
    if (len <= session.lastPrefetchAtLength) return;

    session.lastPrefetchAtLength = len;

    fetchUniqueRandomWord(session)
      .then(function (word) {
        showToast("info", 'Loading more: "' + word + '"…', 3000);
        return scrapeKeywordIntoSession(session, word);
      })
      .then(function (result) {
        if (result.added > 0) {
          var msg = "+" + result.added + " videos loaded.";
          if (result.skipped > 0) msg += " (" + result.skipped + " dupes skipped.)";
          showToast("success", msg, 2500);
        }
      })
      .catch(function (err) {
        log("prefetch failed", err);
        session.lastPrefetchAtLength = 0;
      });
  }

  function goPrev() {
    if (state.index > 0) {
      state.index -= 1;
      renderSwipe();
    }
  }

  function goNext() {
    var session = getSession();
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

    if (els.prevBtn) els.prevBtn.addEventListener("click", goPrev);
    if (els.nextBtn) els.nextBtn.addEventListener("click", goNext);

    document.addEventListener("keydown", function (e) {
      if (!getSession()) return;
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
    try {
      localStorage.removeItem("adstool_swipe_v1");
    } catch (e) {}
    initDom();
    renderSwipe();
    bindEvents();
    log("initialized");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
