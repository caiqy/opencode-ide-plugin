# 运行时核验清单

本清单汇总 `reference/business/` 中所有「运行时待核验」项。维护者或 QA 用真实 VSCode、JetBrains、浏览器、Marketplace、Provider、MCP 等环境逐项验证；结果列留空，核验后填写 `Pass`、`Fail` 或 `Skip: 原因`。

## 前端会话与消息体验

| 来源文档 | 核验项 | 如何核验 | 环境要求 | 结果 |
|---|---|---|---|---|
| [tool-rendering](../reference/business/tool-rendering.md) | `write/edit/apply_patch` 在真实 SSE token delta 下自动展开、行数递增、滚动稳态符合预期 | 让模型执行写入、编辑和 patch，观察 pending 工具卡是否自动展开、行数递增，滚动不跳动 | 真实模型流式输出、WebGUI |  |
| [diff-file-changes](../reference/business/diff-file-changes.md) | 大文件或大量文件 diff 的滚动与性能表现 | 制造大 diff 或多文件 patch，打开 Diff 弹窗和文件变更面板，记录卡顿、滚动和渲染问题 | 真实大 diff |  |
| [diff-file-changes](../reference/business/diff-file-changes.md) | `session.diff.status` 从 updating 到 latest/failed 时输入区提示按预期刷新 | 触发后台 diff 更新，观察输入区 FileChangesPanel 状态提示是否从 updating 正确转为 latest 或 failed | 真实后台 diff 调度 |  |
| [subtask-drawer](../reference/business/subtask-drawer.md) | 子任务 permission/question 阻塞解除后，父卡标记和抽屉回复入口同步消失 | 触发真实子任务阻塞，在抽屉内处理 permission/question，观察父 task 卡和抽屉状态 | 真实子会话阻塞 |  |
| [subtask-drawer](../reference/business/subtask-drawer.md) | `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true` 下 `task_status` 轮询与抽屉展示一致 | 启用实验开关运行子 agent，比较父卡进度、抽屉消息和后台状态 | 实验开关、真实子任务 |  |
| [session-chat](../reference/business/session-chat.md) | JCEF `jcefScrollMultiplier` 在 JetBrains 鼠标/触控板滚动下距离自然 | 在 JetBrains JCEF 中滚动长会话，分别用鼠标滚轮和触控板评估速度 | JetBrains JCEF 实机 |  |
| [session-chat](../reference/business/session-chat.md) | 多 tab 快速切换加 SSE 高频增量时，foreground 保护和滚动跟随无可见跳动 | 打开多个会话 tab，在长流式输出期间快速切换，观察首屏、滚动和消息增量 | 长会话实时流场景 |  |
| [message-input](../reference/business/message-input.md) | `@目录`、PDF、图片、文本、其他二进制 mention 到后端后的分流顺序符合契约 | 逐类插入 mention 或附件并发送，检查后端实际读取路径、附件类型和消息 part | 真实 WebGUI + 后端 |  |
| [message-input](../reference/business/message-input.md) | 右键双击快捷短语不被 VSCode webview 或 JetBrains JCEF 宿主 context menu 抢占 | 在两端宿主中右键双击快捷短语，确认回填输入框且不弹宿主菜单 | VSCode webview、JetBrains JCEF |  |
| [model-selection](../reference/business/model-selection.md) | Provider 删除或重命名后，旧会话切换 fallback toast 只出现一次 | 删除/重命名 Provider 后多次切换旧会话，观察 fallback 与 toast 次数 | 真实配置变更、多会话 |  |
| [model-selection](../reference/business/model-selection.md) | 多个 ModelSelector 同时打开时，favorite/recent 刷新顺序符合预期 | 同时打开模型选择入口，收藏和选择模型，观察各实例 recent/favorite 更新 | WebGUI 并发交互 |  |
| [foreground-read-priority](../reference/business/foreground-read-priority.md) | 大会话快速切换时，首屏消息读取稳定优先于后台 diff | 准备长会话和后台 diff，快速切换会话，记录首屏消息延迟和 diff 抢占 | 真实 WebGUI + 后端长会话 |  |
| [foreground-read-priority](../reference/business/foreground-read-priority.md) | 隐藏/显示 tab 后 `syncVisible` 与 foreground session 集合无抖动 | 切换浏览器/IDE tab 可见性并观察后台刷新、当前会话状态和日志 | WebGUI 可见性切换 |  |
| [localization](../reference/business/localization.md) | 全站无残留用户可见英文普通文案 | 遍历主要 UI 截图或跑自动化文案扫描，排除专有名词、代码、模型和 tool id | 完整 UI 遍历 |  |

