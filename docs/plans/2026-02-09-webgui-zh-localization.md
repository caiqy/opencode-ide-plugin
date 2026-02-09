# WebGUI 中文化（含工具名翻译）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `packages/opencode/webgui` 的所有界面文案中文化（固定中文、无语言切换），并把工具调用的“工具名称展示”翻译为中文；专业名词保留原样，翻译需自然、统一。

**Architecture:**
- **静态 UI 文案**：直接替换组件内的用户可见字符串（含 `title`/`data-tip`/`aria-label`/`placeholder` 等）。
- **工具名称展示**：在 `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx` 与 `ToolHeader.tsx` 集中做映射，保证所有工具头部展示一致；映射表在本文档维护并逐个与用户确认后落地。
- **验证**：以 `packages/opencode/webgui` 的 Vitest 测试为主，配合 lint/build 做最小覆盖。

**Tech Stack:** React 19 + TypeScript + Vite + TailwindCSS + Vitest

---

## 已确认决策（写代码前固定）

- 语言策略：**固定中文**（不引入 i18n；不提供 UI 语言切换）
- 术语：
  - Session → **会话**
  - Agent → **智能体**
  - Provider → **提供方**
  - New Session → **新建会话**
  - Command Palette → **命令面板**
  - Settings → **设置**
  - Dark Mode / Light Mode → **深色模式 / 浅色模式**
  - Share / Unshare → **分享 / 取消分享**（如：分享会话、取消分享会话）
  - Share link → **分享链接**
  - Connecting… / Connected / Disconnected / Connection Error → **连接中… / 已连接 / 未连接 / 连接错误**
  - Show usage details → **查看用量详情**
  - files changed → **文件变更**
  - Generating → **生成中**
  - Thinking… → **思考中…**
  - Thought for Ns → **思考了 N 秒**
  - Loading… → **加载中…**

- Diff/视图：
  - File Diff → **文件差异**
  - Split view / Unified view → **并排视图 / 统一视图**

- 文案风格：
  - placeholder 统一使用省略号字符：`…`

## Worktree 与基线（已完成）

- Worktree：`.worktrees/zh`（branch: `chore-webgui-zh-localization`）
- 依赖安装：`bun install --frozen-lockfile`（首次出现少量 link 失败，重试后通过）
- 基线测试：`bun run --cwd packages/opencode/webgui test:run`（36 files / 292 tests 通过）

## 工具名称翻译对照表（逐个确认后再落地）

> 说明：这里的 tool id（如 `bash/read/write`）来自消息里的 `part.tool`，属于“工具调用的 UI 展示”。
> - **状态**：✅ 已确认 / ⏳ 待确认
> - **中文名**：最终用于 UI 显示（是否同时展示英文 id 需要单独确认）

| tool id | 中文名（候选） | 状态 | 备注 |
| --- | --- | --- | --- |
| `bash` | 执行命令 | ✅ | 运行命令/脚本输出 |
| `read` | 查看 | ✅ | 读取文件 |
| `write` | 写入 | ✅ | 写入文件 |
| `edit` | 编辑 | ✅ | 编辑文件（diff） |
| `multiedit` | 批量编辑 | ✅ | 多段编辑 |
| `apply_patch` | 文件补丁 | ✅ | 应用 patch（可能涉及 move） |
| `list` | 浏览目录 | ✅ | 列目录/列文件 |
| `glob` | 路径匹配 | ✅ | glob 匹配 |
| `grep` | 文本查找 | ✅ | 文本搜索 |
| `webfetch` | 抓取网页 | ✅ | 获取 URL 内容 |
| `todoread` | 查看任务列表 | ✅ | TODO 列表（术语已定为“任务列表”） |
| `todowrite` | 更新任务列表 | ✅ | 写入 TODO 列表（术语已定为“任务列表”） |

### 规则（实现时遵守）

- 未在表内的工具：**保留原始 tool id**（避免隐藏调试信息），并在控制台打印一次提示（可选）。
- `todoread/todowrite` 的计数展示：使用 `已完成 X/Y`；若无已完成项则使用 `共 Y`。
- `getToolDisplayName()` 生成的标题里出现的英文名（如 `todos`/`files changed`）也需要中文化。
- 工具名与其参数拼接时使用中文全角标点（例如 `读取：path`），并保持风格一致。

## 计划任务（高层）

