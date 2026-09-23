// 场景：Agnx M1 — 本机模式：屏蔽 stats/share 外呼；应用 /agnx-host-config.json 到 localStorage。
(function agnxMmwLocalOnly() {
  const BLOCKED =
    /stats\.mindmapwizard\.com|share\.mindmapwizard\.com/i;
  const ENCRYPT_KEY = "mmw_encryption_key_2024";

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

  async function applyHostConfig() {
    try {
      const res = await originalFetch("/agnx-host-config.json", { cache: "no-store" });
      if (!res.ok) return;
      const cfg = await res.json();
      if (!cfg || typeof cfg !== "object") return;
      if (cfg.aiProvider === "ollama" || cfg.aiProvider === "openrouter") {
        localStorage.setItem("mmw-ai-provider", cfg.aiProvider);
      }
      if (typeof cfg.ollamaBaseUrl === "string" && cfg.ollamaBaseUrl.trim()) {
        localStorage.setItem("mmw-ollama-base-url", cfg.ollamaBaseUrl.trim().replace(/\/+$/, ""));
      }
      if (typeof cfg.openRouterApiKey === "string" && cfg.openRouterApiKey.trim()) {
        localStorage.setItem(
          "openrouter-api-key-encrypted",
          encryptApiKey(cfg.openRouterApiKey.trim()),
        );
      }
      if (cfg.disableAiFeatures === true) {
        localStorage.setItem("mmw-disable-ai-features", "true");
      }
      console.info("[agnx-mmw] applied host config");
    } catch (error) {
      console.warn("[agnx-mmw] host config skip", error);
    }
  }

  installShareStub();
  void applyHostConfig();
  document.addEventListener("DOMContentLoaded", installShareStub);
  window.addEventListener("load", installShareStub);
})();
