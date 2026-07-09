# 本地逻辑覆盖矩阵（2026-05-18）

范围来自：

- `docs/superpowers/specs/2026-05-18-repowiki-and-local-logic-coverage-design.md`
- 2026-05-04 到 2026-05-18 的 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`
- 近半个月提交中涉及 WebGUI、IDE host、图片生成、non-git 隔离、更新链路和 UI 稳定性的本地 fork 改动

判定口径：

- `已直接覆盖`：测试直接断言该本地契约，不依赖旁路行为。
- `新增覆盖`：本次补入直接断言。
- `文档锁定`：行为已有直接测试，repowiki 本次补充维护入口和同步风险。
- `无需补测`：已有直接测试足够，本次不重复造测试。

## A. 图片链路

| ID  | 本地逻辑点                                                                                                       | repowiki 章节                                             | 测试证据                                                                                                                                                                                                                         | 覆盖结论             |
| --- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| A1  | `generate_image` 结果持久化到 `.opencode/generated-images`，返回 file attachment，且不带旧 `source` metadata。   | `05-subtasks-tools-mcp.md`、`08-upstream-adaptations.md`  | `packages/opencode/test/tool/generate-image.test.ts`：`writes images into .opencode/generated-images and returns file attachments without source metadata`；`packages/opencode/test/session/generated-image-persistence.test.ts` | 已直接覆盖，无需补测 |
| A2  | generated image 路由只允许项目内 `.opencode/generated-images`，阻止路径逃逸与 symlink/junction 逃逸。            | `01-webgui-architecture.md`、`08-upstream-adaptations.md` | `packages/opencode/test/server/generated-image-route.test.ts`；`packages/opencode/test/tool/generate-image.test.ts` symlink/junction escape 用例                                                                                 | 已直接覆盖，无需补测 |
| A3  | `generate_image` edit action 接受 readonly/frozen image input array，不改写调用方入参。                          | `05-subtasks-tools-mcp.md`、`08-upstream-adaptations.md`  | 本次新增：`packages/opencode/test/tool/generate-image.test.ts` 的 readonly edit image inputs 回归                                                                                                                                | 新增覆盖             |
| A4  | WebGUI tool attachment 图片网格稳定展示多图顺序、编号、文件名和 relativePath 专用路由。                          | `05-subtasks-tools-mcp.md`                                | `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`；`ToolImageAttachments.test.tsx`                                                                                                                         | 已直接覆盖，无需补测 |
| A5  | Markdown 中 `.opencode/generated-images` 图片使用专用图片路由，并携带当前 directory/worktree 上下文。            | `01-webgui-architecture.md`、`04-session-chat.md`         | `packages/opencode/webgui/src/components/MarkdownRenderer.test.tsx`                                                                                                                                                              | 已直接覆盖，无需补测 |
| A6  | `ImageOverlay` 保存、缩放、拖拽、Esc、阴影点击关闭、图片/工具栏点击不关闭。                                      | `05-subtasks-tools-mcp.md`                                | `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`                                                                                                                                                            | 已直接覆盖，无需补测 |
| A7  | Host `saveImage` bridge 能处理 data URL、remote URL、generated-image relative URL、取消、无 handler 和非法输入。 | `02-ide-bridge.md`、`07-host-plugins.md`                  | `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`；`webviewController.test.ts`；`hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`                                                | 已直接覆盖，无需补测 |

## B. 宿主版本与更新链路

| ID  | 本地逻辑点                                                                                                               | repowiki 章节                                              | 测试证据                                                                                                                                                                                | 覆盖结论             |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| B1  | VSCode backend 环境注入 `OPENCODE_UI_VERSION`，空版本不注入且清理继承的 stale 值。                                       | `07-host-plugins.md`、`08-upstream-adaptations.md`         | `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`                                                                                                                            | 已直接覆盖，无需补测 |
| B2  | opencode UI user agent 使用注入的 UI version，installation-scoped user agent 保留 accept header。                        | `07-host-plugins.md`、`08-upstream-adaptations.md`         | `packages/opencode/test/installation/installation.test.ts`                                                                                                                              | 已直接覆盖，无需补测 |
| B3  | VSCode / JetBrains `getExtensionVersion` 返回宿主真实版本，JetBrains 与 `getUpdateInfo` 共用同一 version source。        | `02-ide-bridge.md`、`07-host-plugins.md`                   | `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`；`hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`                                    | 已直接覆盖，无需补测 |
| B4  | JetBrains 使用 public Marketplace 查询；空 marketplace result 视为 manual check / unavailable，不保留旧 cached update。  | `06-settings-update-localization.md`、`07-host-plugins.md` | `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`                                                                                          | 已直接覆盖，无需补测 |
| B5  | JetBrains plugin id / vendor / marketplace metadata 不回退到旧身份。                                                     | `07-host-plugins.md`                                       | `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/PluginIdentityTest.kt`                                                                                                      | 已直接覆盖，无需补测 |
| B6  | VSCode plugin identity helper 与 manifest publisher/name 保持一致，集成测试不再依赖旧 extension id。                     | `07-host-plugins.md`、`08-upstream-adaptations.md`         | 本次新增/修复：`hosts/vscode-plugin/src/test/suite/extension.test.ts`；`webviewIntegration.test.ts`；`integration.test.ts`；`endToEndIntegration.test.ts`；`backendIntegration.test.ts` | 新增覆盖             |
| B7  | VSCode scheduled update check 的 fire-and-forget rejection 由本地错误回调上报，不依赖全局 `unhandledRejection` handler。 | `07-host-plugins.md`、`08-upstream-adaptations.md`         | 本次新增：`hosts/vscode-plugin/src/test/suite/updateService.test.ts` 的 scheduled check failure 上报回归                                                                                | 新增覆盖             |
| B8  | VSCode test runner 从编译输出目录正确解析插件根目录，避免 extensionDevelopmentPath 指向 `out`。                          | `07-host-plugins.md`                                       | `hosts/vscode-plugin/src/test/runTest.ts`；最终 `node ./out/test/test/runTest.js` 验证                                                                                                  | 新增覆盖             |

## C. 同步隔离链路

| ID  | 本地逻辑点                                                                                      | repowiki 章节                                       | 测试证据                                                                                                             | 覆盖结论             |
| --- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------- |
| C1  | non-git 普通目录生成稳定且非 global 的 project id。                                             | `03-state-storage.md`、`08-upstream-adaptations.md` | `packages/opencode/test/project/project.test.ts`：`returns a stable non-git project id for plain directories`        | 已直接覆盖，无需补测 |
| C2  | 不同 non-git 目录生成不同 project id，不互相串状态。                                            | `03-state-storage.md`、`08-upstream-adaptations.md` | `packages/opencode/test/project/project.test.ts`：`assigns different non-git project ids to different directories`   | 已直接覆盖，无需补测 |
| C3  | legacy global session 会在运行时迁移到目录派生的 non-git project id。                           | `03-state-storage.md`、`08-upstream-adaptations.md` | `packages/opencode/test/project/project.test.ts`：`migrates legacy global sessions for plain directories at runtime` | 已直接覆盖，无需补测 |
| C4  | Vite dev-only directory override 只在 serve proxy 注入 `x-opencode-directory`，未设置时不注入。 | `01-webgui-architecture.md`、`07-host-plugins.md`   | `packages/opencode/webgui/vite.config.test.ts`                                                                       | 已直接覆盖，无需补测 |

## D. WebGUI 稳定性链路

| ID  | 本地逻辑点                                                                               | repowiki 章节              | 测试证据                                                                                                        | 覆盖结论             |
| --- | ---------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------- |
| D1  | 贴底时 tail resize / 内容展开 / 容器高度变化会保持自动跟随，用户离开底部后停止自动滚动。 | `04-session-chat.md`       | `packages/opencode/webgui/src/components/MessageList/hooks/useMessageScroll.test.tsx`                           | 已直接覆盖，无需补测 |
| D2  | history anchor / prepend / trim 不破坏历史位置。                                         | `04-session-chat.md`       | `packages/opencode/webgui/src/components/MessageList/hooks/useHistoryScroll.test.tsx`；`useTopTrim.test.tsx`    | 已直接覆盖，无需补测 |
| D3  | aborted latest/older message load 不误标加载完成或错误，并允许后续 retry。               | `04-session-chat.md`       | `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`                                        | 已直接覆盖，无需补测 |
| D4  | assistant completed time 与 interrupted 可以同时展示，非法 completedAt 不展示。          | `04-session-chat.md`       | `packages/opencode/webgui/src/components/MessageList/AssistantMeta.test.tsx`；`MessageRow.test.tsx`             | 已直接覆盖，无需补测 |
| D5  | bash 运行中 title 使用 input description，image_generation title 不重复污染结果区。      | `05-subtasks-tools-mcp.md` | `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`；`utils.test.ts`                        | 已直接覆盖，无需补测 |
| D6  | StatusPopover 展示真实 backend 地址，未注入时回退当前 origin。                           | `05-subtasks-tools-mcp.md` | `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.test.tsx`；`StatusPopover.test.tsx` | 已直接覆盖，无需补测 |

## 当前补测最小集合

本矩阵下，本次新增的直接回归断言是：

1. `packages/opencode/test/tool/generate-image.test.ts`：`accepts readonly edit image inputs without mutating the caller array`
2. `hosts/vscode-plugin/src/test/suite/extension.test.ts`：VSCode identity helper 与 manifest 一致
3. `hosts/vscode-plugin/src/test/suite/updateService.test.ts`：scheduled update check failure 由本地错误回调上报

其余主题已有直接测试，后续工作重点是把这些证据同步到 repowiki，避免上游同步时只靠提交记忆判断本地行为。
