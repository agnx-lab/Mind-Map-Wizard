// 场景：Mind Map Wizard host.config 文档 — OpenRouter / DeepSeek / Ollama。
import type { WorkspaceAppConfigApi } from "@getagnx/app-sdk";
import { MMW_APP_ID, MMW_CONFIG_KEY, MMW_DEFAULT_PORT } from "./constants";

export type MmwAiProvider = "openrouter" | "deepseek" | "ollama";

export interface MmwAppConfigDocument {
  version: 1;
  port: number;
  aiProvider: MmwAiProvider;
  openRouterApiKey?: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  ollamaBaseUrl?: string;
}

export function defaultMmwAppConfigDocument(): MmwAppConfigDocument {
  return {
    version: 1,
    port: MMW_DEFAULT_PORT,
    aiProvider: "deepseek",
    deepseekBaseUrl: "https://api.deepseek.com",
    deepseekModel: "deepseek-chat",
    ollamaBaseUrl: "http://127.0.0.1:11434",
  };
}

function normalizeProvider(raw: unknown): MmwAiProvider {
  if (raw === "ollama") return "ollama";
  if (raw === "openrouter") return "openrouter";
  return "deepseek";
}

function normalizeSecret(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeMmwAppConfigDocument(raw: unknown): MmwAppConfigDocument {
  const defaults = defaultMmwAppConfigDocument();
  if (!raw || typeof raw !== "object") return defaults;
  const doc = raw as Partial<MmwAppConfigDocument>;
  const port = Number(doc.port);
  return {
    version: 1,
    port:
      Number.isFinite(port) && port > 0 && port <= 65535
        ? Math.floor(port)
        : defaults.port,
    aiProvider: normalizeProvider(doc.aiProvider),
    openRouterApiKey: normalizeSecret(doc.openRouterApiKey),
    deepseekApiKey: normalizeSecret(doc.deepseekApiKey),
    deepseekBaseUrl:
      normalizeSecret(doc.deepseekBaseUrl)?.replace(/\/+$/, "") || defaults.deepseekBaseUrl,
    deepseekModel: normalizeSecret(doc.deepseekModel) || defaults.deepseekModel,
    ollamaBaseUrl:
      normalizeSecret(doc.ollamaBaseUrl)?.replace(/\/+$/, "") || defaults.ollamaBaseUrl,
  };
}

export async function loadMmwConfigFromHost(
  config: WorkspaceAppConfigApi | null | undefined,
): Promise<MmwAppConfigDocument> {
  if (!config?.get) return defaultMmwAppConfigDocument();
  try {
    const raw = await config.get({
      scope: "app",
      appId: MMW_APP_ID,
      key: MMW_CONFIG_KEY,
      defaultValue: null,
    });
    return normalizeMmwAppConfigDocument(raw);
  } catch {
    return defaultMmwAppConfigDocument();
  }
}

export async function saveMmwConfigToHost(
  config: WorkspaceAppConfigApi | null | undefined,
  patch: Partial<
    Pick<
      MmwAppConfigDocument,
      | "port"
      | "aiProvider"
      | "openRouterApiKey"
      | "deepseekApiKey"
      | "deepseekBaseUrl"
      | "deepseekModel"
      | "ollamaBaseUrl"
    >
  >,
): Promise<MmwAppConfigDocument> {
  const current = await loadMmwConfigFromHost(config);
  const merged: MmwAppConfigDocument = {
    ...current,
    ...patch,
    version: 1,
  };
  if (patch.openRouterApiKey === "") delete merged.openRouterApiKey;
  if (patch.deepseekApiKey === "") delete merged.deepseekApiKey;
  const normalized = normalizeMmwAppConfigDocument(merged);
  if (!config?.set) return normalized;
  await config.set({
    scope: "app",
    appId: MMW_APP_ID,
    key: MMW_CONFIG_KEY,
    value: normalized,
  });
  return normalized;
}

export function toPublicHostConfigJson(doc: MmwAppConfigDocument): Record<string, unknown> {
  return {
    version: 1,
    aiProvider: doc.aiProvider,
    ollamaBaseUrl: doc.ollamaBaseUrl,
    deepseekBaseUrl: doc.deepseekBaseUrl,
    deepseekModel: doc.deepseekModel,
    openRouterApiKey: doc.openRouterApiKey || undefined,
    deepseekApiKey: doc.deepseekApiKey || undefined,
  };
}
