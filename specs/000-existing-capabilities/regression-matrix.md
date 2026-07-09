# Regression Matrix

**Status**: 基线清单
**Created**: 2026-05-18
**Purpose**: 为 upstream merge 和跨客户端改动提供 no-regression 检查清单。

## Matrix

| Area                      | Regression Risk                                                                        | Affected Clients                         | Minimum Evidence                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/app` WebGUI serving     | 静态 SPA 无法加载、assets 404、SPA fallback 失效，或 workspace routes 拦截 `/app`      | opencode core, WebGUI, VSCode, JetBrains | WebGUI build 通过；backend 可服务 `/app`；手动 browser/webview load 或 route test 确认 index/assets 正常。                                                    |
| SSE event stream          | 消息不再更新、offline banner 卡住、session idle/compaction events 被忽略               | WebGUI, opencode core                    | WebGUI message/session event handling 测试通过；手动 chat session 能收到 streamed updates。                                                                   |
| Session lifecycle         | new session、switch session、draft restoration 或 tab rollback 失败                    | WebGUI, VSCode, JetBrains                | WebGUI session tests 通过；在受影响 host 中手动创建/切换 session。                                                                                            |
| Message input             | 文本发送、粘贴、keyboard shortcuts、mentions 或 path insertion 退化                    | WebGUI, VSCode, JetBrains                | component/hook tests 通过；在受影响 host 中手动 type/send 和 path insertion。                                                                                 |
| IDE bridge auth/transport | bridge 无法连接、token 误拒绝、SSE keepalive 停止、POST reply 丢失                     | WebGUI, VSCode, JetBrains                | VSCode 和/或 JetBrains bridge unit tests 通过；手动 bridge-connected WebGUI 可调用 host action。                                                              |
| Context commands          | Add file、Add selected lines、Paste path、drag/drop 不再插入路径                       | VSCode, JetBrains, WebGUI                | host command tests（如已有）通过；从 Explorer/editor/project tree 手动执行命令。                                                                              |
| Backend launch            | bundled binary 找不到、custom command fallback 失败、server URL 解析失败、process 泄漏 | VSCode, JetBrains, opencode core         | Backend launcher tests 通过；手动 panel/tool window launch 能进入 WebGUI。                                                                                    |
| Webview/JCEF integration  | panel/tool window 空白、cache busting 失败、bridge params 缺失                         | VSCode, JetBrains, WebGUI                | Webview/ChatToolWindow tests 通过；rebuild 后手动打开 panel/tool window。                                                                                     |
| Host open file action     | 文件路径或 line range 打开错误，Windows path normalization 失效                        | VSCode, JetBrains                        | Bridge/path inserter tests 通过；从 WebGUI message 手动 click/open file。                                                                                     |
| Scoped storage            | Theme、tabs、model preferences、quick phrases 或 drafts 未按 scope 持久化              | WebGUI, VSCode, JetBrains                | WebGUI repo/context tests 通过；手动 reload 确认预期持久化。                                                                                                  |
| Update/compatibility gate | minimum version、update banner 或 install update action 状态错误                       | WebGUI, VSCode, JetBrains                | Update service/context tests 通过；bridge-connected UI 中手动检查 version metadata。                                                                          |
| Generated images          | `/app/generated-image` route 失败或丢失 instance context                               | opencode core, WebGUI                    | route-level test 或从 active instance 手动 fetch generated image。                                                                                            |
| VSCode package            | VSIX 缺少版本更新、backend binary 或 valid manifest                                    | VSCode                                   | 按 `memory/context/vscode-packaging.md` 执行 packaging validation；确认 VSIX 存在且包含 Windows amd64 binary。                                                |
| JetBrains package         | Plugin build/test 失败，错误 Gradle 参数导致 daemon/file-lock 问题                     | JetBrains                                | `./gradlew.bat unitTest --no-daemon --console=plain`；packaging 时运行 `./gradlew.bat buildPlugin "-Pplugin.version=<version>" --no-daemon --console=plain`。 |
| Upstream TUI/API behavior | IDE/WebGUI adaptation 破坏 upstream CLI、TUI、routes 或 SDK generation                 | opencode core, TUI, WebGUI, IDE plugins  | 根据触达区域运行 core typecheck/tests/build；保留 upstream tests，或记录明确 waiver。                                                                         |

## Merge-Specific Checks

合并 upstream opencode 时：

1. 识别与 WebGUI/IDE adaptations 重叠的 upstream files。
2. 优先同时保留 upstream path 和本地 adaptation path。
3. 如果冲突无法同时保留两者，停止并让用户选择取舍。
4. 对本矩阵中每个受影响行运行 minimum evidence。
5. 对跳过的检查记录原因和 residual risk。

## Manual Smoke Scenarios

当 automated coverage 不完整时，使用这些手动 smoke 场景：

1. 启动 opencode backend，并在 browser 打开 `/app`。
2. 打开 VSCode activity bar panel；确认 WebGUI 加载，且可创建 new session。
3. 在 VSCode 中把当前文件或选中行加入 context，并确认 prompt 变化。
4. 打开 JetBrains tool window；确认 backend 启动、WebGUI 加载，并且 logs 在非必要时保持隐藏。
5. 在 JetBrains 中把 project file 或 selected editor lines 加入 context。
6. 从 WebGUI 触发 host action，例如 open file 或 copy text，并确认 host response。

## Completion Rule

改动在其受影响 matrix rows 有 fresh evidence 之前不得视为完成；如无法验证，必须记录 owner-approved waiver、原因和风险。