## 宿主、Backend 与 Bridge

| 来源文档 | 核验项 | 如何核验 | 环境要求 | 结果 |
|---|---|---|---|---|
| [host-webview-integration](../reference/business/host-webview-integration.md) | VSCode iframe 的 macOS Cmd/Ctrl 快捷键转发覆盖编辑态 | 在 macOS VSCode webview 输入框、弹窗和编辑态中试复制、粘贴、全选、撤销等快捷键 | macOS VSCode Electron |  |
| [host-webview-integration](../reference/business/host-webview-integration.md) | JetBrains `jcefScrollMultiplier=4` 在不同 DPI/触控板下不过快或过慢 | 在不同显示缩放和输入设备下滚动长消息列表，记录速度 | JetBrains JCEF、多 DPI/触控板 |  |
| [host-webview-integration](../reference/business/host-webview-integration.md) | Backend logs reveal 后用户手动恢复/关闭路径足够 | 制造 backend 错误触发 logs reveal，尝试关闭、恢复或继续使用工具窗口 | JetBrains 插件实机 |  |
| [backend-launch](../reference/business/backend-launch.md) | JetBrains Terminal 输出捕获在 2026.1 以外 IDE 版本仍能读到 `server listening` | 在多个 JetBrains 版本启动插件，检查 backend ready 是否可通过终端输出识别 | JetBrains 2026.1 以外版本 |  |
| [backend-launch](../reference/business/backend-launch.md) | VSCode/JetBrains custom command 复杂 quoting 的实际兼容差异 | 分别配置带空格、引号、参数的 custom command，记录启动结果 | 真实宿主设置输入 |  |
| [ide-bridge](../reference/business/ide-bridge.md) | Remote-SSH / JetBrains Gateway 远端场景下 SSE ping 足以维持长连接 | 在远端 IDE 场景长时间保持 WebGUI 打开，观察 bridge 断线和重连 | Remote-SSH 或 JetBrains Gateway |  |
| [ide-bridge](../reference/business/ide-bridge.md) | 宿主未显式发送 `customApi` 时状态面板展示符合预期 | 打开状态面板 Server tab，检查 customApi/bridge 状态文案 | VSCode 或 JetBrains WebGUI |  |
| [host-actions](../reference/business/host-actions.md) | VSCode `reloadPath` 对脏编辑器执行 revert 时的用户提示/数据保护表现 | 打开有未保存修改的文件，触发 reloadPath，观察 VSCode 提示和文件内容 | VSCode 脏 editor 状态 |  |
| [host-actions](../reference/business/host-actions.md) | JetBrains `saveImage` Swing `JFileChooser` 默认目录在不同主题/平台下符合预期 | 从图片预览保存图片，检查保存对话框默认目录和主题显示 | JetBrains 多主题/平台 |  |
| [host-restart](../reference/business/host-restart.md) | JetBrains `restartHost` 能在 IDE restart 前稳定把 OK 回复给 WebGUI | 触发重启并抓 WebGUI/bridge 日志，确认 UI 先收到成功响应 | JetBrains 插件实机 |  |
| [host-restart](../reference/business/host-restart.md) | `RestartRequiredModal` 在 JetBrains 模式文案是否需要区分 `restartMode="ide"` | 保存会触发重启提示的 Provider 设置，在 JetBrains 中检查弹窗文案 | JetBrains WebGUI 设置流程 |  |
| [context-insertion](../reference/business/context-insertion.md) | VSCode Explorer 拖拽在 VSCode 1.108+ 暴露 `application/vnd.code.uri-list` 情况 | 从 Explorer 拖文件和目录进 WebGUI，检查路径提取和去重 | VSCode 1.108+ webview |  |
| [context-insertion](../reference/business/context-insertion.md) | JetBrains 6 条快捷键在当前 IDE keymap 下是否被占用 | 安装插件后逐个试 Editor add/add lines 快捷键，记录冲突 | JetBrains 当前 keymap |  |
| [embedded-webgui-serving](../reference/business/embedded-webgui-serving.md) | VSCode webview 与 JetBrains JCEF 中 `/app/generated-image` query/context 透传可预览当前项目图片 | 生成图片后在两端预览 Markdown 和 tool attachment 图片 | 宿主 webview/JCEF 实机 |  |
| [embedded-webgui-serving](../reference/business/embedded-webgui-serving.md) | 普通浏览器打开 `/app` 时依赖 IDE bridge 的入口隐藏或降级，无阻塞报错 | 浏览器模式走设置、打开文件、保存图片等入口，检查报错和降级 | 普通浏览器 + backend `/app` |  |
| [generated-image](../reference/business/generated-image.md) | IDE bridge `saveImage` 在 VSCode 与 JetBrains 下的保存对话框、取消返回值和错误提示 | 预览生成图片后执行保存、取消、失败路径，检查 UI 反馈 | VSCode 与 JetBrains 宿主插件 |  |
| [generated-image](../reference/business/generated-image.md) | dev proxy 下 `/generated-image` 与 `/app/generated-image` 同时可预览 | Vite dev 连接 backend，分别访问两条图片路由并在 WebGUI 预览 | Vite dev + backend |  |

