# Tutorial：在 VSCode 完成第一次 OpenCode 对话

这篇 tutorial 带你从安装 VSIX 走到第一次 AI 对话。它不覆盖所有配置细节；遇到需要深入理解的地方，顺着链接去看 reference 或 how-to。

## 前提

1. 准备一个可运行插件的 VSCode。具体最低版本和宿主行为以 VSCode 插件 `package.json` 与 [backend-launch](../reference/business/backend-launch.md) 为准。
2. 准备 OpenCode backend。插件可以使用内嵌 binary，也可以连接你通过 `opencode serve` 启动的 backend；启动优先级和回退规则见 [backend-launch](../reference/business/backend-launch.md)。
3. 打开一个项目目录。第一次练习建议用普通 Git 仓库，方便后续把文件加入上下文。

## 1. 安装 VSIX

1. 在 VSCode 中打开 Extensions 视图。
2. 选择 `Install from VSIX...`，安装当前构建出的 OpenCode IDE Plugin VSIX。
3. 安装后按 VSCode 提示 Reload Window。
4. 如果你是在开发新命令或右键入口，先读 [add-vscode-command](../how-to/hosts/add-vscode-command.md) 理解 VSCode command、menu、keybinding 的位置。

## 2. 打开 OpenCode 面板

1. 在 Activity Bar 找到 OpenCode 入口并打开。
2. 面板打开后，插件会启动或连接 backend，并把 WebGUI 加载进 VSCode webview。
3. 等待界面完成加载。如果卡在启动阶段，先看 [backend-launch](../reference/business/backend-launch.md) 的 backend lifecycle，再看 [architecture-overview](../explanation/architecture-overview.md) 理解 IDE Host、WebGUI、opencode server 三层关系。

## 3. 创建第一个会话

1. 在 OpenCode 面板中进入聊天界面。
2. 如果没有当前会话，使用界面里的新会话入口创建一个 session。
3. 在输入框写一句简单请求，例如让它解释当前项目结构。
4. 发送消息，观察 assistant 回复、工具卡片和流式状态。

你现在已经走过 WebGUI 输入区、opencode server session、SSE 消息回传这条主链路。会话、消息、分页和多 tab 的细节见 [session-chat](../reference/business/session-chat.md)。

## 4. 把文件加入上下文

1. 在 VSCode Explorer 或 Editor 中选中文件。
2. 按 `Ctrl+'`，macOS 用 `Cmd+'`，把当前文件加入输入框上下文。
3. 也可以右键文件或选区，选择 OpenCode 的 Add to context 类命令。
4. 回到 OpenCode 输入框，确认文件以 mention 形式出现。
5. 发送一个围绕该文件的问题，例如「解释这个文件的职责」。

如果你选中多行，可以用对应的 Add selected lines 入口；路径插入和拖拽行为见 [context-insertion](../reference/business/context-insertion.md)。

## 5. 下一步

1. 想理解聊天工作台：读 [session-chat](../reference/business/session-chat.md)。
2. 想改前端能力：从 [how-to/frontend](../how-to/frontend/) 进入。
3. 想理解整体架构：读 [architecture-overview](../explanation/architecture-overview.md)。

## 你完成了什么

你已经安装 VSIX、打开 OpenCode Activity Bar、等待 backend 启动、创建并发送了第一个会话消息，还把 VSCode 文件加入了 AI 上下文。这是使用 OpenCode IDE Plugin 的最小闭环。
