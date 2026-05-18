# 状态持久化与 scoped storage

WebGUI 的状态分为两类：opencode 服务端配置/会话数据，以及插件 UI 自己的偏好和恢复状态。为了避免跨项目串数据，本项目将 UI 状态统一收敛到 scoped storage。

## 三类作用域

`StorageScope = "global" | "workspace" | "mem"`

- `global`：跨工作区共享，例如主题、全局模型偏好、更新忽略版本。
- `workspace`：当前项目可恢复状态，例如标签页、草稿、最近选择。
- `mem`：Host session 内瞬态状态，随 IDE 会话结束清空。

## non-git 项目目录隔离

non-git 普通目录现在会按目录派生稳定 project id，不再坍缩到 `ProjectID.global` / `worktree = "/"`。这会影响 workspace 级 scoped storage 的真实边界：

- 同一个 non-git 目录重复打开，应恢复同一组 workspace tabs、drafts、selection。
- 不同 non-git 目录即使都没有 Git，也不能共享 workspace tabs、drafts、selection。
- 历史 global project session 会在运行时迁移到目录派生的 non-git project id。

维护时如果调整 project identity、path normalize 或 session list 逻辑，必须同时跑 `packages/opencode/test/project/project.test.ts`，确认 non-git 目录隔离没有退回 global。

关键文件：

- `packages/opencode/webgui/src/state/scopedStorage.ts`
- `packages/opencode/webgui/src/state/repo/`
- `hosts/vscode-plugin/src/ui/WebviewController.ts`
- `hosts/vscode-plugin/src/ui/WebviewManager.ts`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridgeStorageBackend.kt`

## 命名规则

统一 key 形态：

```text
opencode:webgui:<scope>:<resource>:v<major>
```

典型资源：

- `opencode:webgui:global:theme:v1`
- `opencode:webgui:global:model:v1`
- `opencode:webgui:global:quick_phrases:v1`
- `opencode:webgui:global:update:v1`
- `opencode:webgui:workspace:last_selection:v1`
- `opencode:webgui:workspace:tabs:v1`
- `opencode:webgui:workspace:drafts:v1`
- `opencode:webgui:workspace:draft_session:v1`

## 分层模型

```text
React 组件 / Context
  -> repo（tabsRepo、draftRepo、selectionRepo、themeRepo、modelPrefsRepo、quickPhraseRepo）
  -> scopedStorage
  -> ideBridge.storageGet/storageSet
  -> VSCode globalState/workspaceState 或 JetBrains PropertiesComponent
```

WebGUI 不直接读写宿主存储；组件也不直接拼 key。Repo 层负责资源语义，`scopedStorage` 负责作用域与 bridge fallback。

## 宿主实现

VSCode：

- `global` → `context.globalState`
- `workspace` → `context.workspaceState`
- `mem` → `Map<string, string>`

JetBrains：

- `global` → `PropertiesComponent.getInstance()`
- `workspace` → `PropertiesComponent.getInstance(project)`
- `mem` → `Session.mem`

## 硬切策略

历史上存在 `uiGetState/uiSetState`、聚合 `sdk.kv`、旧 global state 等路径。当前策略是硬切：

- 不读取旧 key。
- 不 fallback。
- 不双写。
- 不迁移。
- 新代码只使用 `storageGet/storageSet`，并显式传入 `scope`、`key` 与 `value`。

## 主要状态归属

- 主题：global。
- 模型 recent/favorite：global。
- 快捷短语 custom/hidden/order/mode：global。
- 更新忽略版本：global。
- agent/provider/model/variant 最近选择：workspace。
- open tabs / active tab：workspace。
- 会话草稿：workspace。
- 当前草稿会话：workspace。

## Repo 职责

- `tabsRepo.ts`：保存打开的会话 tab 与 active tab；仅表示 UI 工作台状态，不删除真实会话。
- `draftRepo.ts`：保存每个会话输入草稿和可复用的 draft session id。
- `selectionRepo.ts`：保存 workspace 级 provider/model/agent/variant 最近选择；会话激活时还会结合消息历史恢复更精确的选择。
- `themeRepo.ts`：保存全局主题偏好，供 `ThemeContext` hydration 后切换 DOM `dark` class。
- `modelPrefsRepo.ts`：保存模型 recent/favorite，供 `ModelSelector` 搜索和置顶常用模型。
- `quickPhraseRepo.ts`：合并 preset 与 custom 快捷短语，维护隐藏项、排序和执行模式，并通过事件通知输入区刷新。

这些 repo 是 WebGUI 状态真源的边界。组件可以组合多个 repo 的结果，但不应自己拼 scoped storage key。

## 维护注意点

- 新增 UI 持久化状态前先判断作用域，不要默认 global。
- 不要在不同 scope 复用同名 resource。
- 组件层不要绕过 repo 直接调用 `ideBridge.request("storageSet")`。
- bridge 不可用时 `scopedStorage` 会回退到内存缓存，适合浏览器开发模式，但不能当作长期持久化。
