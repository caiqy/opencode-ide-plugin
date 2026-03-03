# WebGUI 更多菜单「重启插件」设计

## 背景

当前 WebGUI 右上角「更多选项」菜单已有「配置文件」入口，但缺少快速重启插件/宿主的能力。用户希望在「配置文件」下方增加「重启插件」按钮，并在确认后触发宿主侧重启：

1. VSCode：通过 `workbench.action.reloadWindow` 重载窗口。
2. JetBrains：若无法实现仅重启插件，则不显示；经方案确认后，采用“重启整个 IDE”实现等效插件重载。

## 目标

1. 在更多菜单中新增「重启插件」入口，位置位于「配置文件」下方。
2. 点击后弹出自定义确认模态框，用户确认后执行重启请求。
3. 按宿主能力执行：VSCode 重载窗口，JetBrains 重启 IDE。
4. 宿主不支持时不显示该入口。

## 非目标

1. 不实现“仅重启 JetBrains 插件而不重启 IDE”的高级能力。
2. 不引入新的全局弹窗系统（复用现有 `ConfirmModal`）。
3. 不调整其它菜单项结构和行为。

## 方案比较

### 方案 A：新增独立 ConfirmDialog 组件/Context

- 优点：可扩展成统一弹窗服务。
- 缺点：与现有实现重复，改动面偏大。

### 方案 B：复用现有 `ConfirmModal`（采纳）

- 优点：与现有「删除会话」交互一致，改动最小，样式统一。
- 缺点：确认逻辑仍在调用方管理，需要新增少量状态。

### 方案 C：浏览器原生 `window.confirm`

- 优点：实现最快。
- 缺点：样式不可控、体验不一致，不满足需求。

## 采纳方案设计（B）

### 1) 架构与能力协商

通过 ideBridge 的 `connected` 元数据下发重启能力字段（建议 `restartMode`）：

- `"window"`：支持窗口级重载（VSCode）
- `"ide"`：支持 IDE 重启（JetBrains）
- 缺省/空：不支持

WebGUI 仅在 `restartMode` 存在时显示「重启插件」菜单项。

### 2) WebGUI 组件改动

涉及文件：

- `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- `packages/opencode/webgui/src/lib/ideBridge.ts`

改动要点：

1. 在 ActionButtons 菜单中于「配置文件」后插入「重启插件」按钮。
2. 增加显示条件 `canRestart`（来自 `restartMode`）。
3. 点击菜单项只打开确认框，不直接执行重启。
4. 复用 `ConfirmModal`：
   - VSCode 文案：将重载窗口并重启插件。
   - JetBrains 文案：将重启 IDE 以重新加载插件。
5. 用户确认后调用 `ideBridge.request("restartHost")`。

### 3) Host 侧改动

#### VSCode

涉及文件：

- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- `hosts/vscode-plugin/src/ui/WebviewController.ts`

改动要点：

1. `createSession(..., metadata)` 中附带 `restartMode: "window"`。
2. 在 `IdeBridgeServer.handleSend` 新增 `restartHost` 分支。
3. 执行 `vscode.commands.executeCommand("workbench.action.reloadWindow")`。

#### JetBrains

涉及文件：

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`

改动要点：

1. `connected` 事件数据增加 `restartMode: "ide"`。
2. 在 `when (type)` 中新增 `"restartHost"` 分支。
3. 执行 IDE 重启 API（重启整个 IDE）。

## 数据流

1. WebGUI 建立 ideBridge 连接并接收 `connected` 元数据。
2. 根据 `restartMode` 决定是否渲染菜单项。
3. 用户点击「重启插件」-> 打开 `ConfirmModal`。
4. 用户确认 -> `ideBridge.request("restartHost")`。
5. Host 执行重启行为（VSCode 重载窗口 / JetBrains 重启 IDE）。

## 错误处理

1. **能力缺失**：不显示按钮，避免无效点击。
2. **重复点击**：确认期间 `isLoading` 禁用操作按钮。
3. **请求失败**：显示错误 toast（例如“重启失败，请稍后重试”）。
4. **宿主不支持**：返回 unsupported 时显示明确提示，不崩溃。

## 测试策略

### WebGUI

1. `ActionButtons`：
   - `restartMode` 有值时显示「重启插件」，无值时隐藏。
   - 顺序断言：位于「配置文件」下方。
2. `CompactHeader`：
   - 点击菜单项打开 `ConfirmModal`。
   - VSCode/JetBrains 两种确认文案分支正确。
   - 确认后调用 `ideBridge.request("restartHost")`。
   - 失败时触发错误 toast。

### Host

1. VSCode `IdeBridgeServer`：`restartHost` 分支触发 `reloadWindow`。
2. JetBrains `IdeBridge`：`restartHost` 分支进入 IDE 重启路径并正常应答。

## 验收标准

1. WebGUI 更多菜单在「配置文件」下方出现「重启插件」（仅宿主支持时）。
2. 点击后出现确认模态框，确认后触发对应宿主重启行为。
3. VSCode 实际执行窗口重载；JetBrains 实际执行 IDE 重启。
4. 不支持场景下按钮不显示；失败场景可见错误提示。
