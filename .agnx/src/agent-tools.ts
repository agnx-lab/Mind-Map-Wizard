// 场景：Mind Map Wizard Agent 工具 — 打开 / 生成 / 导出 Markdown（postMessage 桥）。
import type { WorkspaceAppHostApi } from "@agnx-lab/app-sdk";
import {
  MMW_APP_ID,
  MMW_DEFAULT_PORT,
  MMW_PANEL_ID,
} from "./constants";
import { loadMmwConfigFromHost } from "./mmw-config";

const GROUP = { groupId: "mmw", groupTitle: "思维导图" } as const;

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function openMmwTab(host: WorkspaceAppHostApi): boolean {
  if (typeof host.openSubAppTab === "function") {
    return host.openSubAppTab({
      appId: MMW_APP_ID,
      panelId: MMW_PANEL_ID,
    });
  }
  if (typeof host.openMiniAppTab === "function") {
    return host.openMiniAppTab({
      appId: MMW_APP_ID,
      panelId: MMW_PANEL_ID,
    });
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForGuestIframe(timeoutMs = 60_000): Promise<HTMLIFrameElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const root = document.querySelector(
      '[data-testid="workspace-mini-app-mind-map-wizard-root"]',
    );
    const iframe = root?.querySelector("iframe") as HTMLIFrameElement | null;
    if (iframe?.contentWindow && iframe.getAttribute("src")) {
      return iframe;
    }
    await sleep(400);
  }
  return null;
}

function postToGuest(
  iframe: HTMLIFrameElement,
  payload: Record<string, unknown>,
  timeoutMs = 45_000,
): Promise<Record<string, unknown>> {
  const requestId = `mmw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("guest_timeout"));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.type !== "agnx-mmw-result" || data.requestId !== requestId) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(data as Record<string, unknown>);
    }
    window.addEventListener("message", onMessage);
    try {
      iframe.contentWindow?.postMessage({ type: "agnx-mmw", requestId, ...payload }, "*");
    } catch (error) {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      reject(error);
    }
  });
}

async function callChatProxy(port: number, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}/agnx-api/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err =
      json && typeof json === "object" && "error" in json
        ? (json as { error?: { message?: string } }).error?.message
        : text;
    throw new Error(err || `chat_proxy_http_${res.status}`);
  }
  return json;
}

function extractMarkdownFromChat(data: unknown): string {
  const content =
    data &&
    typeof data === "object" &&
    "choices" in data &&
    Array.isArray((data as { choices: unknown[] }).choices)
      ? String(
          (
            (data as { choices: Array<{ message?: { content?: string } }> }).choices[0]?.message
              ?.content || ""
          ).trim(),
        )
      : "";
  if (!content) return "";
  try {
    const parsed = JSON.parse(content) as { markdown?: string };
    if (typeof parsed.markdown === "string") return parsed.markdown;
  } catch {
    // fall through
  }
  const jsonMatch = content.match(/\{[^]*"markdown"[^]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { markdown?: string };
      if (typeof parsed.markdown === "string") return parsed.markdown;
    } catch {
      // fall through
    }
  }
  if (content.includes("#")) return content;
  return "";
}

const GENERATE_PROMPT = (topic: string) => `Create a comprehensive, fact-rich mind map about ${topic} using the following structure:

# Matching Mind Map Title
## Branch 1
### Sub Branch A
### Sub Branch B
## Branch 2

- Each text element must be aligned to a specific hierarchical level using a new line plus the appropriate number of # symbols
- Aim for 2-3 levels of depth
- Include specific, concrete details and facts, not just category labels
- Avoid generic sections like Overview/Introduction/Conclusion
- The mind map should be in the language of the user input
- At least 3 branches from the title

**Output Format:**
Structure your response exactly like this:
{
  "markdown": "# Main Topic\\n\\n## Subtopic 1\\n- Point A\\n\\n## Subtopic 2\\n- Point B"
}`;

export function registerMmwAgentTools(host: WorkspaceAppHostApi): () => void {
  return host.registerAgentTools({
    appId: MMW_APP_ID,
    availability: "always",
    tools: [
      {
        name: "open",
        ...GROUP,
        description: "Open the Mind Map Wizard workspace tab (思维导图).",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          const opened = openMmwTab(host);
          return { ok: opened, appId: MMW_APP_ID, panelId: MMW_PANEL_ID };
        },
      },
      {
        name: "generate",
        ...GROUP,
        description:
          "Generate a mind map for a topic using configured AI (DeepSeek / OpenRouter / Ollama), open the Tab, and render it in Mind Map Wizard.",
        inputSchema: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Mind map topic, e.g. 量子计算入门",
            },
          },
          required: ["topic"],
          additionalProperties: false,
        },
        execute: async (raw) => {
          const input = asObject(raw);
          const topic = asOptionalString(input.topic);
          if (!topic) {
            return { ok: false, error: "topic_required" };
          }
          openMmwTab(host);
          const cfg = await loadMmwConfigFromHost(host.config);
          const port = cfg.port || MMW_DEFAULT_PORT;
          const model =
            cfg.aiProvider === "deepseek"
              ? cfg.deepseekModel || "deepseek-chat"
              : cfg.aiProvider === "ollama"
                ? "llama3.2"
                : "openrouter/auto";
          let markdown = "";
          try {
            const chat = await callChatProxy(port, {
              model,
              messages: [{ role: "user", content: GENERATE_PROMPT(topic) }],
              max_tokens: 2000,
              temperature: 0.7,
            });
            markdown = extractMarkdownFromChat(chat);
          } catch (error) {
            return {
              ok: false,
              error: "chat_failed",
              message: error instanceof Error ? error.message : String(error),
              hint: "在思维导图详情配置 DeepSeek API Key（或 OpenRouter / Ollama）后重试",
            };
          }
          if (!markdown.trim()) {
            return { ok: false, error: "empty_markdown", topic };
          }
          const iframe = await waitForGuestIframe();
          if (!iframe) {
            return {
              ok: false,
              error: "guest_not_ready",
              topic,
              markdownPreview: markdown.slice(0, 200),
            };
          }
          // ping 等待 Guest 脚本就绪
          try {
            await postToGuest(iframe, { action: "ping" }, 15_000);
          } catch {
            await sleep(2000);
          }
          const applied = await postToGuest(iframe, {
            action: "apply-markdown",
            topic,
            markdown,
          });
          return {
            ok: applied.ok === true,
            topic,
            provider: cfg.aiProvider,
            applied,
            markdownChars: markdown.length,
          };
        },
      },
      {
        name: "export_markdown",
        ...GROUP,
        description:
          "Export the current mind map from the open Mind Map Wizard Tab as markdown (or mm-json fallback).",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          openMmwTab(host);
          const iframe = await waitForGuestIframe(30_000);
          if (!iframe) {
            return { ok: false, error: "guest_not_ready" };
          }
          const result = await postToGuest(iframe, { action: "export-markdown" }, 20_000);
          return result;
        },
      },
    ],
  });
}
