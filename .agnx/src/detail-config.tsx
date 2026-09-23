// 场景：Mind Map Wizard 详情配置 — DeepSeek / OpenRouter / Ollama；保存后重挂。
import { createElement, useCallback, useEffect, useState, type ReactElement } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkspaceAppHostApi } from "@getagnx/app-sdk";
import { MMW_APP_ID, MMW_DEFAULT_PORT } from "./constants";
import { getBoundHost } from "./host-bind";
import {
  loadMmwConfigFromHost,
  saveMmwConfigToHost,
  type MmwAiProvider,
  type MmwAppConfigDocument,
  defaultMmwAppConfigDocument,
} from "./mmw-config";
import { requestMmwRuntimeRestart } from "./mmw-runtime-coordinator";

let cachedConfig: MmwAppConfigDocument = defaultMmwAppConfigDocument();

function setCachedMmwConfig(doc: MmwAppConfigDocument): void {
  cachedConfig = doc;
}

function getCachedMmwConfig(): MmwAppConfigDocument {
  return cachedConfig;
}

const styles = StyleSheet.create((theme) => ({
  col: { gap: theme.spacing[2], maxWidth: 360 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2], alignItems: "center" },
  label: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.xs },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    minWidth: 220,
  },
  chip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  chipText: { color: theme.colors.foreground, fontSize: theme.fontSize.xs },
  chipTextOn: { color: "#fff", fontSize: theme.fontSize.xs },
  warn: {
    color: theme.colors.statusWarning || theme.colors.statusDanger || "#b45309",
    fontSize: theme.fontSize.xs,
  },
  ok: { color: theme.colors.statusSuccess || "#15803d", fontSize: theme.fontSize.xs },
}));

function ProviderField(): ReactElement {
  const [provider, setProvider] = useState<MmwAiProvider>(cachedConfig.aiProvider);
  const [port, setPort] = useState(String(cachedConfig.port));
  const [ollama, setOllama] = useState(cachedConfig.ollamaBaseUrl || "http://127.0.0.1:11434");
  const [model, setModel] = useState(cachedConfig.deepseekModel || "deepseek-chat");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const host = getBoundHost();
    if (!host) return;
    void loadMmwConfigFromHost(host.config).then((cfg) => {
      setCachedMmwConfig(cfg);
      setProvider(cfg.aiProvider);
      setPort(String(cfg.port));
      setOllama(cfg.ollamaBaseUrl || "http://127.0.0.1:11434");
      setModel(cfg.deepseekModel || "deepseek-chat");
    });
  }, []);

  const onSave = useCallback(async () => {
    const host = getBoundHost();
    if (!host) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const portNum = Number(port);
      const patch: Partial<MmwAppConfigDocument> = {
        aiProvider: provider,
        port: Number.isFinite(portNum) ? portNum : MMW_DEFAULT_PORT,
        ollamaBaseUrl: ollama.trim() || "http://127.0.0.1:11434",
        deepseekModel: model.trim() || "deepseek-chat",
        deepseekBaseUrl: "https://api.deepseek.com",
      };
      if (keyInput.trim()) {
        if (provider === "deepseek") {
          patch.deepseekApiKey = keyInput.trim();
        } else if (provider === "openrouter") {
          patch.openRouterApiKey = keyInput.trim();
        }
      }
      const saved = await saveMmwConfigToHost(host.config, patch);
      setCachedMmwConfig(saved);
      setKeyInput("");
      setMsg("已保存；正在重挂思维导图…");
      requestMmwRuntimeRestart("config-saved");
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [keyInput, model, ollama, port, provider]);

  const keyConfigured =
    provider === "deepseek"
      ? Boolean(cachedConfig.deepseekApiKey)
      : provider === "openrouter"
        ? Boolean(cachedConfig.openRouterApiKey)
        : true;

  return (
    <View style={styles.col}>
      <Text style={styles.label}>AI 提供方</Text>
      <View style={styles.row}>
        {(
          [
            ["deepseek", "DeepSeek"],
            ["openrouter", "OpenRouter"],
            ["ollama", "Ollama"],
          ] as const
        ).map(([id, label]) => (
          <Pressable
            key={id}
            onPress={() => setProvider(id)}
            style={[styles.chip, provider === id ? styles.chipOn : null]}
          >
            <Text style={provider === id ? styles.chipTextOn : styles.chipText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>监听端口</Text>
      <TextInput
        style={styles.input}
        value={port}
        onChangeText={setPort}
        keyboardType="number-pad"
        placeholder={String(MMW_DEFAULT_PORT)}
      />
      {provider === "deepseek" ? (
        <>
          <Text style={styles.label}>DeepSeek 模型</Text>
          <TextInput
            style={styles.input}
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="deepseek-chat"
          />
          <Text style={styles.label}>DeepSeek API Key（留空不改）</Text>
          <TextInput
            style={styles.input}
            value={keyInput}
            onChangeText={setKeyInput}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={keyConfigured ? "已配置 · 输入新值覆盖" : "sk-…"}
          />
          <Text style={styles.label}>
            也可在启动环境设 DEEPSEEK_API_KEY；ensure 反代会自动带上，避免浏览器 CORS。
          </Text>
        </>
      ) : null}
      {provider === "openrouter" ? (
        <>
          <Text style={styles.label}>OpenRouter API Key（留空不改）</Text>
          <TextInput
            style={styles.input}
            value={keyInput}
            onChangeText={setKeyInput}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={keyConfigured ? "已配置 · 输入新值覆盖" : "sk-or-…"}
          />
        </>
      ) : null}
      {provider === "ollama" ? (
        <>
          <Text style={styles.label}>Ollama URL</Text>
          <TextInput
            style={styles.input}
            value={ollama}
            onChangeText={setOllama}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://127.0.0.1:11434"
          />
        </>
      ) : null}
      <Pressable
        onPress={() => void onSave()}
        disabled={busy}
        style={[styles.chip, styles.chipOn]}
      >
        <Text style={styles.chipTextOn}>{busy ? "保存中…" : "保存并重挂"}</Text>
      </Pressable>
      {msg ? <Text style={styles.ok}>{msg}</Text> : null}
      {err ? <Text style={styles.warn}>{err}</Text> : null}
    </View>
  );
}

export function registerMmwDetailConfig(host: WorkspaceAppHostApi): () => void {
  if (!host.ui?.registerDetailSheetExtras) {
    return () => {};
  }
  void loadMmwConfigFromHost(host.config).then(setCachedMmwConfig);
  return host.ui.registerDetailSheetExtras({
    appId: MMW_APP_ID,
    surface: "config",
    buildRows: () => {
      const cfg = getCachedMmwConfig();
      return [
        {
          label: "AI / 端口",
          value: `${cfg.aiProvider} · :${cfg.port}`,
          helpText:
            "默认 DeepSeek。密钥进本机 host.config；ensure 反代 /agnx-api/chat 供 iframe 与 Agent 工具调用。也可设 DEEPSEEK_API_KEY。",
          groupId: "mmw-runtime",
          groupTitle: "思维导图",
          valueContent: createElement(ProviderField),
        },
      ];
    },
  });
}
