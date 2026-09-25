// 场景：Agnx M1/M2/M3 — stub 外呼；host.config；DeepSeek 反代；Agent 桥；本机导图历史跨壳同步。
(function agnxMmwLocalOnly() {
  const BLOCKED = /stats\.mindmapwizard\.com|share\.mindmapwizard\.com/i;
  const ENCRYPT_KEY = "mmw_encryption_key_2024";
  const AI_PROVIDER_KEY = "mmw-ai-provider";
  const OLLAMA_BASE_URL_KEY = "mmw-ollama-base-url";
  const DEEPSEEK_MODEL_KEY = "mmw-deepseek-model";
  const HISTORY_KEY = "mindmap-history";
  const CURRENT_KEY = "json-mindmap-content";
  const STORE_KEYS = new Set([HISTORY_KEY, CURRENT_KEY]);
  const STORE_API = "/agnx-api/mindmap-store";
  const MAX_HISTORY = 100;

  const storageProto = Storage.prototype;
  const rawGetItem = storageProto.getItem;
  const rawSetItem = storageProto.setItem;
  const rawRemoveItem = storageProto.removeItem;

  let persistTimer = null;
  let hydrateDone = false;
  let persistInFlight = false;
  let persistQueued = false;

  function encryptApiKey(apiKey) {
    if (!apiKey) return "";
    let encrypted = "";
    for (let i = 0; i < apiKey.length; i++) {
      const keyChar = ENCRYPT_KEY.charCodeAt(i % ENCRYPT_KEY.length);
      encrypted += String.fromCharCode(apiKey.charCodeAt(i) ^ keyChar);
    }
    return btoa(encrypted);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = function agnxFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : String(input || "");
    if (BLOCKED.test(url)) {
      return Promise.resolve(new Response("", { status: 204, statusText: "No Content" }));
    }
    return originalFetch(input, init);
  };

  function showLocalShareDialog() {
    if (document.querySelector(".share-dialog")) return;
    const shareButton = document.querySelector(".share-button");
    if (shareButton) {
      shareButton.disabled = true;
      shareButton.style.opacity = "0.5";
    }
    const shareOverlay = document.createElement("div");
    shareOverlay.className = "share-overlay";
    const dialog = document.createElement("div");
    dialog.className = "share-dialog";
    dialog.innerHTML = `
      <h3>本机模式</h3>
      <p>Agnx 子应用已关闭云端分享（CC BY-NC / 隐私）。请用导出 PDF / JPG / SVG。</p>
      <div class="dialog-buttons">
        <button type="button" class="dialog-button confirm" id="agnx-share-close">知道了</button>
      </div>
    `;
    document.body.appendChild(shareOverlay);
    document.body.appendChild(dialog);
    setTimeout(() => {
      shareOverlay.classList.add("show");
      dialog.classList.add("show");
    }, 10);
    const close = () => {
      shareOverlay.classList.remove("show");
      dialog.classList.remove("show");
      setTimeout(() => {
        shareOverlay.remove();
        dialog.remove();
        if (shareButton) {
          shareButton.disabled = false;
          shareButton.style.opacity = "1";
        }
      }, 300);
    };
    shareOverlay.addEventListener("click", close);
    dialog.querySelector("#agnx-share-close")?.addEventListener("click", close);
  }

  function installShareStub() {
    window.shareMindmap = showLocalShareDialog;
  }

  function getProvider() {
    const raw = localStorage.getItem(AI_PROVIDER_KEY);
    if (raw === "ollama" || raw === "deepseek" || raw === "openrouter") return raw;
    return "openrouter";
  }

  function installAiProviderPatches() {
    const provider = getProvider();
    window.getChatCompletionsUrl = function agnxGetChatCompletionsUrl() {
      const p = getProvider();
      if (p === "ollama") {
        const base = (localStorage.getItem(OLLAMA_BASE_URL_KEY) || "http://127.0.0.1:11434").replace(
          /\/+$/,
          "",
        );
        return `${base}/v1/chat/completions`;
      }
      if (p === "deepseek") {
        return `${window.location.origin}/agnx-api/chat/completions`;
      }
      return "https://openrouter.ai/api/v1/chat/completions";
    };

    const prevFinalize = window.finalizeAiPayload;
    window.finalizeAiPayload = function agnxFinalizeAiPayload(payload) {
      const p = getProvider();
      if (p === "openrouter" && typeof prevFinalize === "function") {
        return prevFinalize(payload);
      }
      const clean = { ...(payload || {}) };
      delete clean.plugins;
      delete clean.reasoning;
      if (p === "deepseek") {
        const model = localStorage.getItem(DEEPSEEK_MODEL_KEY) || "deepseek-chat";
        if (!clean.model || String(clean.model).includes("/")) {
          clean.model = model;
        }
      }
      return clean;
    };

    window.isLocalProvider = function agnxIsLocalProvider() {
      return getProvider() === "ollama";
    };
    window.aiRequiresApiKey = function agnxAiRequiresApiKey() {
      return getProvider() === "openrouter";
    };

    if (provider === "deepseek") {
      try {
        const model = localStorage.getItem(DEEPSEEK_MODEL_KEY) || "deepseek-chat";
        localStorage.setItem("selected-model", model);
      } catch {
        // ignore
      }
    }

    console.info("[agnx-mmw] AI provider patches", provider);
  }

  async function applyHostConfig() {
    try {
      const res = await originalFetch("/agnx-host-config.json", { cache: "no-store" });
      if (!res.ok) return;
      const cfg = await res.json();
      if (!cfg || typeof cfg !== "object") return;
      if (
        cfg.aiProvider === "ollama" ||
        cfg.aiProvider === "openrouter" ||
        cfg.aiProvider === "deepseek"
      ) {
        localStorage.setItem(AI_PROVIDER_KEY, cfg.aiProvider);
      }
      if (typeof cfg.ollamaBaseUrl === "string" && cfg.ollamaBaseUrl.trim()) {
        localStorage.setItem(OLLAMA_BASE_URL_KEY, cfg.ollamaBaseUrl.trim().replace(/\/+$/, ""));
      }
      if (typeof cfg.deepseekModel === "string" && cfg.deepseekModel.trim()) {
        localStorage.setItem(DEEPSEEK_MODEL_KEY, cfg.deepseekModel.trim());
      }
      if (typeof cfg.openRouterApiKey === "string" && cfg.openRouterApiKey.trim()) {
        localStorage.setItem(
          "openrouter-api-key-encrypted",
          encryptApiKey(cfg.openRouterApiKey.trim()),
        );
      }
      if (
        cfg.aiProvider === "deepseek" &&
        ((typeof cfg.deepseekApiKey === "string" && cfg.deepseekApiKey.trim()) ||
          typeof cfg.openRouterApiKey === "string")
      ) {
        localStorage.setItem(
          "openrouter-api-key-encrypted",
          encryptApiKey("agnx-deepseek-proxy"),
        );
      }
      if (cfg.disableAiFeatures === true) {
        localStorage.setItem("mmw-disable-ai-features", "true");
      }
      console.info("[agnx-mmw] applied host config", cfg.aiProvider);
    } catch (error) {
      console.warn("[agnx-mmw] host config skip", error);
    }
  }

  function readLocalHistory() {
    try {
      const raw = rawGetItem.call(localStorage, HISTORY_KEY) || "[]";
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function readLocalCurrent() {
    try {
      return rawGetItem.call(localStorage, CURRENT_KEY) || "";
    } catch {
      return "";
    }
  }

  function mergeHistory(diskHistory, localHistory) {
    const byId = new Map();
    for (const item of [...(diskHistory || []), ...(localHistory || [])]) {
      if (!item || typeof item !== "object" || item.id == null) continue;
      const id = String(item.id);
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, item);
        continue;
      }
      const tPrev = Date.parse(prev.timestamp || 0) || 0;
      const tCur = Date.parse(item.timestamp || 0) || 0;
      if (tCur >= tPrev) {
        byId.set(id, item);
      }
    }
    return [...byId.values()]
      .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
      .slice(0, MAX_HISTORY);
  }

  function mergeCurrent(diskCurrent, localCurrent) {
    const disk = typeof diskCurrent === "string" ? diskCurrent : "";
    const local = typeof localCurrent === "string" ? localCurrent : "";
    if (!local.trim() && disk.trim()) return disk;
    if (local.trim() && !disk.trim()) return local;
    return local || disk || "";
  }

  function historyFingerprint(history) {
    try {
      return JSON.stringify(
        (history || []).map((item) => [String(item?.id ?? ""), item?.timestamp || ""]),
      );
    } catch {
      return "";
    }
  }

  function refreshHistoryUi() {
    try {
      if (typeof window.loadMindmapsLeftSidebar === "function") {
        window.loadMindmapsLeftSidebar();
      }
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: HISTORY_KEY,
          newValue: rawGetItem.call(localStorage, HISTORY_KEY),
          storageArea: localStorage,
        }),
      );
    } catch {
      // ignore
    }
  }

  function snapshotStoreFromLocal() {
    return {
      version: 1,
      history: readLocalHistory(),
      current: readLocalCurrent(),
    };
  }

  async function persistStoreNow() {
    if (persistInFlight) {
      persistQueued = true;
      return;
    }
    persistInFlight = true;
    try {
      const body = JSON.stringify(snapshotStoreFromLocal());
      const res = await originalFetch(STORE_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn("[agnx-mmw] mindmap-store persist failed", res.status);
      }
    } catch (error) {
      console.warn("[agnx-mmw] mindmap-store persist skip", error);
    } finally {
      persistInFlight = false;
      if (persistQueued) {
        persistQueued = false;
        void persistStoreNow();
      }
    }
  }

  function schedulePersist() {
    if (!hydrateDone) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistStoreNow();
    }, 250);
  }

  function installStoreBridge() {
    storageProto.setItem = function agnxSetItem(key, value) {
      rawSetItem.call(this, key, value);
      if (this === localStorage && STORE_KEYS.has(String(key))) {
        schedulePersist();
      }
    };
    storageProto.removeItem = function agnxRemoveItem(key) {
      rawRemoveItem.call(this, key);
      if (this === localStorage && STORE_KEYS.has(String(key))) {
        schedulePersist();
      }
    };
  }

  async function hydrateMindmapStore() {
    let disk = { version: 1, history: [], current: "" };
    try {
      const res = await originalFetch(STORE_API, { cache: "no-store" });
      if (res.ok) {
        const parsed = await res.json();
        if (parsed && typeof parsed === "object") {
          disk = {
            version: 1,
            history: Array.isArray(parsed.history) ? parsed.history : [],
            current: typeof parsed.current === "string" ? parsed.current : "",
          };
        }
      } else {
        console.warn("[agnx-mmw] mindmap-store get failed", res.status);
      }
    } catch (error) {
      console.warn("[agnx-mmw] mindmap-store get skip", error);
    }

    const localHistory = readLocalHistory();
    const localCurrent = readLocalCurrent();
    const mergedHistory = mergeHistory(disk.history, localHistory);
    const mergedCurrent = mergeCurrent(disk.current, localCurrent);

    try {
      rawSetItem.call(localStorage, HISTORY_KEY, JSON.stringify(mergedHistory));
      if (mergedCurrent) {
        rawSetItem.call(localStorage, CURRENT_KEY, mergedCurrent);
      }
    } catch (error) {
      console.warn("[agnx-mmw] mindmap-store seed localStorage failed", error);
    }

    const needUpload =
      historyFingerprint(mergedHistory) !== historyFingerprint(disk.history) ||
      mergedCurrent !== (disk.current || "");

    hydrateDone = true;
    if (needUpload) {
      await persistStoreNow();
    }
    refreshHistoryUi();
    console.info("[agnx-mmw] mindmap-store hydrated", {
      historyCount: mergedHistory.length,
      uploaded: needUpload,
    });
  }

  function exportCurrentMarkdown() {
    try {
      const fromCurrent =
        window.currentMindmap && typeof window.currentMindmap.markdown === "string"
          ? window.currentMindmap.markdown
          : "";
      if (fromCurrent.trim()) {
        return {
          ok: true,
          markdown: fromCurrent,
          topic: window.currentMindmapTitle || window.currentMindmap?.topic || "",
        };
      }
      const ed = document.getElementById("json-editor");
      const raw = ed?.value || localStorage.getItem("json-mindmap-content") || "";
      return {
        ok: Boolean(raw),
        markdown: raw,
        topic: window.currentMindmapTitle || "",
        format: raw.trim().startsWith("{") ? "mm-json" : "text",
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  async function handleAgentMessage(event) {
    const data = event?.data;
    if (!data || data.type !== "agnx-mmw") return;
    const reply = (payload) => {
      try {
        event.source?.postMessage(
          { type: "agnx-mmw-result", requestId: data.requestId, ...payload },
          "*",
        );
      } catch {
        // ignore
      }
    };
    try {
      if (data.action === "ping") {
        reply({ ok: true, action: "ping", provider: getProvider() });
        return;
      }
      if (data.action === "export-markdown") {
        reply({ action: "export-markdown", ...exportCurrentMarkdown() });
        return;
      }
      if (data.action === "apply-markdown") {
        const markdown = typeof data.markdown === "string" ? data.markdown : "";
        const topic = typeof data.topic === "string" ? data.topic : "Mind Map";
        if (!markdown.trim()) {
          reply({ ok: false, action: "apply-markdown", error: "markdown_required" });
          return;
        }
        if (typeof window.renderMindmap !== "function") {
          reply({ ok: false, action: "apply-markdown", error: "renderMindmap_unavailable" });
          return;
        }
        await window.renderMindmap(markdown, { playPopAnimation: true });
        try {
          window.currentMindmapTitle = topic;
          document.title = `${topic} - Mind Map Wizard`;
        } catch {
          // ignore
        }
        reply({ ok: true, action: "apply-markdown", topic });
        return;
      }
      if (data.action === "generate") {
        const topic = typeof data.topic === "string" ? data.topic.trim() : "";
        if (!topic) {
          reply({ ok: false, action: "generate", error: "topic_required" });
          return;
        }
        const prompt =
          document.getElementById("prompt-input") ||
          document.querySelector('input[placeholder*="topic"], textarea#prompt-input');
        if (prompt) {
          prompt.value = topic;
          prompt.dispatchEvent(new Event("input", { bubbles: true }));
        }
        const genBtn =
          document.querySelector('[data-action="generate"], .generate-button, #generate-button') ||
          [...document.querySelectorAll("button")].find((b) =>
            /generate|生成|create/i.test(b.textContent || ""),
          );
        if (genBtn) {
          genBtn.click();
          reply({ ok: true, action: "generate", via: "ui-click", topic });
          return;
        }
        reply({ ok: false, action: "generate", error: "generate_button_not_found", topic });
        return;
      }
      reply({ ok: false, error: "unknown_action" });
    } catch (error) {
      reply({ ok: false, error: String(error) });
    }
  }

  installStoreBridge();
  installShareStub();
  void Promise.all([applyHostConfig(), hydrateMindmapStore()]).then(() => {
    installAiProviderPatches();
  });
  document.addEventListener("DOMContentLoaded", () => {
    installShareStub();
    installAiProviderPatches();
    if (hydrateDone) {
      refreshHistoryUi();
    }
  });
  window.addEventListener("load", () => {
    installShareStub();
    installAiProviderPatches();
    if (hydrateDone) {
      refreshHistoryUi();
    }
  });
  window.addEventListener("message", handleAgentMessage);
})();
