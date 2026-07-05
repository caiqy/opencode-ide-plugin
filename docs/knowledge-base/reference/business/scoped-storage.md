# 能力：scoped storage 与主题偏好

> **象限**：Reference（能力参考）
> **能力编号**：F1 + E5（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线；部分 key 与历史文档存在漂移

## 代码真源

| 角色 | 文件 |
|------|------|
| scoped storage 核心 | `packages/opencode/webgui/src/state/scopedStorage.ts` |
| tabs/drafts/selection | `packages/opencode/webgui/src/state/repo/tabsRepo.ts`、`draftRepo.ts`、`selectionRepo.ts` |
| theme/model/quick phrases | `packages/opencode/webgui/src/state/repo/themeRepo.ts`、`modelPrefsRepo.ts`、`quickPhraseRepo.ts` |
| 主题上下文 | `packages/opencode/webgui/src/state/ThemeContext.tsx` |
| UI 设置上下文 | `packages/opencode/webgui/src/state/UISettingsContext.tsx` |

> 命名交叉核验（Step 5）：`scopedStorage.ts` 第 3 行定义 `StorageScope = "global" | "workspace" | "mem"`；各 repo 直接声明 `opencode:webgui:<scope>:<resource>:v<major>` key。

## 意图

把 WebGUI 自身的可恢复 UI 状态按 global/workspace/mem 分层保存，避免不同项目共享 tabs、drafts、selection，同时让主题、模型偏好和快捷短语这类用户偏好跨工作区复用。

## 行为契约

- 分层模型是组件/Context -> repo -> `scopedStorage` -> `ideBridge.storageGet/storageSet` -> 宿主存储；组件不应自己拼 key。
- key 形态是 `opencode:webgui:<scope>:<resource>:v<major>`，例如 `tabsRepo.ts` 第 3 行、`themeRepo.ts` 第 5 行、`selectionRepo.ts` 第 3 行。
- `workspace` 状态：tabs 是 `opencode:webgui:workspace:tabs:v1`（`tabsRepo.ts` 第 3 行），drafts/draft session 是第 3-4 行，selection 是 `selectionRepo.ts` 第 3 行。
- `global` 状态：theme 是 `themeRepo.ts` 第 5 行，model prefs 是 `modelPrefsRepo.ts` 第 3 行，quick phrases 是 `quickPhraseRepo.ts` 第 4 行。
- bridge 不可用时走浏览器/内存 fallback：`scopedStorage.ts` 第 83-89 行读取 fallback，第 115-128 行写入 fallback；bridge 可用但失败时第 92-107 行和 130-141 行使用内存缓存与 dirty 标记。
- 主题 hydration 后才持久化：`ThemeContext.tsx` 第 18-26 行加载主题，第 32-41 行切换 DOM `dark` class 并保存。

## 边界与约束

- 硬切策略：当前 repo 只读当前 key；没有旧 key fallback、双写或迁移逻辑。
- scoped storage 只保存 WebGUI UI 状态，不保存 opencode 全局 config；设置面板 config 见 [settings-panel](settings-panel.md)。
- `UISettingsContext.tsx` 当前是空 Provider（第 3-18 行），不要按历史文档假定它已持久化具体 UI 偏好。

## 状态归属

- `global`：theme、model prefs、quick phrases。
- `workspace`：tabs、drafts、draft session、last selection。
- `mem`：仅供宿主会话内瞬态状态使用，当前主要由 scoped storage 核心提供能力边界。
- `tabsRepo` 只表示 WebGUI 工作台打开状态，不删除真实 session。
- `draftRepo` 保存输入草稿和可复用 draft session id。
- `selectionRepo` 保存 provider/model/agent/variant 的 workspace 最近选择。
- `themeRepo` 默认回退 dark，并由 `ThemeContext` 写入 DOM class。
- `modelPrefsRepo` 用队列串行写入，避免 recent/favorite 并发覆盖。
- `quickPhraseRepo` 合并 preset 与 custom，并保存隐藏、排序和自定义项。

## 已知漂移

- [scoped-storage](scoped-storage.md) 示例写 `opencode:webgui:global:quick_phrases:v1`，当前代码是 `quickPhraseRepo.ts` 第 4 行的 `opencode:webgui:global:quick_phrase:v1`。
- [scoped-storage](scoped-storage.md) 写 `UISettingsContext` 管理通用 UI 偏好；当前代码只有空上下文。

## 运行时待核验

- [ ] VSCode `global/workspace/mem` 分别落到 `globalState/workspaceState/Map` 的实际宿主行为（`待运行时核验`）。
- [ ] JetBrains `global/workspace/mem` 分别落到对应 `PropertiesComponent`/session mem 的实际宿主行为（`待运行时核验`）。

## 相关

- 状态持久化深度清单：[scoped-storage](scoped-storage.md)
- non-git 项目隔离：[project-identity](project-identity.md)
- 主题偏好能力索引：[capabilities-index](../capabilities-index.md)
