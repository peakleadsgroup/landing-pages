/**
 * Ads Tool — Meta Ads Library endless swipe file
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[AdsTool]";
  var POLL_INTERVAL_MS = 10000;
  var MAX_POLL_ATTEMPTS = 90;
  var INITIAL_WORD_COUNT = 3;
  var PREFETCH_MORE_WORDS = true;
  var PRELOAD_BEHIND = 1;
  var PRELOAD_AHEAD = 2;
  var SCRIPTS_AUTO_SAVE_MS = 4000;
  var SCRIPTS_SAVE_TO_AIRTABLE = false;

  var AIRTABLE_BASE_ID = "appmBb0lzqRK9dI8v";
  var SCRIPTS_TABLE_ID = "tblnyzakoO67vFwhZ";
  var SCRIPTS_AIRTABLE_URL =
    "/api/airtable/v0/" + AIRTABLE_BASE_ID + "/" + SCRIPTS_TABLE_ID;

  var NICHE_OPTIONS = [
    "Bathrooms",
    "Roofing",
    "Solar",
    "Floor Coating",
    "Windows",
    "Kitchen Reface",
    "Kitchens",
    "Concrete Polishing",
  ];

  var state = {
    session: null,
    index: 0,
    scraping: false,
    endlessStarting: false,
    builtMediaSessionId: null,
    builtMediaSlotCount: 0,
    scriptEntries: [],
    activeScriptEntryId: null,
    scriptsAutoSaveTimer: null,
    soundUnlocked: false,
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

  function usableMediaUrl(url) {
    if (!url || typeof url !== "string") return null;
    var trimmed = url.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.indexOf("//") === 0) return "https:" + trimmed;
    return null;
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
    setStatusVisible(busy || state.endlessStarting, statusText || (busy ? "Scraping Meta Ads Library…" : ""));
  }

  function prepareVideoSound(video) {
    if (!video) return;
    video.defaultMuted = false;
    video.muted = false;
    video.volume = 1;
  }

  function unlockVideoSound() {
    if (state.soundUnlocked) return;
    state.soundUnlocked = true;
    if (!els.mediaStack) return;
    els.mediaStack.querySelectorAll("video").forEach(prepareVideoSound);
    var session = getSession();
    if (session && session.ads && session.ads.length) {
      showMediaAtIndex(state.index, { fromUserGesture: true });
    }
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
      var previewUrl = usableMediaUrl(ad.videoPreviewUrl);
      if (previewUrl) {
        var img = document.createElement("img");
        img.className = "ads-thumb";
        img.src = previewUrl;
        img.alt = "Preview for " + (ad.pageName || "ad");
        thumbLink.appendChild(img);
      }
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

    var videoUrl = usableMediaUrl(ad.videoHdUrl || ad.videoSdUrl);
    var thumbLink = createThumbFallback(ad);

    if (videoUrl) {
      var video = document.createElement("video");
      video.className = "ads-video";
      video.controls = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "none";
      video.dataset.src = videoUrl;
      prepareVideoSound(video);
      var previewUrl = usableMediaUrl(ad.videoPreviewUrl);
      if (previewUrl) video.poster = previewUrl;
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

  function tryAutoplayVideo(video, options) {
    options = options || {};
    var fromUserGesture = options.fromUserGesture === true;
    if (!video || video.classList.contains("hidden")) return;

    function play() {
      prepareVideoSound(video);
      video.currentTime = 0;
      var playPromise = video.play();
      if (!playPromise || typeof playPromise.catch !== "function") return;
      playPromise.catch(function () {
        if (fromUserGesture || state.soundUnlocked) return;
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

  function showMediaAtIndex(index, options) {
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
      tryAutoplayVideo(video, options);
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

  function renderSwipe(options) {
    var session = getSession();
    var hasAds = session && session.ads && session.ads.length > 0;
    var loading = isSessionLoading(session);

    if (els.emptyPanel) {
      els.emptyPanel.classList.toggle("hidden", !!hasAds);
      if (els.emptyPanelText && !hasAds) {
        if (state.endlessStarting) {
          els.emptyPanelText.textContent = "Fetching random keywords…";
        } else if (loading) {
          els.emptyPanelText.textContent = "Loading ads…";
        } else {
          els.emptyPanelText.textContent = "Could not load ads. Refresh the page to try again.";
        }
      }
    }
    if (els.swipePanel) els.swipePanel.classList.toggle("hidden", !hasAds && !loading);

    if (!hasAds && !loading && !state.endlessStarting) {
      destroyMediaStack();
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

      showMediaAtIndex(state.index, options);
      if (ad) {
        renderSwipeMeta(ad);
        if (window.AdsToolAI && window.AdsToolAI.onAdChanged) {
          window.AdsToolAI.onAdChanged(ad, state.index);
        }
      }
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
    if (!PREFETCH_MORE_WORDS) return;
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
      unlockVideoSound();
      state.index -= 1;
      renderSwipe({ fromUserGesture: true });
    }
  }

  function goNext() {
    var session = getSession();
    if (session && session.ads && state.index < session.ads.length - 1) {
      unlockVideoSound();
      state.index += 1;
      renderSwipe({ fromUserGesture: true });
    }
  }

  function makeScriptEntry() {
    return {
      localId: "script_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      airtableRecordId: null,
      niche: "",
      script: "",
      dirty: false,
      saving: false,
      lastSaved: null,
      saveError: null,
    };
  }

  function getScriptEntry(localId) {
    return state.scriptEntries.find(function (entry) {
      return entry.localId === localId;
    });
  }

  function getActiveScriptEntry() {
    if (state.activeScriptEntryId) {
      var active = getScriptEntry(state.activeScriptEntryId);
      if (active) return active;
    }
    return state.scriptEntries[0] || null;
  }

  function setActiveScriptEntry(localId) {
    state.activeScriptEntryId = localId;
    highlightActiveScriptCard();
  }

  function highlightActiveScriptCard() {
    if (!els.scriptsList) return;
    els.scriptsList.querySelectorAll(".ads-script-card").forEach(function (card) {
      var id = card.getAttribute("data-entry-id");
      card.classList.toggle("is-active-script", id === state.activeScriptEntryId);
    });
  }

  function getCurrentAd() {
    var session = getSession();
    if (!session || !session.ads || !session.ads.length) return null;
    return session.ads[state.index] || null;
  }

  function syncScriptEntryToDom(entry) {
    if (!els.scriptsList || !entry) return;
    var nicheEl = els.scriptsList.querySelector(
      '.script-niche[data-entry-id="' + entry.localId + '"]'
    );
    var bodyEl = els.scriptsList.querySelector(
      '.script-body[data-entry-id="' + entry.localId + '"]'
    );
    if (nicheEl && nicheEl.value !== entry.niche) nicheEl.value = entry.niche;
    if (bodyEl && bodyEl.value !== entry.script) bodyEl.value = entry.script;
    updateScriptReadingTime(entry);
    updateScriptCardBadge(entry);
    updateScriptsStatus();
  }

  function setActiveScriptText(text) {
    ensureScriptsBootstrapped();
    var entry = getActiveScriptEntry();
    if (!entry) return;
    entry.script = String(text || "");
    entry.dirty = true;
    entry.saveError = null;
    syncScriptEntryToDom(entry);
  }

  function appendToActiveScript(text, mode) {
    ensureScriptsBootstrapped();
    if (els.scriptsPanel && !els.scriptsPanel.open) {
      els.scriptsPanel.open = true;
    }
    var entry = getActiveScriptEntry();
    if (!entry) return;

    var trimmed = String(text || "").trim();
    if (!trimmed) return;

    if (mode === "set_or_append") {
      if (!entry.script.trim()) {
        entry.script = trimmed;
      } else {
        entry.script = entry.script.replace(/\s+$/, "") + "\n\n" + trimmed;
      }
    } else if (mode === "append_sentence") {
      var base = entry.script.replace(/\s+$/, "");
      entry.script = base ? base + " " + trimmed : trimmed;
    } else {
      entry.script = entry.script ? entry.script + "\n" + trimmed : trimmed;
    }

    entry.dirty = true;
    entry.saveError = null;
    syncScriptEntryToDom(entry);
    setActiveScriptEntry(entry.localId);
  }

  function setActiveScriptNiche(niche) {
    ensureScriptsBootstrapped();
    var entry = getActiveScriptEntry();
    if (!entry) return;
    entry.niche = niche || "";
    entry.dirty = true;
    entry.saveError = null;
    syncScriptEntryToDom(entry);
  }

  function scriptSaveBadgeClass(entry) {
    if (!SCRIPTS_SAVE_TO_AIRTABLE) return "";
    if (entry.saving) return "is-saving";
    if (entry.saveError) return "is-error";
    if (entry.airtableRecordId && !entry.dirty) return "is-saved";
    if (entry.dirty) return "";
    return "";
  }

  function scriptSaveBadgeText(entry) {
    if (!SCRIPTS_SAVE_TO_AIRTABLE) return "";
    if (entry.saving) return "Saving…";
    if (entry.saveError) return "Error";
    if (entry.airtableRecordId && !entry.dirty && entry.lastSaved) {
      return "Saved " + entry.lastSaved.toLocaleTimeString();
    }
    if (entry.dirty) return "Unsaved";
    if (entry.airtableRecordId) return "Saved";
    return "New";
  }

  var SCRIPT_WORDS_PER_MINUTE = 200;

  function countScriptWords(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  function scriptReadingTimeLabel(text) {
    var words = countScriptWords(text);
    var minutes = words / SCRIPT_WORDS_PER_MINUTE;
    var timeStr;
    if (words === 0) {
      timeStr = "0 sec";
    } else if (minutes < 1) {
      var secs = Math.max(1, Math.round(minutes * 60));
      timeStr = secs + " sec";
    } else if (minutes < 10) {
      timeStr = (Math.round(minutes * 10) / 10) + " min";
    } else {
      timeStr = Math.round(minutes) + " min";
    }
    return (
      words +
      " word" +
      (words === 1 ? "" : "s") +
      " · ~" +
      timeStr +
      " read (@ " +
      SCRIPT_WORDS_PER_MINUTE +
      " wpm)"
    );
  }

  function updateScriptReadingTime(entry) {
    if (!els.scriptsList || !entry) return;
    var el = els.scriptsList.querySelector(
      '.script-reading-time[data-entry-id="' + entry.localId + '"]'
    );
    if (el) el.textContent = scriptReadingTimeLabel(entry.script);
  }

  function renderScriptsList() {
    if (!els.scriptsList) return;

    els.scriptsList.innerHTML = state.scriptEntries
      .map(function (entry, index) {
        var nicheOptions = NICHE_OPTIONS.map(function (niche) {
          var selected = entry.niche === niche ? " selected" : "";
          return (
            '<option value="' + escapeHtml(niche) + '"' + selected + ">" + escapeHtml(niche) + "</option>"
          );
        }).join("");

        return (
          '<article class="ads-script-card" data-entry-id="' +
          escapeHtml(entry.localId) +
          '">' +
          '<div class="ads-script-card-top">' +
          '<p class="ads-script-card-title">Record ' +
          (index + 1) +
          "</p>" +
          '<span class="ads-script-save-badge ' +
          scriptSaveBadgeClass(entry) +
          '">' +
          escapeHtml(scriptSaveBadgeText(entry)) +
          "</span>" +
          "</div>" +
          '<div class="ads-script-field">' +
          '<label class="ads-label" for="script-niche-' +
          escapeHtml(entry.localId) +
          '">Niche</label>' +
          '<select class="ads-select script-niche" id="script-niche-' +
          escapeHtml(entry.localId) +
          '" data-entry-id="' +
          escapeHtml(entry.localId) +
          '">' +
          '<option value="">Select niche…</option>' +
          nicheOptions +
          "</select>" +
          "</div>" +
          '<div class="ads-script-field">' +
          '<label class="ads-label" for="script-text-' +
          escapeHtml(entry.localId) +
          '">Script</label>' +
          '<textarea class="ads-input ads-script-textarea script-body" id="script-text-' +
          escapeHtml(entry.localId) +
          '" data-entry-id="' +
          escapeHtml(entry.localId) +
          '" placeholder="Write script…">' +
          escapeHtml(entry.script) +
          "</textarea>" +
          '<p class="ads-muted ads-script-reading-time script-reading-time" data-entry-id="' +
          escapeHtml(entry.localId) +
          '">' +
          escapeHtml(scriptReadingTimeLabel(entry.script)) +
          "</p>" +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    els.scriptsList.querySelectorAll(".script-niche, .script-body").forEach(function (el) {
      el.addEventListener("input", onScriptFieldChange);
      el.addEventListener("change", onScriptFieldChange);
    });

    els.scriptsList.querySelectorAll(".script-body").forEach(function (el) {
      el.addEventListener("focus", function () {
        setActiveScriptEntry(el.getAttribute("data-entry-id"));
      });
    });

    els.scriptsList.querySelectorAll(".ads-script-card").forEach(function (card) {
      card.addEventListener("mousedown", function () {
        setActiveScriptEntry(card.getAttribute("data-entry-id"));
      });
    });

    if (!state.activeScriptEntryId && state.scriptEntries[0]) {
      state.activeScriptEntryId = state.scriptEntries[0].localId;
    }
    highlightActiveScriptCard();
  }

  function updateScriptCardBadge(entry) {
    if (!els.scriptsList) return;
    var card = els.scriptsList.querySelector('[data-entry-id="' + entry.localId + '"]');
    if (!card) return;
    var badge = card.querySelector(".ads-script-save-badge");
    if (!badge) return;
    badge.className = "ads-script-save-badge " + scriptSaveBadgeClass(entry);
    badge.textContent = scriptSaveBadgeText(entry);
  }

  function onScriptFieldChange(e) {
    var localId = e.target.getAttribute("data-entry-id");
    var entry = getScriptEntry(localId);
    if (!entry) return;

    if (e.target.classList.contains("script-niche")) {
      entry.niche = e.target.value;
    } else if (e.target.classList.contains("script-body")) {
      entry.script = e.target.value;
      updateScriptReadingTime(entry);
    }

    entry.dirty = true;
    entry.saveError = null;
    updateScriptCardBadge(entry);
    updateScriptsStatus();
  }

  function addScriptEntry() {
    state.scriptEntries.push(makeScriptEntry());
    renderScriptsList();
    updateScriptsStatus();
  }

  function ensureScriptsBootstrapped() {
    if (!state.scriptEntries.length) {
      addScriptEntry();
    }
  }

  function updateScriptsStatus() {
    if (!els.scriptsStatus) return;
    if (!SCRIPTS_SAVE_TO_AIRTABLE) {
      els.scriptsStatus.textContent = "Local only — not saved to Airtable";
      return;
    }
    var dirtyCount = state.scriptEntries.filter(function (e) {
      return e.dirty;
    }).length;
    if (dirtyCount > 0) {
      els.scriptsStatus.textContent =
        dirtyCount + " unsaved change" + (dirtyCount === 1 ? "" : "s") + " · auto-saves every few seconds";
    } else {
      els.scriptsStatus.textContent = "Auto-saves every few seconds";
    }
  }

  function airtableErrorMessage(data, fallback) {
    if (!data) return fallback;
    if (typeof data.error === "string") return data.error;
    if (data.error && data.error.message) return data.error.message;
    if (data.message) return data.message;
    return fallback;
  }

  async function createAirtableScriptRecord(fields) {
    var res = await fetch(SCRIPTS_AIRTABLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ records: [{ fields: fields }] }),
    });
    var data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(airtableErrorMessage(data, "Airtable create failed (" + res.status + ")"));
    }
    var rec = data.records && data.records[0];
    if (!rec || !rec.id) throw new Error("Airtable create returned no record id");
    return rec.id;
  }

  async function patchAirtableScriptRecord(recordId, fields) {
    var res = await fetch(SCRIPTS_AIRTABLE_URL, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ records: [{ id: recordId, fields: fields }] }),
    });
    var data = await parseJsonSafe(res);
    if (!res.ok) {
      throw new Error(airtableErrorMessage(data, "Airtable update failed (" + res.status + ")"));
    }
  }

  async function saveScriptEntry(entry) {
    if (!SCRIPTS_SAVE_TO_AIRTABLE) return;
    if (!entry || !entry.dirty || entry.saving) return;
    if (!entry.niche) return;

    entry.saving = true;
    entry.saveError = null;
    updateScriptCardBadge(entry);

    var fields = {
      Niche: entry.niche,
      Script: entry.script || "",
    };

    try {
      if (entry.airtableRecordId) {
        await patchAirtableScriptRecord(entry.airtableRecordId, fields);
      } else {
        entry.airtableRecordId = await createAirtableScriptRecord(fields);
      }
      entry.dirty = false;
      entry.lastSaved = new Date();
      log("script saved", { recordId: entry.airtableRecordId, niche: entry.niche });
    } catch (err) {
      entry.saveError = err.message || "Save failed";
      log("script save failed", err);
    } finally {
      entry.saving = false;
      updateScriptCardBadge(entry);
      updateScriptsStatus();
    }
  }

  function flushDirtyScripts() {
    state.scriptEntries.forEach(function (entry) {
      if (entry.dirty && !entry.saving && entry.niche) {
        saveScriptEntry(entry);
      }
    });
  }

  function initScripts() {
    if (els.scriptsPanel) {
      els.scriptsPanel.addEventListener("toggle", function () {
        if (els.scriptsPanel.open) ensureScriptsBootstrapped();
      });
    }

    if (els.scriptsAddBtn) {
      els.scriptsAddBtn.addEventListener("click", function () {
        addScriptEntry();
      });
    }

    if (SCRIPTS_SAVE_TO_AIRTABLE) {
      if (state.scriptsAutoSaveTimer) {
        clearInterval(state.scriptsAutoSaveTimer);
      }
      state.scriptsAutoSaveTimer = setInterval(flushDirtyScripts, SCRIPTS_AUTO_SAVE_MS);
    }
    updateScriptsStatus();
  }

  function bindEvents() {
    if (els.prevBtn) els.prevBtn.addEventListener("click", goPrev);
    if (els.nextBtn) els.nextBtn.addEventListener("click", goNext);

    document.addEventListener("pointerdown", unlockVideoSound, { once: true });
    document.addEventListener("keydown", unlockVideoSound, { once: true });

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
    els.statusPanel = document.getElementById("status-panel");
    els.statusText = document.getElementById("status-text");
    els.emptyPanel = document.getElementById("empty-panel");
    els.emptyPanelText = document.getElementById("empty-panel-text");
    els.swipePanel = document.getElementById("swipe-panel");
    els.swipeKeyword = document.getElementById("swipe-keyword");
    els.swipeCounter = document.getElementById("swipe-counter");
    els.swipeLibraryLink = document.getElementById("swipe-library-link");
    els.prevBtn = document.getElementById("prev-btn");
    els.nextBtn = document.getElementById("next-btn");
    els.mediaStack = document.getElementById("swipe-media-stack");
    els.swipeMeta = document.getElementById("swipe-meta");
    els.scriptsPanel = document.getElementById("swipe-scripts");
    els.scriptsList = document.getElementById("scripts-list");
    els.scriptsAddBtn = document.getElementById("scripts-add-btn");
    els.scriptsStatus = document.getElementById("scripts-status");
  }

  window.AdsTool = {
    NICHE_OPTIONS: NICHE_OPTIONS,
    getCurrentAd: getCurrentAd,
    getActiveScriptEntry: getActiveScriptEntry,
    getActiveScriptText: function () {
      var entry = getActiveScriptEntry();
      return entry ? entry.script : "";
    },
    appendToActiveScript: appendToActiveScript,
    setActiveScriptText: setActiveScriptText,
    setActiveScriptNiche: setActiveScriptNiche,
  };

  function init() {
    try {
      localStorage.removeItem("adstool_swipe_v1");
    } catch (e) {}
    initDom();
    bindEvents();
    initScripts();
    renderSwipe();
    log("initialized");
    startEndlessSwipe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
