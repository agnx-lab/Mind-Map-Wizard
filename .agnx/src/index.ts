// 场景：Mind Map Wizard Sub App 入口 — activate + 详情 + Agent 工具。
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@agnx-lab/app-sdk";
import { activate as activatePanel, bindMindMapWizardHarnessHost } from "./panel";
import { registerMmwDetailConfig } from "./detail-config";
import { registerMmwAgentTools } from "./agent-tools";
import { MMW_APP_ID } from "./constants";

export const appId = MMW_APP_ID;

export function activate(host: WorkspaceAppHostApi): () => void {
  bindMindMapWizardHarnessHost(host);
  const disposeDetail = registerMmwDetailConfig(host);
  const disposeTools = registerMmwAgentTools(host);
  const disposePanel = activatePanel(host);
  return () => {
    disposeTools();
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
