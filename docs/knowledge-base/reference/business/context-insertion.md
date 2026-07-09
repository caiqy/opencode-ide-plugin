# 能力：IDE 上下文插入

> **象限**：Reference（能力参考）
> **能力编号**：G2（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色                           | 文件                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| VSCode add file/folder         | `hosts/vscode-plugin/src/commands/AddToContextCommand.ts`                                        |
| VSCode add selected lines      | `hosts/vscode-plugin/src/commands/AddLinesToContextCommand.ts`                                   |
| VSCode paste directory path    | `hosts/vscode-plugin/src/commands/PastePathCommand.ts`                                           |
| VSCode command/menu/keybinding | `hosts/vscode-plugin/package.json`                                                               |
| JetBrains actions              | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/actions/`                                |
| JetBrains action registration  | `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`                                  |
| WebGUI bridge handlers         | `packages/opencode/webgui/src/App.tsx`                                                           |
| WebGUI input insertion         | `packages/opencode/webgui/src/components/MessageInput/index.tsx`                                 |
| Drop parsing/coordinator       | `packages/opencode/webgui/src/lib/dnd.ts`、`packages/opencode/webgui/src/lib/dropCoordinator.ts` |

> 命名交叉核验（Step 5）：能力索引 G2 的 add file/lines/paste/drag 四类入口分别对应 VSCode commands、JetBrains actions、WebGUI `insertPaths`/`pastePath`/drop handler。

## 意图

把 IDE 文件、选区行号、目录路径和拖拽文件转成 MessageInput mention，不破坏普通文本输入。IDE Bridge 协议见 [IDE Bridge 能力参考](ide-bridge.md)，宿主实现见 [hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md) 与 [hosts-jetbrains-plugin 参考](../repositories/hosts-jetbrains-plugin.md)，输入区行为见 [session-chat 能力参考](session-chat.md)。

## 行为契约

- 插入形态有四种：add file/folder、add selected lines、paste directory path、drag/drop 文件或目录。
- VSCode 声明 3 个 command id：`opencode.addFileToContext`、`opencode.addLinesToContext`、`opencode.pastePath`（`package.json:31-33`、`package.json:46-58`）。
- 这 3 个 command 覆盖 5 个入口位置/语义：Explorer 文件/文件夹 add、Editor add、selected lines、Explorer directory paste、多个目录 paste（`package.json:102-143`、`AddToContextCommand.ts:16-27`、`AddToContextCommand.ts:47-63`、`PastePathCommand.ts:16-43`、`PastePathCommand.ts:54-92`）。
- VSCode 默认快捷键只覆盖 editor add 与 add lines：`ctrl+'` / `cmd+'`，`ctrl+shift+'` / `cmd+shift+'`（`package.json:145-157`）。
- JetBrains 注册 4 个 action：Project add、Project paste path、Editor add、Editor add lines（`plugin.xml:18-48`）。
- JetBrains 快捷键共 6 条配置：Editor add 在 default/Mac/Mac 10.5+ 三套 keymap，Editor add lines 同样三套（`plugin.xml:36-38`、`plugin.xml:45-47`）。
- add lines 使用 1-based inclusive 行号，格式为 `{path}:{start}-{end}`；VSCode 对行首结束选择做 endLine 回退（`AddLinesToContextCommand.ts:38-58`），JetBrains 用 `selectionEnd - 1` 算闭区间（`EditorAddLinesToContextAction.kt:24-35`）。
- Host 向 UI 推送 `insertPaths` 和 `pastePath`；WebGUI handler 聚焦输入框后调用 MessageInput ref（`App.tsx:439-453`）。
- MessageInput 将文件路径转成 file mention，目录路径转成 directory mention 并保证目录显示以 `/` 结尾（`MessageInput/index.tsx:283-301`、`MessageInput/index.tsx:305-325`）。
- WebGUI 全局 drop 先从 `extractPathsFromDrop` 提取文件路径，再交给 drop coordinator（`App.tsx:505-529`、`dnd.ts:22-140`）。
- 从 VSCode Explorer 拖拽时，`dnd.ts` 优先读 `text/uri-list`/`application/vnd.code.uri-list`，再读 `application/vnd.code.tree.explorer`，避免 uri-list 已命中时重复解析 explorer tree（`dnd.ts:62-95`）。
- `dropCoordinator` 对文件/目录分别做 1200ms 去重，命中后才 focus、insertPaths、pastePath（`dropCoordinator.ts:27-58`）。

## 边界与约束

- `pastePath` 只面向目录；VSCode 会检查 `FileType.Directory`，JetBrains action 仅在选中目录时显示（`PastePathCommand.ts:25-30`、`ProjectPastePathAction.kt:17-26`）。
- Project add 对目录递归收集文件，不把目录本身作为 file mention（`AddToContextCommand.ts:102-124`、`ProjectAddToContextAction.kt:47-59`）。
- MessageInput 在 `locked` 时拒绝插入，避免会话忙碌状态修改输入（`MessageInput/index.tsx:305-307`、`MessageInput/index.tsx:329-331`）。

## 代码锚点速查

| 契约                  | 锚点                             |
| --------------------- | -------------------------------- |
| VSCode command 声明   | `package.json:46-58`             |
| VSCode 菜单入口       | `package.json:102-143`           |
| VSCode 快捷键         | `package.json:145-157`           |
| JetBrains action 注册 | `plugin.xml:18-48`               |
| Host -> UI handler    | `App.tsx:403-486`                |
| WebGUI 全局 drop      | `App.tsx:505-529`                |
| Drop 去重             | `dropCoordinator.ts:27-58`       |
| Mention 插入          | `MessageInput/index.tsx:283-325` |

## 运行时待核验

- [ ] VSCode Explorer 拖拽在 VSCode 1.108+ 的 `application/vnd.code.uri-list` 暴露情况（`待运行时核验`：需要真实 VSCode webview）。
- [ ] JetBrains 6 条快捷键在当前 IDE keymap 下是否被系统/IDE 占用（`待运行时核验`：需要安装插件试按）。

## 相关

- IDE Bridge 协议：[ide-bridge](ide-bridge.md)
- 消息输入能力：[message-input](message-input.md)
