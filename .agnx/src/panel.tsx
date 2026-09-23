// 场景：Mind Map Wizard 薄壳面板 — host.guest.mount；首帧品牌扫光 + 配置保存后重挂。
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  WorkspaceAppBrandLogoLoaderPanelProps,
  WorkspaceAppHostApi,
} from "@getagnx/app-sdk";
import {
  MMW_APP_ID,
  MMW_DEFAULT_PORT,
  MMW_ENSURE_TOOL_REL,
  MMW_OPEN_COMMAND_ID,
  MMW_PANEL_ID,
} from "./constants";
import { bindMindMapWizardHost, requireBoundHost } from "./host-bind";
import { loadMmwConfigFromHost } from "./mmw-config";
import { subscribeMmwRuntimeRestart } from "./mmw-runtime-coordinator";

const WEB_ROOT_STYLE: CSSProperties = {
  flex: "1 1 0%",
  alignSelf: "stretch",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  backgroundColor: "transparent",
};

const GUEST_HOST_STYLE: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
  height: "100%",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const BOOT_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  background: "rgb(9, 9, 11)",
};

const ERROR_LAYER_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  display: "flex",
  flexDirection: "column",
  background: "rgba(9,9,11,0.88)",
};

const ERROR_FALLBACK_STYLE: CSSProperties = {
  ...ERROR_LAYER_STYLE,
  alignItems: "center",
  justifyContent: "center",
  color: "#a1a1aa",
  padding: 24,
  textAlign: "center",
};

const styles = StyleSheet.create((theme) => ({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
    backgroundColor: "transparent",
  },
  fallbackText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

export function bindMindMapWizardHarnessHost(host: WorkspaceAppHostApi): void {
  bindMindMapWizardHost(host);
}

function getHost(): WorkspaceAppHostApi {
  return requireBoundHost();
}

function canUseGuestSurface(): boolean {
  return typeof document !== "undefined" && getHost().platform.isWeb;
}

export function MindMapWizardPanel(_props: {
  appId: string;
  panelId: string;
  entityId: string;
}): ReactElement {
  const guestHostRef = useRef<HTMLDivElement | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canUseGuestSurface()) {
      setBooting(false);
      setError("思维导图仅支持桌面 / 网页壳");
      return;
    }

    let cancelled = false;
    let unmountGuest: (() => void) | null = null;

    const mountGuest = async (options?: { forceRestart?: boolean; reason?: string }) => {
      const host = getHost();
      const container = guestHostRef.current;
      if (!container) {
        return;
      }
      if (!host.guest?.mount) {
        if (!cancelled) {
          setBooting(false);
          setError("宿主未提供 host.guest.mount（需升级 Agnx）");
        }
        return;
      }

      unmountGuest?.();
      unmountGuest = null;
      setBooting(true);
      setError(null);

      try {
        const cfg = await loadMmwConfigFromHost(host.config);
        const port = cfg.port || MMW_DEFAULT_PORT;
        const args = ["--port", String(port)];
        if (options?.forceRestart) {
          args.push("--force-restart");
        }
        if (cancelled || !guestHostRef.current) {
          return;
        }
        // 首帧自画 BrandLogoLoaderPanel → bootOverlay:false，避免双层扫光
        unmountGuest = host.guest.mount({
          container: guestHostRef.current,
          ensureTool: MMW_ENSURE_TOOL_REL,
          ensureArgs: args,
          timeoutMs: 120_000,
          bootOverlay: false,
          bootTitle: "正在启动思维导图…",
          onReady: () => {
            if (!cancelled) {
              setError(null);
              window.setTimeout(() => {
                if (!cancelled) {
                  setBooting(false);
                }
              }, 320);
            }
          },
          onError: (detail) => {
            if (!cancelled) {
              setBooting(false);
              setError(`${detail.code}: ${detail.message}`);
            }
          },
        });
      } catch (err) {
        if (!cancelled) {
          setBooting(false);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void mountGuest();

    const unsubscribeRestart = subscribeMmwRuntimeRestart((reason) => {
      void mountGuest({ forceRestart: true, reason });
    });

    return () => {
      cancelled = true;
      unsubscribeRestart();
      unmountGuest?.();
    };
  }, []);

  if (!canUseGuestSurface()) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>{error ?? "思维导图仅支持桌面 / 网页壳"}</Text>
      </View>
    );
  }

  const BrandPanel = getHost().ui
    ?.BrandLogoLoaderPanel as ComponentType<WorkspaceAppBrandLogoLoaderPanelProps> | undefined;

  return (
    <div
      style={WEB_ROOT_STYLE}
      data-testid="workspace-mini-app-mind-map-wizard-root"
      aria-label="思维导图 panel"
    >
      <div
        ref={guestHostRef}
        data-agnx-guest-surface-host="true"
        style={GUEST_HOST_STYLE}
      />
      {booting && !error && BrandPanel ? (
        <div data-agnx-guest-boot-overlay="true" style={BOOT_LAYER_STYLE} role="status">
          <BrandPanel title="正在启动思维导图…" testID="mmw-boot-overlay" />
        </div>
      ) : null}
      {booting && !error && !BrandPanel ? (
        <div data-agnx-guest-boot-overlay="true" style={ERROR_FALLBACK_STYLE} role="status">
          正在启动思维导图…
        </div>
      ) : null}
      {error && BrandPanel ? (
        <div style={ERROR_LAYER_STYLE} role="alert">
          <BrandPanel title={error} testID="mmw-mount-error" />
        </div>
      ) : null}
      {error && !BrandPanel ? (
        <div style={ERROR_FALLBACK_STYLE} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function activate(host: WorkspaceAppHostApi): () => void {
  bindMindMapWizardHost(host);
  const disposers: Array<() => void> = [];

  disposers.push(
    host.registerMiniApp({
      id: MMW_PANEL_ID,
      appId: MMW_APP_ID,
      title: "思维导图",
      component: MindMapWizardPanel,
      iframeShortcutCapture: true,
      isolation: {
        mode: "iframe",
        sidecarTools: [MMW_ENSURE_TOOL_REL],
        note: "Tab iframe 加载本仓静态 Mind Map Wizard；ensure 起 mmw-static-server（含 DeepSeek 反代）",
      },
    }),
  );

  disposers.push(
    host.registerCommand({
      id: MMW_OPEN_COMMAND_ID,
      appId: MMW_APP_ID,
      title: "思维导图",
      keywords: ["mind-map", "mmw", "思维导图", "导图", "mindmap"],
      sidebarAction: {
        defaultVisible: true,
        label: "导图",
        order: 64,
      },
      run: (context) => {
        host.openSubAppTab({
          appId: MMW_APP_ID,
          panelId: MMW_PANEL_ID,
          serverId: context?.serverId,
          workspaceId: context?.workspaceId,
          currentPathname: context?.currentPathname,
        });
      },
    }),
  );

  return () => {
    for (const d of disposers.toReversed()) {
      d();
    }
  };
}