## 状态、配置与存储

| 来源文档 | 核验项 | 如何核验 | 环境要求 | 结果 |
|---|---|---|---|---|
| [status-panel](../reference/business/status-panel.md) | MCP server/tool 开关在断连、重连、needs_auth 下 UI 状态与后端一致 | 配置真实 MCP server，制造断连、重连和鉴权状态，切换开关后比对后端状态 | 真实 MCP 配置 |  |
| [status-panel](../reference/business/status-panel.md) | Skill toggle 后下一次 agent prompt/tool permission 立即按 overlay 生效且未 dispose Instance | 在状态面板切换 Skill，下一次发送消息并检查 prompt/tool permission 行为和 Instance 连续性 | 真实会话 |  |
| [status-panel](../reference/business/status-panel.md) | LSP 与 Plugins 在多项目/无插件配置下 empty/stale/failed 展示符合预期 | 分别打开有插件、无插件、多项目和失败状态，观察状态面板 | 多运行态样本 |  |
| [tool-safety-boundary](../reference/business/tool-safety-boundary.md) | symlink/junction 指向 project 外时，`containsPath` 与实际文件操作最终路径一致 | 构造 symlink/junction 指向外部目录，用 read/write/edit 等工具触发 permission | 真实文件系统链接 |  |
| [tool-safety-boundary](../reference/business/tool-safety-boundary.md) | WebGUI permission UI 对 `external_directory` allow/always pattern 符合预期 | 触发外部目录权限请求，分别选择 allow/always，检查展示和持久化 pattern | WebGUI permission UI |  |
| [project-identity](../reference/business/project-identity.md) | 在 VSCode/JetBrains 打开两个不同 non-git 目录，tabs/drafts/selection 不共享 | 分别打开两个非 Git 目录，创建 tabs、drafts、selection 后来回切换 | VSCode 与 JetBrains non-git workspace |  |
| [scoped-storage](../reference/business/scoped-storage.md) | VSCode `global/workspace/mem` 分别落到 `globalState/workspaceState/Map` 的实际宿主行为 | 写入主题、tabs/drafts、mem 状态后重载窗口和切换 workspace 检查保留范围 | VSCode 插件实机 |  |
| [scoped-storage](../reference/business/scoped-storage.md) | JetBrains `global/workspace/mem` 分别落到 `PropertiesComponent`/session mem 的实际宿主行为 | 写入同类状态后重启 IDE、切换 project，检查保留范围 | JetBrains 插件实机 |  |
| [agent-config](../reference/business/agent-config.md) | 保存 Agent 模型/variant 后当前会话不中断且下一次 agent 行为使用新配置 | 在设置页修改 Agent 默认模型/variant，继续同会话发送消息并检查实际使用配置 | 真实 WebGUI + 一次消息执行 |  |
| [agent-config](../reference/business/agent-config.md) | 热重载失败时用户侧反馈路径 | 制造 Agent config 热重载失败，观察 UI toast、错误区域或日志可见性 | 可控失败环境 |  |
| [settings-panel](../reference/business/settings-panel.md) | 浏览器模式下 general/advanced tab 和配置文件按钮隐藏行为 | 普通浏览器打开 `/app`，检查设置入口、隐藏 tab 和配置文件按钮是否不可达 | 浏览器模式 |  |
| [provider-settings](../reference/business/provider-settings.md) | 覆盖更新保留本地 API key 在真实远程配置合并下的表现 | 准备本地 key 和远程配置，执行覆盖更新后检查 key 是否保留 | 真实远程 config 覆盖 |  |
| [provider-settings](../reference/business/provider-settings.md) | 浏览器模式下 Provider 设置页是否隐藏 | 普通浏览器打开设置面板，确认 Provider tab 可见性和可操作性是否符合产品预期 | 浏览器模式 |  |

