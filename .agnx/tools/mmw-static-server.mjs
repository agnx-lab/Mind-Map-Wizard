#!/usr/bin/env node
/**
 * 场景：Mind Map Wizard 静态站 + DeepSeek/OpenAI 兼容聊天反代（避 CORS）。
 * 由 ensure 拉起；POST /agnx-api/chat/completions → 按 agnx-host-config.json 转发。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const port = Number(process.env.MMW_PORT || process.argv[2] || 3095);
const host = "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json",
};

async function loadHostConfig() {
  try {
    const raw = await readFile(path.join(repoRoot, "agnx-host-config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { aiProvider: "openrouter" };
  }
}

function resolveUpstream(cfg) {
  const provider = cfg.aiProvider === "ollama" ? "ollama" : cfg.aiProvider === "deepseek" ? "deepseek" : "openrouter";
  if (provider === "ollama") {
    const base = String(cfg.ollamaBaseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "");
    return { provider, url: `${base}/v1/chat/completions`, apiKey: null };
  }
  if (provider === "deepseek") {
    const base = String(cfg.deepseekBaseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
    return {
      provider,
      url: `${base}/chat/completions`,
      apiKey: cfg.deepseekApiKey || cfg.openRouterApiKey || process.env.DEEPSEEK_API_KEY || null,
    };
  }
  return {
    provider: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: cfg.openRouterApiKey || process.env.OPENROUTER_API_KEY || null,
  };
}

function sanitizePayload(provider, payload) {
  if (provider === "openrouter") return payload;
  const clean = { ...payload };
  delete clean.plugins;
  delete clean.reasoning;
  if (provider === "deepseek" && (!clean.model || String(clean.model).includes("/"))) {
    clean.model = "deepseek-chat";
  }
  return clean;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleChatProxy(req, res) {
  const cfg = await loadHostConfig();
  const upstream = resolveUpstream(cfg);
  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: { message: "invalid JSON body" } }));
    return;
  }
  if (!upstream.apiKey && upstream.provider !== "ollama") {
    res.writeHead(401, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(
      JSON.stringify({
        error: {
          message: `缺少 ${upstream.provider} API Key（请在思维导图详情配置，或设环境变量）`,
        },
      }),
    );
    return;
  }
  const body = JSON.stringify(sanitizePayload(upstream.provider, payload));
  const headers = { "Content-Type": "application/json" };
  if (upstream.apiKey) {
    headers.Authorization = `Bearer ${upstream.apiKey}`;
  }
  if (upstream.provider === "openrouter") {
    headers["HTTP-Referer"] = "http://127.0.0.1";
    headers["X-Title"] = "Mind Map Wizard (Agnx)";
  }
  try {
    const upstreamRes = await fetch(upstream.url, { method: "POST", headers, body });
    const text = await upstreamRes.text();
    res.writeHead(upstreamRes.status, {
      "Content-Type": upstreamRes.headers.get("content-type") || "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(text);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(
      JSON.stringify({
        error: { message: error instanceof Error ? error.message : String(error) },
      }),
    );
  }
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root)) return null;
  return full;
}

async function serveStatic(req, res) {
  const filePath = safeJoin(repoRoot, req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    let st = await stat(filePath);
    let finalPath = filePath;
    if (st.isDirectory()) {
      finalPath = path.join(filePath, "index.html");
      st = await stat(finalPath);
    }
    const data = await readFile(finalPath);
    const ext = path.extname(finalPath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": ext === ".html" || ext === ".js" || ext === ".json" ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }
  if (req.method === "POST" && url.startsWith("/agnx-api/chat/completions")) {
    await handleChatProxy(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }
  res.writeHead(405);
  res.end("Method Not Allowed");
});

server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ ok: true, kind: "mmw-static-server", port, origin: `http://${host}:${port}/` })}\n`,
  );
});

server.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
