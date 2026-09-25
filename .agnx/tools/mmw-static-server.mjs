#!/usr/bin/env node
/**
 * 场景：Mind Map Wizard 静态站 + DeepSeek 反代 + 本机导图历史 API（跨 Electron/网页共享）。
 * 由 ensure 拉起；POST /agnx-api/chat/completions；GET/PUT /agnx-api/mindmap-store。
 */
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const port = Number(process.env.MMW_PORT || process.argv[2] || 3095);
const host = "127.0.0.1";
const APP_ID = "mind-map-wizard";
const STORE_VERSION = 1;
const MAX_HISTORY = 100;
const MAX_BODY_BYTES = 24 * 1024 * 1024;

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

function resolveAgnxHome() {
  const fromEnv = String(process.env.AGNX_HOME || "").trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), process.env.AGNX_DEV === "0" ? ".agnx" : ".agnx-dev");
}

function storeFilePath() {
  return path.join(resolveAgnxHome(), "apps", "data", APP_ID, "mindmap-store.json");
}

function corsJsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extra,
  };
}

function emptyStore() {
  return {
    version: STORE_VERSION,
    history: [],
    current: "",
    updatedAt: null,
  };
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    if (item.id == null) continue;
    const mindmap = typeof item.mindmap === "string" ? item.mindmap : "";
    const timestamp =
      typeof item.timestamp === "string" && item.timestamp.trim()
        ? item.timestamp
        : new Date().toISOString();
    out.push({ id: item.id, mindmap, timestamp });
  }
  out.sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
  return out.slice(0, MAX_HISTORY);
}

function normalizeStore(raw) {
  const doc = raw && typeof raw === "object" ? raw : {};
  return {
    version: STORE_VERSION,
    history: normalizeHistory(doc.history),
    current: typeof doc.current === "string" ? doc.current : "",
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
  };
}

async function readStore() {
  try {
    const raw = JSON.parse(await readFile(storeFilePath(), "utf8"));
    return normalizeStore(raw);
  } catch {
    return emptyStore();
  }
}

async function writeStore(doc) {
  const normalized = normalizeStore({
    ...doc,
    updatedAt: new Date().toISOString(),
  });
  const filePath = storeFilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

async function loadHostConfig() {
  try {
    const raw = await readFile(path.join(repoRoot, "agnx-host-config.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { aiProvider: "openrouter" };
  }
}

function resolveUpstream(cfg) {
  const provider =
    cfg.aiProvider === "ollama" ? "ollama" : cfg.aiProvider === "deepseek" ? "deepseek" : "openrouter";
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

async function readBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error("body_too_large");
      err.code = "body_too_large";
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleChatProxy(req, res) {
  const cfg = await loadHostConfig();
  const upstream = resolveUpstream(cfg);
  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw.toString("utf8") || "{}");
  } catch (error) {
    const tooLarge = error && error.code === "body_too_large";
    res.writeHead(tooLarge ? 413 : 400, corsJsonHeaders());
    res.end(
      JSON.stringify({
        error: { message: tooLarge ? "request body too large" : "invalid JSON body" },
      }),
    );
    return;
  }
  if (!upstream.apiKey && upstream.provider !== "ollama") {
    res.writeHead(401, corsJsonHeaders());
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
    res.writeHead(502, corsJsonHeaders());
    res.end(
      JSON.stringify({
        error: { message: error instanceof Error ? error.message : String(error) },
      }),
    );
  }
}

async function handleMindmapStore(req, res) {
  if (req.method === "GET" || req.method === "HEAD") {
    const store = await readStore();
    const body = JSON.stringify(store);
    res.writeHead(200, corsJsonHeaders());
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(body);
    return;
  }
  if (req.method === "PUT" || req.method === "POST") {
    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString("utf8") || "{}");
    } catch (error) {
      const tooLarge = error && error.code === "body_too_large";
      res.writeHead(tooLarge ? 413 : 400, corsJsonHeaders());
      res.end(
        JSON.stringify({
          ok: false,
          error: tooLarge ? "body_too_large" : "invalid_json",
        }),
      );
      return;
    }
    try {
      const saved = await writeStore(payload);
      res.writeHead(200, corsJsonHeaders());
      res.end(JSON.stringify({ ok: true, store: saved }));
    } catch (error) {
      res.writeHead(500, corsJsonHeaders());
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return;
  }
  res.writeHead(405, corsJsonHeaders());
  res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
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
      "Cache-Control":
        ext === ".html" || ext === ".js" || ext === ".json" ? "no-store" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not Found");
  }
}

const server = createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }
  if (url === "/agnx-api/mindmap-store" || url.startsWith("/agnx-api/mindmap-store/")) {
    await handleMindmapStore(req, res);
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
    `${JSON.stringify({
      ok: true,
      kind: "mmw-static-server",
      port,
      origin: `http://${host}:${port}/`,
      storePath: storeFilePath(),
    })}\n`,
  );
});

server.on("error", (error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
