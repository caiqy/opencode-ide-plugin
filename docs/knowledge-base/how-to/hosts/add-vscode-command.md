# 新增 VSCode 右键命令

适用：在 VSCode 插件里新增 explorer/editor/view 右键命令，并把结果送入 WebGUI 或宿主能力。

## 先确认入口

1. 打开 [context-insertion](../../reference/business/context-insertion.md) 或 [host-actions](../../reference/business/host-actions.md)。
2. 查 [hosts-vscode-plugin 仓库参考](../../reference/repositories/hosts-vscode-plugin.md) 的 `package.json` commands/menus 契约。
3. 对照 [CONVENTIONS](../../../../CONVENTIONS.md)：VSCode 插件类用 PascalCase，命名类导出。

## 注册命令

1. 在 `hosts/vscode-plugin/src/commands/` 新增或扩展命令类。
2. 命令 id 沿用 `opencode.*` 命名空间。
3. 在 `hosts/vscode-plugin/package.json` 同步 `contributes.commands`。
4. 同一文件同步 `contributes.menus`，选择需要的位置：
   - `explorer/context`
   - `editor/context`
   - `view/title`
   - `view/item/context`
   - `commandPalette`
5. 需要快捷键时，同步 `contributes.keybindings`。

## 实现命令

1. 先复用现有 `AddToContextCommand`、`AddLinesToContextCommand`、`PastePathCommand` 模式。
2. 路径插入优先复用 `PathInserter` 或已有 bridge/webview 调用。
3. 错误处理走集中式 `ErrorHandler`。
4. 需要打开 panel 时，复用现有 `WebviewManager` / `ActivityBarProvider` 路径。
5. 不为单个命令新增第二套 bridge 通信。

## 写 Mocha 测试

1. 在 `hosts/vscode-plugin` 现有测试目录放同主题测试。
2. 覆盖命令注册或 handler 的主路径。
3. 覆盖无 active editor、无 workspace、无 selection 等最容易破的边界。
4. 如果测试需要 mock VSCode API，沿用现有 mock 方式。

## 手动检查

1. 在 VSCode 中打开 OpenCode activity bar panel。
2. 从右键菜单执行新增命令。
3. 确认 WebGUI 输入框或目标能力收到数据。
4. 如果命令涉及 Add to context、Add lines to context 或 Paste path，按 validation baseline 对应手动检查记录结果。

> 待运行时核验：右键菜单出现位置和 when 条件需在 Extension Development Host 中确认。

## 验证

Working directory: `hosts/vscode-plugin`

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

如果命令影响 packaging 内容，再运行：

```powershell
pnpm run package:dev
```

## 收尾

1. 更新相关 [business 文档](../../reference/business/)。
2. 如果新增跨宿主能力，同时评估 JetBrains 是否需要同名 action。
3. 如果需要 bridge 新消息，按 [新增 IDE bridge 消息](../frontend/add-ide-bridge-message.md) 处理。
