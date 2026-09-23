// 场景：Mind Map Wizard host 绑定 — 详情 / panel 共用。
import type { WorkspaceAppHostApi } from "@getagnx/app-sdk";

let boundHost: WorkspaceAppHostApi | null = null;

export function bindMindMapWizardHost(host: WorkspaceAppHostApi): void {
  boundHost = host;
}

export function getBoundHost(): WorkspaceAppHostApi | null {
  return boundHost;
}

export function requireBoundHost(): WorkspaceAppHostApi {
  if (!boundHost) {
    throw new Error("Mind Map Wizard host 未绑定");
  }
  return boundHost;
}