## 发布、更新与上游同步

| 来源文档 | 核验项 | 如何核验 | 环境要求 | 结果 |
|---|---|---|---|---|
| [stream-error-recovery](../reference/business/stream-error-recovery.md) | 真实 Provider 返回 `stream_timeout` 时，WebGUI 持续显示 retry 倒计时并最终恢复生成 | 使用会返回 stream_timeout 的 Provider 或代理，观察 TypingIndicator 与最终消息 | 真实 Provider 错误 |  |
| [stream-error-recovery](../reference/business/stream-error-recovery.md) | 第三方 OpenAI proxy 注入 Chat Completions frame 时，Responses 流不再重复/空消息 | 通过第三方 OpenAI proxy 使用 Responses API，检查消息是否重复或空白 | 第三方 OpenAI proxy |  |
| [packaging-release](../reference/business/packaging-release.md) | VSCode Marketplace 上 5 个 platform VSIX 被平台选择逻辑正确识别 | 从 Marketplace 在 5 个目标平台安装或更新，确认选中对应 VSIX | Marketplace 安装/更新链路 |  |
| [packaging-release](../reference/business/packaging-release.md) | JetBrains Marketplace 组合包在 Windows x64、macOS ARM64、Linux x64 解出对应 backend binary | 三个平台安装 Marketplace 包，检查插件内 backend binary 架构和启动 | JetBrains 三平台 |  |
| [version-update](../reference/business/version-update.md) | VSCode `.vsix` 下载后按当前 VSCode 版本策略提示 reload | 触发插件内更新安装，观察 VSCode 原生 reload 提示 | 真实 VSCode extension host |  |
| [version-update](../reference/business/version-update.md) | JetBrains Marketplace 安装版打开 Plugins 页面后，原生更新提示与 `manualUpdate` 状态一致 | 触发 JetBrains 手动更新入口，检查 Plugins 页面与 WebGUI 横幅状态 | JetBrains Marketplace 安装版 |  |
| [upstream-compatibility](../reference/business/upstream-compatibility.md) | 上游同步后最小验证清单在真实 VSCode 与 JetBrains 宿主各跑一遍 | 按来源文档「同步后最低验证清单」逐项执行并记录结果 | 真实 VSCode 与 JetBrains 宿主 |  |
| [upstream-compatibility](../reference/business/upstream-compatibility.md) | `file://` mention 的目录/PDF/图片/文本/其他二进制顺序用真实附件输入确认 | 构造五类 `file://` 输入，发送后检查后端 prompt 分流顺序 | 真实附件输入 |  |

## 完成规则

1. 每一项结果必须填写 `Pass`、`Fail` 或 `Skip: 原因`。
2. `Fail` 必须附带复现环境、关键日志或截图位置，并创建或关联修复任务。
3. `Skip` 只能用于当前缺少环境、账号、Marketplace 状态或上游条件，并写明下次可执行条件。
4. 每项关闭后，把结论回填到来源 business 文档的「运行时待核验」段：通过的改为已验证说明，失败的保留待核验并链接修复任务，跳过的补充原因和下一次触发条件。
