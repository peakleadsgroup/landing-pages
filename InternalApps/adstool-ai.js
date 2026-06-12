/**
 * Ads Tool — AI script lab + developer console
 */
(function () {
  "use strict";

  var LOG_PREFIX = "[AdsToolAI]";
  var AI_URL = "/api/ads-tool/ai";

  var aiState = {
    devMode: false,
    devLog: [],
    niche: "",
    transcript: "",
    transcriptSource: "",
    structure: null,
    hookIdeas: [],
    nextIdeas: [],
    busy: false,
    adKey: null,
    cacheByAd: {},
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
    if (els.aiHooksBtn) els.aiHooksBtn.disabled = busy;
    if (els.aiNextBtn) els.aiNextBtn.disabled = busy;
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

  function saveCacheForAd(ad) {
    var key = adKeyFor(ad);
    if (!key) return;
    aiState.cacheByAd[key] = {
      transcript: aiState.transcript,
      transcriptSource: aiState.transcriptSource,
      structure: aiState.structure,
      hookIdeas: aiState.hookIdeas.slice(),
      nextIdeas: aiState.nextIdeas.slice(),
    };
  }

  function loadCacheForAd(ad) {
    var key = adKeyFor(ad);
    aiState.adKey = key;
    var cached = key && aiState.cacheByAd[key];
    if (cached) {
      aiState.transcript = cached.transcript || "";
      aiState.transcriptSource = cached.transcriptSource || "";
      aiState.structure = cached.structure || null;
      aiState.hookIdeas = (cached.hookIdeas || []).slice();
      aiState.nextIdeas = (cached.nextIdeas || []).slice();
    } else {
      aiState.transcript = "";
      aiState.transcriptSource = "";
      aiState.structure = null;
      aiState.hookIdeas = [];
      aiState.nextIdeas = [];
    }
    renderAiPanel();
  }

  function renderStructure() {
    if (!els.aiStructure) return;
    if (!aiState.structure) {
      els.aiStructure.innerHTML = '<p class="ads-muted">Run transcribe &amp; analyze to see hook / body / CTA.</p>';
      return;
    }
    var s = aiState.structure;
    els.aiStructure.innerHTML =
      "<div class=\"ads-ai-block\"><strong>Hook</strong><p>" +
      escapeHtml(s.hook || "") +
      "</p></div>" +
      "<div class=\"ads-ai-block\"><strong>Body</strong><p>" +
      escapeHtml(s.body || "") +
      "</p></div>" +
      "<div class=\"ads-ai-block\"><strong>CTA</strong><p>" +
      escapeHtml(s.cta || "") +
      "</p></div>" +
      (s.notes
        ? "<div class=\"ads-ai-block\"><strong>Notes</strong><p>" + escapeHtml(s.notes) + "</p></div>"
        : "");
  }

  function renderIdeaList(container, ideas, className, emptyText) {
    if (!container) return;
    if (!ideas || !ideas.length) {
      container.innerHTML = '<p class="ads-muted">' + escapeHtml(emptyText) + "</p>";
      return;
    }
    container.innerHTML = ideas
      .map(function (idea, i) {
        return (
          '<button type="button" class="ads-idea-btn ' +
          className +
          '" data-idea-index="' +
          i +
          '">' +
          escapeHtml(idea) +
          "</button>"
        );
      })
      .join("");
  }

  function renderAiPanel() {
    if (els.aiTranscript) {
      els.aiTranscript.value = aiState.transcript || "";
      if (els.aiTranscriptSource) {
        els.aiTranscriptSource.textContent = aiState.transcriptSource
          ? "Source: " + aiState.transcriptSource
          : "";
      }
    }
    renderStructure();
    renderIdeaList(els.aiHookIdeas, aiState.hookIdeas, "ai-hook-idea", "Generate hooks to see ideas.");
    renderIdeaList(els.aiNextIdeas, aiState.nextIdeas, "ai-next-idea", "Generate next-sentence ideas to see options.");
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

  function appendToActiveScript(text, mode) {
    var bridge = getBridge();
    if (!bridge || !bridge.appendToActiveScript) return;
    bridge.appendToActiveScript(text, mode || "append");
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

      saveCacheForAd(ad);
      renderAiPanel();
      log("transcribe+analyze done", { source: aiState.transcriptSource });
    } catch (err) {
      log("transcribe failed", err);
      alert(err.message || "Transcribe/analyze failed");
    } finally {
      setBusy(false);
    }
  }

  async function runGenerateHooks() {
    var niche = getSelectedNiche();
    if (!niche) {
      alert("Select a niche first.");
      return;
    }
    aiState.niche = niche;
    syncNicheToScriptEntry(niche);

    if (!aiState.structure && !aiState.transcript) {
      alert("Transcribe & analyze the ad first.");
      return;
    }

    setBusy(true);
    try {
      var data = await callAi("generate_hooks", {
        niche: niche,
        sourceHook: (aiState.structure && aiState.structure.hook) || "",
        transcript: aiState.transcript,
        structure: aiState.structure,
      });
      aiState.hookIdeas = data.ideas || [];
      var bridge = getBridge();
      var ad = bridge && bridge.getCurrentAd ? bridge.getCurrentAd() : null;
      saveCacheForAd(ad);
      renderAiPanel();
    } catch (err) {
      alert(err.message || "Hook generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function runGenerateNext() {
    var niche = getSelectedNiche();
    if (!niche) {
      alert("Select a niche first.");
      return;
    }
    aiState.niche = niche;
    syncNicheToScriptEntry(niche);

    var bridge = getBridge();
    var scriptSoFar = bridge && bridge.getActiveScriptText ? bridge.getActiveScriptText() : "";
    if (!scriptSoFar.trim()) {
      alert("Write or select a hook in the Script box first.");
      return;
    }

    setBusy(true);
    try {
      var data = await callAi("generate_next", {
        niche: niche,
        scriptSoFar: scriptSoFar,
        transcript: aiState.transcript,
        structure: aiState.structure,
      });
      aiState.nextIdeas = data.ideas || [];
      var ad = bridge.getCurrentAd ? bridge.getCurrentAd() : null;
      saveCacheForAd(ad);
      renderAiPanel();
    } catch (err) {
      alert(err.message || "Next-sentence generation failed");
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
    if (els.aiHooksBtn) {
      els.aiHooksBtn.addEventListener("click", runGenerateHooks);
    }
    if (els.aiNextBtn) {
      els.aiNextBtn.addEventListener("click", runGenerateNext);
    }

    if (els.aiNicheSelect) {
      els.aiNicheSelect.addEventListener("change", function () {
        aiState.niche = els.aiNicheSelect.value;
        syncNicheToScriptEntry(aiState.niche);
      });
    }

    if (els.aiHookIdeas) {
      els.aiHookIdeas.addEventListener("click", function (e) {
        var btn = e.target.closest(".ai-hook-idea");
        if (!btn) return;
        var idx = Number(btn.getAttribute("data-idea-index"));
        var idea = aiState.hookIdeas[idx];
        if (!idea) return;
        appendToActiveScript(idea, "set_or_append");
      });
    }

    if (els.aiNextIdeas) {
      els.aiNextIdeas.addEventListener("click", function (e) {
        var btn = e.target.closest(".ai-next-idea");
        if (!btn) return;
        var idx = Number(btn.getAttribute("data-idea-index"));
        var idea = aiState.nextIdeas[idx];
        if (!idea) return;
        appendToActiveScript(idea, "append_sentence");
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
    els.aiNicheSelect.innerHTML =
      '<option value="">Select niche…</option>' +
      options
        .map(function (n) {
          return '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + "</option>";
        })
        .join("");
  }

  function initDom() {
    els.devModeToggle = document.getElementById("dev-mode-toggle");
    els.devConsole = document.getElementById("dev-console");
    els.devLog = document.getElementById("dev-log");
    els.devClearBtn = document.getElementById("dev-clear-btn");
    els.aiTranscribeBtn = document.getElementById("ai-transcribe-btn");
    els.aiHooksBtn = document.getElementById("ai-hooks-btn");
    els.aiNextBtn = document.getElementById("ai-next-btn");
    els.aiNicheSelect = document.getElementById("ai-niche-select");
    els.aiTranscript = document.getElementById("ai-transcript");
    els.aiTranscriptSource = document.getElementById("ai-transcript-source");
    els.aiStructure = document.getElementById("ai-structure");
    els.aiHookIdeas = document.getElementById("ai-hook-ideas");
    els.aiNextIdeas = document.getElementById("ai-next-ideas");
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
    renderAiPanel();
    renderDevConsole();
    log("initialized");
  }

  window.AdsToolAI = {
    onAdChanged: function (ad) {
      if (!ad) return;
      var key = adKeyFor(ad);
      if (key === aiState.adKey) return;
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
