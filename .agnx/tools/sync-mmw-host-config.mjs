#!/usr/bin/env node
/**
 * 场景：短跑 sidecar — 将 host.config mmw-prefs 同步为站根 agnx-host-config.json（iframe 可读）。
 * 用法：node .agnx/tools/sync-mmw-host-config.mjs [--agnx-home <path>] [--status]
 * stdout：单行 JSON { ok, configPath, outPath, aiProvider, hasOpenRouterKey, synced? }
 */
import { access, constants as fsConstants, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const APP_ID = "mind-map-wizard";
const CONFIG_KEY = "mmw-prefs";
const OUT_NAME = "agnx-host-config.json";

function parseArgs(argv) {
  let statusOnly = false;
  let agnxHome = process.env.AGNX_HOME || "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--status") {
      statusOnly = true;
    } else if ((arg === "--agnx-home" || arg === "--agnxHome") && next) {
      agnxHome = String(next).trim();
      i += 1;
    }
  }
  if (!agnxHome) {
    agnxHome = path.join(os.homedir(), ".agnx-dev");
  }
  return { statusOnly, agnxHome };
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function hostConfigPath(agnxHome) {
  return path.join(agnxHome, "apps", "data", APP_ID, "config", `${CONFIG_KEY}.json`);
}

function normalizePrefs(raw) {
  const doc = raw && typeof raw === "object" ? raw : {};
  const pick = (v) => (typeof v === "string" ? v.trim() : "");
  const port = Number(doc.port);
  return {
    version: 1,
    port: Number.isFinite(port) && port > 0 && port <= 65535 ? Math.floor(port) : 3095,
    aiProvider: doc.aiProvider === "ollama" ? "ollama" : "openrouter",
    openRouterApiKey: pick(doc.openRouterApiKey),
    ollamaBaseUrl: (pick(doc.ollamaBaseUrl) || "http://127.0.0.1:11434").replace(/\/+$/, ""),
  };
}

async function loadPrefs(agnxHome) {
  const configPath = hostConfigPath(agnxHome);
  if (!(await pathExists(configPath))) {
    return { configPath, prefs: normalizePrefs(null) };
  }
  try {
    const raw = JSON.parse(await readFile(configPath, "utf8"));
    return { configPath, prefs: normalizePrefs(raw) };
  } catch {
    return { configPath, prefs: normalizePrefs(null) };
  }
}

function toPublicJson(prefs) {
  const out = {
    version: 1,
    aiProvider: prefs.aiProvider,
    ollamaBaseUrl: prefs.ollamaBaseUrl,
  };
  if (prefs.openRouterApiKey) {
    out.openRouterApiKey = prefs.openRouterApiKey;
  }
  return out;
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  const { statusOnly, agnxHome } = parseArgs(process.argv.slice(2));
  const { configPath, prefs } = await loadPrefs(agnxHome);
  const outPath = path.join(repoRoot, OUT_NAME);
  const publicDoc = toPublicJson(prefs);

  if (statusOnly) {
    emit({
      ok: true,
      configPath,
      outPath,
      aiProvider: prefs.aiProvider,
      port: prefs.port,
      hasOpenRouterKey: Boolean(prefs.openRouterApiKey),
      outExists: await pathExists(outPath),
    });
    return;
  }

  await writeFile(outPath, `${JSON.stringify(publicDoc, null, 2)}\n`, "utf8");
  emit({
    ok: true,
    synced: true,
    configPath,
    outPath,
    aiProvider: prefs.aiProvider,
    port: prefs.port,
    hasOpenRouterKey: Boolean(prefs.openRouterApiKey),
  });
}

main().catch((error) => {
  emit({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
