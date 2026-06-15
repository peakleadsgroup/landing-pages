/**
 * Ads Tool — AI-assisted living script lab + developer console
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[AdsToolAI]";
  var AI_URL = "/api/ads-tool/ai";
  var DEFAULT_SEGMENT_ORDER = ["hook", "body", "cta"];

  var SEGMENTS = {
    hook: { label: "Hook", className: "ads-seg-hook" },
    body: { label: "Body", className: "ads-seg-body" },
    cta: { label: "CTA", className: "ads-seg-cta" },
  };

  var aiState = {
    devMode: false,
    devLog: [],
    niche: "Bathrooms",
    transcript: "",
    transcriptSource: "",
    structure: null,
    segmentOrder: DEFAULT_SEGMENT_ORDER.slice(),
    variantIdeas: [],
    focusSection: "",
    busy: false,
    adKey: null,
    cacheByAd: {},
    dragSegmentKey: null,
    syncingWorkingScript: false,
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

  function getBridge() {
    return window.AdsTool || null;
  }

  function getNicheOptions() {
    var bridge = getBridge();
    return bridge && bridge.NICHE_OPTIONS ? bridge.NICHE_OPTIONS : [];
  }

  function pushDevLog(label, request, response, extra) {
    var entry = {
      ts: new Date().toISOString(),
      label: label,
      request: request,
      response: response,
      extra: extra || null,
    };
    aiState.devLog.unshift(entry);
    if (aiState.devLog.length > 40) aiState.devLog.length = 40;
    renderDevConsole();
  }

  function renderDevConsole() {
    if (!els.devConsole) return;
    if (!aiState.devMode) {
      els.devConsole.classList.add("hidden");
      return;
    }
    els.devConsole.classList.remove("hidden");

    if (!aiState.devLog.length) {
      els.devLog.innerHTML = '<p class="ads-muted">No API calls yet. Actions log full request/response payloads here.</p>';
      return;
    }

    els.devLog.innerHTML = aiState.devLog
      .map(function (entry, i) {
        return (
          '<details class="ads-dev-entry" ' +
          (i === 0 ? "open" : "") +
          ">" +
          '<summary class="ads-dev-summary">' +
          escapeHtml(entry.ts) +
          " · " +
          escapeHtml(entry.label) +
          "</summary>" +
          '<pre class="ads-dev-pre">' +
          escapeHtml(JSON.stringify({ request: entry.request, response: entry.response, extra: entry.extra }, null, 2)) +
          "</pre>" +
          "</details>"
        );
      })
      .join("");
  }

  function setBusy(busy) {
    aiState.busy = busy;
    if (els.aiTranscribeBtn) els.aiTranscribeBtn.disabled = busy;
    if (els.aiVariantsBtn) els.aiVariantsBtn.disabled = busy;
  }

  async function callAi(action, payload) {
    var body = Object.assign({ action: action, devMode: aiState.devMode }, payload || {});
    var started = Date.now();
    var res = await fetch(apiUrl(AI_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    var data = await parseJsonSafe(res);
    var durationMs = Date.now() - started;

    if (aiState.devMode) {
      pushDevLog(action, body, data, { httpStatus: res.status, durationMs: durationMs });
    }

    if (!res.ok && !data.error) {
      throw new Error("Request failed (" + res.status + ")");
    }
    if (data.ok === false || data.error) {
      throw new Error(data.error || "AI request failed");
    }
    return data;
  }

  function adKeyFor(ad) {
    if (!ad) return null;
    return ad.adArchiveId || ad.pageName || "ad";
  }

  function getWorkingScriptText() {
    if (els.aiWorkingScript) return els.aiWorkingScript.value || "";
    var bridge = getBridge();
    return bridge && bridge.getActiveScriptText ? bridge.getActiveScriptText() : "";
  }

  function setWorkingScriptText(text, syncBridge) {
    if (els.aiWorkingScript) {
      aiState.syncingWorkingScript = true;
      els.aiWorkingScript.value = text || "";
      aiState.syncingWorkingScript = false;
    }
    if (syncBridge !== false) {
      var bridge = getBridge();
      if (bridge && bridge.setActiveScriptText) {
        bridge.setActiveScriptText(text || "");
      }
    }
  }

  function appendToWorkingScript(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) return;

    var current = getWorkingScriptText();
    var next = current.trim() ? current.replace(/\s+$/, "") + "\n\n" + trimmed : trimmed;
    setWorkingScriptText(next, true);
  }

  function persistCurrentAdCache() {
    if (!aiState.adKey) return;
    aiState.cacheByAd[aiState.adKey] = {
      transcript: aiState.transcript,
      transcriptSource: aiState.transcriptSource,
      structure: aiState.structure ? Object.assign({}, aiState.structure) : null,
      segmentOrder: aiState.segmentOrder.slice(),
      variantIdeas: aiState.variantIdeas.slice(),
      focusSection: aiState.focusSection,
      workingScript: getWorkingScriptText(),
    };
  }

  function saveCacheForAd(ad) {
    if (!ad) return;
    var key = adKeyFor(ad);
    if (!key) return;
    aiState.adKey = key;
    persistCurrentAdCache();
  }

  function loadCacheForAd(ad) {
    var key = adKeyFor(ad);
    aiState.adKey = key;
    var cached = key && aiState.cacheByAd[key];
    if (cached) {
      aiState.transcript = cached.transcript || "";
      aiState.transcriptSource = cached.transcriptSource || "";
      aiState.structure = cached.structure || null;
      aiState.segmentOrder = (cached.segmentOrder || DEFAULT_SEGMENT_ORDER).slice();
      aiState.variantIdeas = (cached.variantIdeas || []).slice();
      aiState.focusSection = cached.focusSection || "";
      setWorkingScriptText(cached.workingScript || "", false);
    } else {
      aiState.transcript = "";
      aiState.transcriptSource = "";
      aiState.structure = null;
      aiState.segmentOrder = DEFAULT_SEGMENT_ORDER.slice();
      aiState.variantIdeas = [];
      aiState.focusSection = "";
      syncWorkingScriptFromBridge();
    }
    renderAiPanel();
  }

  function syncWorkingScriptFromBridge() {
    var bridge = getBridge();
    if (bridge && bridge.getActiveScriptText) {
      setWorkingScriptText(bridge.getActiveScriptText(), false);
    }
  }

  function syncStructureFromDom() {
    if (!els.aiLivingTranscript || !aiState.structure) return;
    aiState.segmentOrder.forEach(function (key) {
      var el = els.aiLivingTranscript.querySelector('.ads-seg-text[data-seg="' + key + '"]');
      if (el) {
        aiState.structure[key] = el.textContent.trim();
      }
    });
  }

  function renderLivingTranscript() {
    if (!els.aiLivingTranscript) return;

    if (!aiState.structure) {
      els.aiLivingTranscript.innerHTML =
        '<p class="ads-muted ads-living-empty">Transcribe an ad to see the hook, body, and CTA highlighted here.</p>';
      return;
    }

    var html = aiState.segmentOrder
      .map(function (key) {
        var meta = SEGMENTS[key];
        if (!meta) return "";
        var text = aiState.structure[key] || "";
        return (
          '<div class="ads-segment ' +
          meta.className +
          '" draggable="true" data-seg="' +
          key +
          '">' +
          '<button type="button" class="ads-seg-add" data-seg="' +
          key +
          '" title="Add to your script">+ Add</button>' +
          '<span class="ads-seg-label">' +
          escapeHtml(meta.label) +
          "</span>" +
          '<div class="ads-seg-text" contenteditable="true" spellcheck="true" data-seg="' +
          key +
          '">' +
          escapeHtml(text) +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    els.aiLivingTranscript.innerHTML = html;
    bindLivingTranscriptEvents();
  }

  function bindLivingTranscriptEvents() {
    if (!els.aiLivingTranscript) return;

    els.aiLivingTranscript.querySelectorAll(".ads-seg-text").forEach(function (el) {
      el.addEventListener("blur", function () {
        syncStructureFromDom();
        var bridge = getBridge();
        var ad = bridge && bridge.getCurrentAd ? bridge.getCurrentAd() : null;
        saveCacheForAd(ad);
      });
    });

    els.aiLivingTranscript.querySelectorAll(".ads-seg-add").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var key = btn.getAttribute("data-seg");
        if (!key || !aiState.structure) return;
        aiState.focusSection = key;
        appendToWorkingScript(aiState.structure[key] || "");
        var bridge = getBridge();
        saveCacheForAd(bridge && bridge.getCurrentAd ? bridge.getCurrentAd() : null);
      });
    });

    els.aiLivingTranscript.querySelectorAll(".ads-segment").forEach(function (seg) {
      seg.addEventListener("dragstart", function (e) {
        aiState.dragSegmentKey = seg.getAttribute("data-seg");
        seg.classList.add("is-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", aiState.dragSegmentKey || "");
        }
      });

      seg.addEventListener("dragend", function () {
        seg.classList.remove("is-dragging");
        els.aiLivingTranscript.querySelectorAll(".ads-segment").forEach(function (s) {
          s.classList.remove("is-drag-over");
        });
        aiState.dragSegmentKey = null;
      });

      seg.addEventListener("dragover", function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        seg.classList.add("is-drag-over");
      });

      seg.addEventListener("dragleave", function () {
        seg.classList.remove("is-drag-over");
      });

      seg.addEventListener("drop", function (e) {
        e.preventDefault();
        seg.classList.remove("is-drag-over");
        var fromKey = aiState.dragSegmentKey || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
        var toKey = seg.getAttribute("data-seg");
        if (!fromKey || !toKey || fromKey === toKey) return;

        var order = aiState.segmentOrder.slice();
        var fromIdx = order.indexOf(fromKey);
        var toIdx = order.indexOf(toKey);
        if (fromIdx < 0 || toIdx < 0) return;

        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, fromKey);
        aiState.segmentOrder = order;
        syncStructureFromDom();
        renderLivingTranscript();
        var bridge = getBridge();
        saveCacheForAd(bridge && bridge.getCurrentAd ? bridge.getCurrentAd() : null);
      });
    });
  }

  function renderVariantIdeas() {
    if (!els.aiVariantIdeas) return;
    if (!aiState.variantIdeas.length) {
      els.aiVariantIdeas.innerHTML =
        '<p class="ads-muted">Pull in a section, add your notes, then generate options.</p>';
      return;
    }
    els.aiVariantIdeas.innerHTML = aiState.variantIdeas
      .map(function (idea, i) {
        return (
          '<button type="button" class="ads-idea-btn ai-variant-idea" data-idea-index="' +
          i +
          '">' +
          escapeHtml(idea) +
          "</button>"
        );
      })
      .join("");
  }

  function renderAiPanel() {
    if (els.aiTranscriptSource) {
      els.aiTranscriptSource.textContent = aiState.transcriptSource
        ? "Transcript source: " + aiState.transcriptSource
        : aiState.transcript
          ? "Transcript ready"
          : "";
    }
    renderLivingTranscript();
    renderVariantIdeas();
    if (els.aiNicheSelect && aiState.niche) {
      els.aiNicheSelect.value = aiState.niche;
    }
  }

  function getSelectedNiche() {
    return els.aiNicheSelect ? els.aiNicheSelect.value : aiState.niche;
  }

  function syncNicheToScriptEntry(niche) {
    var bridge = getBridge();
    if (bridge && bridge.setActiveScriptNiche) {
      bridge.setActiveScriptNiche(niche);
    }
  }

  async function runTranscribeAndAnalyze() {
    var bridge = getBridge();
    var ad = bridge && bridge.getCurrentAd ? bridge.getCurrentAd() : null;
    if (!ad) {
      alert("No ad loaded.");
      return;
    }

    var videoUrl = ad.videoHdUrl || ad.videoSdUrl;
    if (!videoUrl && !ad.bodyText && !ad.caption) {
      alert("This ad has no video URL or on-screen copy to analyze.");
      return;
    }

    setBusy(true);
    try {
      var transcribe = await callAi("transcribe", {
        videoUrl: videoUrl,
        adMeta: {
          bodyText: ad.bodyText,
          caption: ad.caption,
          ctaText: ad.ctaText,
          pageName: ad.pageName,
        },
      });

      aiState.transcript = transcribe.transcript || "";
      aiState.transcriptSource = transcribe.source || "";

      var analyze = await callAi("analyze", { transcript: aiState.transcript });
      aiState.structure = analyze.structure || null;
      aiState.segmentOrder = DEFAULT_SEGMENT_ORDER.slice();
      aiState.variantIdeas = [];
      aiState.focusSection = "";

      saveCacheForAd(ad);
      renderAiPanel();
      log("transcribe+analyze done", { source: aiState.transcriptSource });
    } catch (err) {
      log("transcribe failed", err);
      alert(err.message || "Transcribe failed");
    } finally {
      setBusy(false);
    }
  }

  async function runGenerateVariants() {
    var niche = getSelectedNiche();
    if (!niche) {
      alert("Select a niche first.");
      return;
    }
    aiState.niche = niche;
    syncNicheToScriptEntry(niche);

    var scriptSoFar = getWorkingScriptText().trim();
    if (!scriptSoFar) {
      alert("Pull a section into your script or write something first.");
      return;
    }

    setBusy(true);
    try {
      var data = await callAi("generate_variants", {
        niche: niche,
        scriptSoFar: scriptSoFar,
        transcript: aiState.transcript,
        structure: aiState.structure,
        focusSection: aiState.focusSection,
      });
      aiState.variantIdeas = data.ideas || [];
      var bridge = getBridge();
      saveCacheForAd(bridge && bridge.getCurrentAd ? bridge.getCurrentAd() : null);
      renderVariantIdeas();
    } catch (err) {
      alert(err.message || "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    if (els.devModeToggle) {
      els.devModeToggle.addEventListener("change", function () {
        aiState.devMode = els.devModeToggle.checked;
        document.body.classList.toggle("ads-dev-open", aiState.devMode);
        renderDevConsole();
      });
    }

    if (els.aiTranscribeBtn) {
      els.aiTranscribeBtn.addEventListener("click", runTranscribeAndAnalyze);
    }
    if (els.aiVariantsBtn) {
      els.aiVariantsBtn.addEventListener("click", runGenerateVariants);
    }

    if (els.aiNicheSelect) {
      els.aiNicheSelect.addEventListener("change", function () {
        aiState.niche = els.aiNicheSelect.value;
        syncNicheToScriptEntry(aiState.niche);
      });
    }

    if (els.aiWorkingScript) {
      els.aiWorkingScript.addEventListener("input", function () {
        if (aiState.syncingWorkingScript) return;
        var bridge = getBridge();
        if (bridge && bridge.setActiveScriptText) {
          bridge.setActiveScriptText(els.aiWorkingScript.value);
        }
      });
    }

    if (els.aiVariantIdeas) {
      els.aiVariantIdeas.addEventListener("click", function (e) {
        var btn = e.target.closest(".ai-variant-idea");
        if (!btn) return;
        var idx = Number(btn.getAttribute("data-idea-index"));
        var idea = aiState.variantIdeas[idx];
        if (!idea) return;
        appendToWorkingScript(idea);
        var bridge = getBridge();
        saveCacheForAd(bridge && bridge.getCurrentAd ? bridge.getCurrentAd() : null);
      });
    }

    if (els.devClearBtn) {
      els.devClearBtn.addEventListener("click", function () {
        aiState.devLog = [];
        renderDevConsole();
      });
    }
  }

  function buildNicheSelect() {
    if (!els.aiNicheSelect) return;
    var options = getNicheOptions();
    els.aiNicheSelect.innerHTML = options
      .map(function (n) {
        return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + "</option>";
      })
      .join("");
    if (aiState.niche) {
      els.aiNicheSelect.value = aiState.niche;
    }
  }

  function initDom() {
    els.devModeToggle = document.getElementById("dev-mode-toggle");
    els.devConsole = document.getElementById("dev-console");
    els.devLog = document.getElementById("dev-log");
    els.devClearBtn = document.getElementById("dev-clear-btn");
    els.aiTranscribeBtn = document.getElementById("ai-transcribe-btn");
    els.aiVariantsBtn = document.getElementById("ai-variants-btn");
    els.aiNicheSelect = document.getElementById("ai-niche-select");
    els.aiTranscriptSource = document.getElementById("ai-transcript-source");
    els.aiLivingTranscript = document.getElementById("ai-living-transcript");
    els.aiWorkingScript = document.getElementById("ai-working-script");
    els.aiVariantIdeas = document.getElementById("ai-variant-ideas");
  }

  function syncNicheFromActiveScript() {
    var bridge = getBridge();
    var entry = bridge && bridge.getActiveScriptEntry ? bridge.getActiveScriptEntry() : null;
    if (entry && entry.niche && els.aiNicheSelect) {
      aiState.niche = entry.niche;
      els.aiNicheSelect.value = entry.niche;
    }
  }

  function init() {
    initDom();
    buildNicheSelect();
    bindEvents();
    syncNicheFromActiveScript();
    syncWorkingScriptFromBridge();
    renderAiPanel();
    renderDevConsole();
    log("initialized");
  }

  window.AdsToolAI = {
    onAdChanged: function (ad) {
      if (!ad) return;
      var key = adKeyFor(ad);
      if (key === aiState.adKey) return;
      persistCurrentAdCache();
      loadCacheForAd(ad);
      syncNicheFromActiveScript();
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
