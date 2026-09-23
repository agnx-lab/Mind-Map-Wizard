// 场景：Agnx M1/M2 — stub 外呼；host.config 注入；DeepSeek 走本机反代；Agent postMessage 桥。
(function agnxMmwLocalOnly() {
  const BLOCKED = /stats\.mindmapwizard\.com|share\.mindmapwizard\.com/i;
  const ENCRYPT_KEY = "mmw_encryption_key_2024";
  const AI_PROVIDER_KEY = "mmw-ai-provider";
  const OLLAMA_BASE_URL_KEY = "mmw-ollama-base-url";
  const DEEPSEEK_MODEL_KEY = "mmw-deepseek-model";

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
    // DeepSeek / 统一本机反代：避 CORS，密钥留在 ensure 侧
    window.getChatCompletionsUrl = function agnxGetChatCompletionsUrl() {
      const p = getProvider();
      if (p === "ollama") {
        const base = (localStorage.getItem(OLLAMA_BASE_URL_KEY) || "http://127.0.0.1:11434").replace(
          /\/+$/,
          "",
        );
        return `${base}/v1/chat/completions`;
      }
      // deepseek + openrouter 都可走本机反代（deepseek 必须）
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
      // deepseek key 在反代侧；iframe 可不弹 OpenRouter 对话框
      return getProvider() === "openrouter";
    };

    if (provider === "deepseek") {
      try {
        // 避免模型选择器卡在 openrouter 专属 id
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
      // deepseek key 不进 iframe localStorage（反代读站根 json）；有 key 时假装已配置以免弹窗
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

  function exportCurrentMarkdown() {
    try {
      if (typeof window.DownloadHandler?.downloadMarkdown === "function") {
        // 只取内容：复用 downloadMarkdown 的 walk 逻辑太重；优先 currentMindmap.markdown
      }
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
        event.source?.postMessage({ type: "agnx-mmw-result", requestId: data.requestId, ...payload }, "*");
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
        // 触发站内生成：填 prompt 并点生成（与用户手势同路径）
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

  installShareStub();
  void applyHostConfig().then(() => {
    installAiProviderPatches();
  });
  document.addEventListener("DOMContentLoaded", () => {
    installShareStub();
    installAiProviderPatches();
  });
  window.addEventListener("load", () => {
    installShareStub();
    installAiProviderPatches();
  });
  window.addEventListener("message", handleAgentMessage);
})();