### Task 1：建立“界面文案清单/术语表”并锁定翻译风格

**Files:**
- Modify: `docs/plans/2026-02-09-webgui-zh-localization.md`

**Steps:**
1. 梳理高频 UI 词（Settings / Command Palette / Keyboard Shortcuts / Favorites / Recent / Default / Retry / Restore 等），在本文档新增“术语与风格”小节。
2. 标注哪些属于专业名词（保持英文），哪些要翻译（固定中文）。

**Verify:** 无

### Task 2：工具名称中文展示（先做最小可用）

**Files:**
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolHeader.tsx`
- Test: `packages/opencode/webgui/src/components/...`（按实际受影响测试补齐/更新）

**Steps:**
1. 新增工具名映射表（常量）与格式化函数（例如 `getToolLabel(toolId)`）。
2. 统一 `ToolHeader` 与 `getToolDisplayName` 对 tool id 的显示逻辑。
3. 逐个根据本表把工具名替换为中文；每次替换后更新相关测试断言。

**Verify:**
- Run: `bun run --cwd packages/opencode/webgui test:run`

### Task 3：按模块逐步中文化 UI 文案并更新测试

**Strategy:** 以“组件为单位”替换文案，避免一次性大改。

**候选模块顺序（可调整）**：
1. 顶部栏/菜单：`src/components/CompactHeader/**`
2. 命令面板：`src/components/CommandPalette.tsx`
3. 键盘快捷键帮助：`src/components/KeyboardShortcutsHelp.tsx` + `src/config/shortcuts.ts`
4. 设置面板：`src/components/SettingsPanel/**` + `src/components/settings/**`
5. 消息列表/撤销恢复/空状态：`src/components/MessageList/**`
6. 工具/补丁/差异视图：`src/components/parts/**` + `src/components/DiffModal/**`
7. 通用组件：`src/components/common/**`（aria/placeholder 等）

**Verify（每完成一个模块）**：
- Run: `bun run --cwd packages/opencode/webgui test:run`
- Optional: `bun run --cwd packages/opencode/webgui lint`

## 未决问题（需要逐个确认）

1. 工具名展示格式：✅ **中文为主 + tooltip 显示英文 tool id**（界面显示中文，悬停/标题显示原始 id 便于对照）
2. “TODOs” 术语：✅ 统一显示为 **任务列表**
3. 是否需要把工具调用的 `title`（来自 `part.state.title`，可能为英文）也统一改为中文/或保持原样？

## 当前完成情况（截至 2026-02-09）

- 已完成工具名中文展示：`ToolPart/utils.tsx` + `ToolHeader.tsx`。
- 已中文化模块（已落地）：`ModelSelector`、`CommandPalette`、`KeyboardShortcutsHelp` + `shortcuts`、`AgentSelector`、`VariantSelector`、`MessageInput`（`EditorContent` / `EditorToolbar` / `MessageActions` / `index` 确认弹窗）、`ConfirmModal`、`MessageList`（`ActionButtons` / `MessageStats` / `QuestionOptions` / `ReasoningPart`）、`SettingsPanel`（`header` / `footer` / `tab` / `index` + `General` / `Advanced` / `Models` 相关文案）、`Toast`、common `Modal` / `Button`、`TypingIndicator`。
- `CompactHeader` 本批完成：`ActionButtons` / `SessionDropdown` / `SessionList` / `SessionItem` / `index`、`StatusIndicator`、`UsageDisplay`。
- `DiffModal` 本批完成：`DiffHeader`。
- 测试证据：`bun run --cwd packages/opencode/webgui test:run` 全量通过（`64 files / 342 tests`）。

## 新会话续做建议

按优先级建议继续中文化：

1. `src/components/DiffModal/index.tsx`（`Loading diff...` / `No changes found` / `Close` / `files changed`）。
2. `src/components/CompactHeader` 其余可能残留（若有）。
3. `src/components/settings/ApiKeysTab/**`。
4. `src/components/attachment/AttachmentComponent.tsx`。
5. 其它 grep 扫描出的 `title` / `data-tip` / `aria` / `placeholder` 英文残留。

续做命令：

- 单测文件：`bun run --cwd packages/opencode/webgui test:run -- <path>`
- 全量回归：`bun run --cwd packages/opencode/webgui test:run`

约束：固定中文、专业 id 保留英文、不在仓库根目录跑 test。
