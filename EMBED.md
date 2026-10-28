# 思维导图 × Agnx 子应用接入记录

> appId `Mind-Map-Wizard` ｜ 版本 0.1.0 ｜ 上游 `linus-sch/Mind-Map-Wizard` ｜ 端口 **3095**
> <!-- 由 scripts/sub-apps/backfill-embed-md.mjs 生成的骨架 -->

> **这份文件不是走形式。** skill §9.5 把它定为必留记录：没有它就不许宣称「已接入」。
> 下面机器能确认的已填实值；标 `TODO` 的是只有人知道的（改了哪些上游文件、验收截图、真实缺口），必须替换。

## 上游嵌入

- **上游原生平台**：桌面 未声明 ｜ 网页 未声明 ｜ 移动 未声明
  - 依据：`manifest.platforms` 声明
  - 声明值：（manifest.platforms **缺失**，需按 §9.1 补声明）；上游探测：desktop=unsupported / web=unsupported / mobile=unsupported（形态 `library`）
  - 记住 §9.1：**上游没做的平台不替它做**，覆盖上限 = 上游原生能力上限。

- **工作方式**：TODO（原样嵌入（首选）｜ 嵌 + 薄胶水 ｜ 引擎 + 自画 UI ｜ Wrap + Sidecar）
  - 为什么选这个：TODO

- **上游改动清单**：TODO。理想是「无」。
  - 若只改了启动参数 / 端口 / 基路径，也算改动，逐条列出文件与原因（§9.3「不做太重」是硬约束）。

- **挂载**：`guest.kind=web` / `guest.auth=none` ｜ 策略 = `direct-iframe`
  - 为什么是这套策略：上游是本地 Web 服务，无凭证依赖 → 直接 iframe｜ ⚠️ 探测建议为 `不可嵌（无 UI）`，与实际采用的 `web` 不同，原因须在本行补清

- **上游**：`linus-sch/Mind-Map-Wizard@<commit 或版本 tag>`
  - 记基线要在克隆后立刻做：`git -C <appDir> rev-parse HEAD` 写进本行，别等 push 完（§9.8）。

- **面板与 Tab**：
  | panelId | 名字 | 走什么 |
  | --- | --- | --- |
  | `mind-map-wizard.main` | 思维导图 | `ensureTool` → `.agnx/tools/ensure-mind-map-wizard.mjs`，`--port 3095` |

- **ensure 脚本**：
  - `.agnx/tools/ensure-mind-map-wizard.mjs`（端口 3095）
  - 若脚本仍是「一坨自己写的 parseArgs/健康探活」，可换成 `ensure-kit.mjs` 底座：参数解析 / 健康探活 / 状态文件 / 指纹 / 日志 fd / 退出码都已收口。

- **当前交付状态**：installState=`installed` / launchMode=`packaged`
  - §八 要求交付时是 packaged + installed；上面若是 debug，说明还没翻态。

- **桌面验收截图**：`logs/Mind-Map-Wizard-desktop-*.png`（必须能看到上游主界面 + 一次真实操作后的状态）

## 嵌页宿主能力缺口

> §9.5 要求：**禁止省略本表却宣称「已接入」**。没有缺口就写一行「（无）」，别留空。

| 上游能力 | 信号位置 | 嵌后风险 | 处置 (A–E) | 主路径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| （平台声明缺失） | `manifest.platforms` 不存在 | 宿主按兜底路径处理，可能与上游真实能力不符 | B 适配（补声明） | — | 需按 §9.1 补 `platforms` 三键 |

---

## 待办清单（补完后删除本节）

- [ ] 补「工作方式」与原因
- [ ] 补「上游改动清单」（理想是「无」）
- [ ] 补上游基线的真实 commit（不是本仓 HEAD）
- [ ] 把缺口表的 TODO 逐项填掉，或写「（无）」
- [ ] **补 `manifest.platforms` 三键**（当前缺失）
- [ ] 桌面验收截图放进 `logs/`
