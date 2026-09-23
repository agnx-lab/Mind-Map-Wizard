// 场景：Mind Map Wizard Sub App 入口 — 导出 activate + 详情配置。
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@getagnx/app-sdk";
import { activate as activatePanel, bindMindMapWizardHarnessHost } from "./panel";
import { registerMmwDetailConfig } from "./detail-config";
import { MMW_APP_ID } from "./constants";

export const appId = MMW_APP_ID;

export function activate(host: WorkspaceAppHostApi): () => void {
  bindMindMapWizardHarnessHost(host);
  const disposeDetail = registerMmwDetailConfig(host);
  const disposePanel = activatePanel(host);
  return () => {
    disposeDetail();
    disposePanel();
  };
}

const moduleExport: WorkspaceAppModule = {
  appId: MMW_APP_ID,
  activate,
};

export default moduleExport;

export {
  MMW_APP_ID,
  MMW_OPEN_COMMAND_ID,
  MMW_PANEL_ID,
} from "./constants";
