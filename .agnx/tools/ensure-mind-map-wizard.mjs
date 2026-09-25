#!/usr/bin/env node
/**
 * 场景：短跑 sidecar — 确保 Mind Map Wizard 静态站已在 loopback 监听（仓根为 /）。
 * 用法：node .agnx/tools/ensure-mind-map-wizard.mjs [--work-dir <dataRoot>] [--port <n>] [--force-restart]
 * stdout：单行 JSON { ok, port, origin, reused, pid?, warnings? }
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants as fsConstants, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const defaultPort = 3095;
const serverScript = path.join(__dirname, "mmw-static-server.mjs");

function parseArgs(argv) {
  let workDir = process.env.AGNX_APP_DATA_ROOT || "";
  let port = defaultPort;
  let forceRestart = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--work-dir" || arg === "--workDir") && next) {
      workDir = String(next).trim();
      i += 1;
    } else if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) {
        port = n;
      }
      i += 1;
    } else if (arg === "--force-restart" || arg === "--forceRestart") {
      forceRestart = true;
    }
  }
  return {
    workDir: workDir || path.join(repoRoot, ".agnx-mmw-runtime"),
    port,
    forceRestart,
  };
}

function resolveAgnxHome() {
  return (
    process.env.AGNX_HOME ||
    path.join(os.homedir(), process.env.AGNX_DEV === "0" ? ".agnx" : ".agnx-dev")
  );
}

async function syncHostConfigJson(agnxHome) {
  const syncScript = path.join(__dirname, "sync-mmw-host-config.mjs");
  if (!(await pathExists(syncScript))) {
    return { ok: true, skipped: true };
  }
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [syncScript, "--agnx-home", agnxHome],
      { cwd: repoRoot, timeout: 15_000, maxBuffer: 256 * 1024 },
    );
    const line = String(stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .at(-1);
    return line ? JSON.parse(line) : { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, error: msg.slice(0, 400) };
  }
}

async function readPrefsFingerprint(agnxHome) {
  const prefsPath = path.join(
    agnxHome,
    "apps",
    "data",
    "mind-map-wizard",
    "config",
    "mmw-prefs.json",
  );
  try {
    const raw = await readFile(prefsPath, "utf8");
    return raw.trim();
  } catch {
    return "";
  }
}

function fingerprint(cfg, prefsFp) {
  // api 版本变更时强制 ensure 重启静态服（勿只靠 prefs 指纹）
  return JSON.stringify({
    repoRoot,
    port: cfg.port,
    prefsFp,
    server: "mmw-static-server",
    api: "mindmap-store-v1",
  });
}

async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readState(statePath) {
  try {
    const raw = await readFile(statePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeState(statePath, payload) {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(payload, null, 2), "utf8");
}

function httpGetOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 2500 }, (res) => {
      res.resume();
      resolve(res.statusCode != null && res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(origin, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    if (await httpGetOk(origin)) {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPid(pid) {
  if (!isPidAlive(pid)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // ignore
  }
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const indexHtml = path.join(repoRoot, "index.html");
  if (!(await pathExists(indexHtml))) {
    emit({ ok: false, error: `缺少 index.html：${indexHtml}` });
    process.exitCode = 1;
    return;
  }
  if (!(await pathExists(serverScript))) {
    emit({ ok: false, error: `缺少 mmw-static-server.mjs：${serverScript}` });
    process.exitCode = 1;
    return;
  }

  const agnxHome = resolveAgnxHome();
  const syncResult = await syncHostConfigJson(agnxHome);
  const warnings = [];
  if (!syncResult.ok) {
    warnings.push(`host-config sync: ${syncResult.error || "failed"}`);
  }

  await mkdir(cfg.workDir, { recursive: true });
  const statePath = path.join(cfg.workDir, "mind-map-wizard.json");
  const origin = `http://127.0.0.1:${cfg.port}/`;
  const prefsFp = await readPrefsFingerprint(agnxHome);
  const fp = fingerprint(cfg, prefsFp);
  const prev = await readState(statePath);

  if (
    !cfg.forceRestart &&
    prev?.ok &&
    prev.fingerprint === fp &&
    isPidAlive(prev.pid) &&
    (await httpGetOk(origin))
  ) {
    emit({
      ok: true,
      port: cfg.port,
      origin,
      reused: true,
      pid: prev.pid,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
    return;
  }

  if (prev?.pid) {
    stopPid(prev.pid);
    await sleep(400);
  }

  const child = spawn(process.execPath, [serverScript, String(cfg.port)], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      MMW_PORT: String(cfg.port),
      AGNX_HOME: agnxHome,
    },
  });
  child.unref();
  const pid = child.pid;

  const healthy = await waitHealthy(origin);
  if (!healthy || !isPidAlive(pid)) {
    if (pid) stopPid(pid);
    emit({
      ok: false,
      port: cfg.port,
      origin,
      error: "静态站未在超时内就绪（mmw-static-server）",
      pid,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
    process.exitCode = 1;
    return;
  }

  await writeState(statePath, {
    ok: true,
    port: cfg.port,
    origin,
    pid,
    fingerprint: fp,
    startedAt: new Date().toISOString(),
  });

  emit({
    ok: true,
    port: cfg.port,
    origin,
    reused: false,
    pid,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}

main().catch((error) => {
  emit({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
