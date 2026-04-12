# 技术栈：上游 Fork 同步

**项目:** opencode-ide-plugin — 上游同步工作流
**研究日期:** 2026-04-12
**总体置信度:** 高（基于代码库证据 + 已验证工具）

## 背景

本项目是 [anomalyco/opencode](https://github.com/anomalyco/opencode) 的下游 Fork，添加了 WebGUI 前端和 IDE 插件包装。上游推进很快（每周约 100+ 提交，从 v1.3.0 到 v1.4.3+ 大约每周发布一次）。上一次手动合并集成了 355 个提交并解决了 15 个冲突。当前分歧为 436 个上游提交 vs 384 个下游提交，横跨 637 个变更文件，已识别 12 个易冲突文件。

**核心问题:** 不存在自动化工作流。合并都是手动的、不频繁的、高风险的。

## 推荐技术栈

### CI/CD — GitHub Actions（核心自动化层）

| 技术                        | 版本        | 用途                 | 原因                                                                                                     |
| --------------------------- | ----------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| GitHub Actions              | N/A（平台） | 工作流编排           | 已在使用（`test.yml`、`typecheck.yml`）。所有现有 CI 在 Blacksmith runner 上运行。无需添加其他 CI 系统。 |
| `actions/checkout@v4`       | v4          | 带完整历史的仓库检出 | 已在使用。合并操作需要 `fetch-depth: 0`。                                                                |
| `.github/actions/setup-bun` | 本地        | 带缓存的 Bun 设置    | 已作为 composite action 存在。可复用于构建验证。                                                         |

**置信度:** 高——这些已在代码库中。

### 上游同步检测

| 技术            | 版本   | 用途                                          | 原因                                                                                                                                                                            |
| --------------- | ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原生 `git` 命令 | ≥2.38  | merge-tree 冲突预测、fetch、diff-stat         | `git merge-tree --write-tree`（自 git 2.38 起可用）可以在不触碰工作树的情况下预测冲突。这是冲突检测的最佳工具——零依赖，在 CI 中运行。已验证：能正确识别所有 12 个当前冲突文件。 |
| `@octokit/rest` | 22.0.1 | 用于 PR 创建、标签管理、提交比较的 GitHub API | 已是依赖项。用于程序化 PR 创建 + 带冲突报告的评论。                                                                                                                             |

**置信度:** 高——`git merge-tree --write-tree` 已对实际代码库状态验证。

### 为什么不使用第三方同步 Action

| Action                                          | Stars | 不使用原因                                                                                                                                                 |
| ----------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aormsby/Fork-Sync-With-Upstream-action` v3.4.3 | 311   | 设计用于简单的 fast-forward 同步。不处理合并冲突——直接失败。我们的仓库始终有冲突（当前 12 个文件）。另外，README 称"not currently in active development"。 |
| `peter-evans/create-pull-request` v8.1.1        | 2.7k  | 作为合并尝试后 PR 创建的辅助工具有用，但不解决冲突检测或合并策略。我们需要在创建 PR 之前进行冲突分析。                                                     |
| GitHub 内置的"Sync Fork"按钮                    | N/A   | 只做 fast-forward。当分支已分歧时无用，而我们的分支始终会分歧。                                                                                            |

**建议:** 使用原生 git 命令 + `@octokit/rest` 编写**自定义 GitHub Actions 工作流**。问题太具体，无法使用通用同步 Action——我们需要在单一管道中完成冲突预测、选择性合并和构建验证。

### 冲突检测与分析

| 技术                                                | 版本      | 用途                             | 原因                                                                                                                              |
| --------------------------------------------------- | --------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `git merge-tree --write-tree`                       | git ≥2.38 | 不修改工作树即可预测合并冲突     | 输出带有三方合并阶段信息的冲突文件路径。已验证：正确识别 `bun.lock`、`config.ts`、`mcp/index.ts`、`provider.ts`、`server.ts` 等。 |
| `git diff --stat`                                   | 原生      | 总结上游变更范围                 | 为 PR 描述生成可读的变更摘要。                                                                                                    |
| `git log --oneline` 加路径过滤                      | 原生      | 跟踪哪些上游提交触及了易冲突文件 | 对理解冲突原因至关重要——"这 5 个提交更改了 config.ts"。                                                                           |
| 自定义 TypeScript 脚本（`script/upstream-sync.ts`） | N/A       | 编排检测 + 报告                  | Bun 原生脚本，运行 `git merge-tree`、解析输出、按严重程度分类冲突（锁文件 vs API 代码 vs 配置）、生成合并报告。                   |

**置信度:** git 工具为高（已验证）。自定义脚本为中（设计选择，未验证）。

### 构建验证

| 技术                              | 版本      | 用途               | 原因                                                                                  |
| --------------------------------- | --------- | ------------------ | ------------------------------------------------------------------------------------- |
| Turborepo                         | 2.8.13    | 并行构建编排       | 已配置。`bun turbo typecheck`、`bun turbo test`、`bun turbo build` 覆盖完整验证矩阵。 |
| `tsgo --noEmit`                   | 7.0.0-dev | 快速类型检查       | 已通过 `bun typecheck` 使用。比 `tsc` 快 10-50 倍。对快速合并验证至关重要。           |
| Vitest                            | 4.0.13    | WebGUI 单元测试    | 已配置。合并后必须通过。                                                              |
| Bun test                          | N/A       | 核心 opencode 测试 | 已配置。合并后必须通过。                                                              |
| Mocha                             | 10.2.0    | VSCode 扩展测试    | 已配置。                                                                              |
| `hosts/scripts/build_opencode.sh` | N/A       | 跨平台二进制构建   | 已存在。验证合并后的代码确实能为所有目标平台编译。                                    |

**置信度:** 高——所有工具已在代码库中。

### 变更日志与合并跟踪

| 技术                                   | 版本 | 用途                         | 原因                                                                                                                         |
| -------------------------------------- | ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `git log --format` 加自定义模板        | 原生 | 提取合并点之间的上游变更日志 | 解析上游提交信息用于发布说明。上游使用约定式提交风格（`feat:`、`fix:`、`refactor:` 等）。                                    |
| `.planning/merges/` 中的 Markdown 文件 | N/A  | 持久化合并记录               | 存储合并报告：上游范围、发现的冲突、解决策略、构建结果。人类可读，用 git 跟踪。                                              |
| GitHub PR body + labels                | N/A  | 每次合并的跟踪               | 每次上游同步得到一个带结构化内容的 PR：上游范围、冲突列表、构建状态。标签：`upstream-sync`、`has-conflicts`、`clean-merge`。 |

**为什么不使用自动化变更日志工具:**

- `conventional-changelog`、`changesets`、`release-it`——设计用于你项目的发布，而不是跟踪上游的发布
- 上游已经有自己的发布说明。我们需要跟踪上游改变了什么，而不是为上游代码生成我们自己的变更日志。

**置信度:** 高——这是工作流设计选择，不是库依赖。

### 合并策略工具

| 技术                      | 版本 | 用途                     | 原因                                                                                                                        |
| ------------------------- | ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `git merge --no-commit`   | 原生 | 暂存合并而不自动提交     | 允许在完成前检查 + 手动冲突解决。                                                                                           |
| `git rerere`              | 原生 | 记住并重放冲突解决       | 对重复冲突至关重要。同样的文件（`config.ts`、`mcp/index.ts`、`server.ts`）每次合并都冲突。`rerere` 学习解决模式并自动应用。 |
| `.gitattributes` 合并驱动 | 原生 | 每个文件的自定义合并行为 | 设置 `bun.lock` 使用 `ours` 策略（合并后重新生成）。设置锁文件为二进制合并。                                                |

**置信度:** `git merge/rerere` 为高（标准 git）。自定义合并驱动为中（需要测试）。

## 支持库（已在项目中）

| 库              | 版本           | 相关用途                    | 说明                                                           |
| --------------- | -------------- | --------------------------- | -------------------------------------------------------------- |
| `@octokit/rest` | 22.0.1         | PR 创建、评论发布、标签管理 | 已是依赖项。用于自动化 PR 工作流。                             |
| `semver`        | ^7.6.0         | 上游发布的版本比较          | 已是 devDependency。解析上游版本标签。                         |
| `glob`          | 13.0.5         | 文件模式匹配                | 已是 devDependency。用于冲突路径分类。                         |
| `diff`          | ^7.0.0 / 8.0.2 | 文本差异比较                | 已在 WebGUI 中用于文件变更显示。可用于合并报告中的冲突可视化。 |

**置信度:** 高——均在 `package.json` 中验证。

## 需要的新依赖

**无。** 整个上游同步工作流可以用以下工具构建：

1. 原生 git 命令（所有 CI runner 上可用）
2. 项目中已有的库（`@octokit/rest`、`semver`、`glob`）
3. GitHub Actions（已是 CI 平台）
4. Bun 运行时（已是脚本运行时）

这是刻意的选择。Fork 同步是一个**工作流问题**，而不是**库问题**。为此添加依赖会在一个已经跟踪快速演进上游的项目中增加维护负担。

## 备选方案评估

| 类别         | 推荐方案                      | 备选方案                                 | 不使用原因                                                                                                |
| ------------ | ----------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 同步自动化   | 自定义 GHA 工作流             | `aormsby/Fork-Sync-With-Upstream-action` | 无法处理冲突，未积极维护                                                                                  |
| 同步自动化   | 自定义 GHA 工作流             | Renovate/Dependabot 用于 Fork 跟踪       | 这些工具跟踪依赖更新，而非上游 Fork 代码变更                                                              |
| 冲突检测     | `git merge-tree --write-tree` | 在临时分支中尝试合并                     | merge-tree 更干净、更快，不创建一次性分支                                                                 |
| 冲突检测     | `git merge-tree --write-tree` | 第三方合并分析工具（mergify、kodiak）    | 对单一上游仓库场景来说过于复杂。这些是为多贡献者 PR 管理设计的。                                          |
| 变更日志跟踪 | Git log 解析 + markdown       | `conventional-changelog` / `changesets`  | 工具不对——设计用于你的发布，而非跟踪别人的                                                                |
| PR 创建      | `@octokit/rest`（已安装）     | `peter-evans/create-pull-request`        | create-pull-request 不错但我们需要自定义逻辑（冲突报告、标签、条件创建）。直接使用 Octokit 给予完全控制。 |
| 构建验证     | 现有 Turborepo 管道           | 单独的 CI 矩阵                           | 已有 `bun turbo typecheck && bun turbo test && bun turbo build`。无需重新发明。                           |
| 合并记忆     | `git rerere`                  | 自定义冲突数据库                         | rerere 内置于 git，自动工作，零维护                                                                       |

## 工作流架构

```
┌─────────────────────────────────────────────────────────────────┐
│ GitHub Actions: upstream-sync.yml（定时 + 手动触发）             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 检测                                                        │
│     ├── git fetch opencode dev                                  │
│     ├── git rev-list --count（有新提交？）                       │
│     └── git log --oneline（范围内有发布标签？）                   │
│                                                                 │
│  2. 分析                                                        │
│     ├── git merge-tree --write-tree（预测冲突）                  │
│     ├── 分类冲突：                                               │
│     │   ├── 锁文件 (bun.lock) → 自动解决：重新生成               │
│     │   ├── PACKAGE_JSON → 自动解决：合并 + bun install          │
│     │   ├── 我们的代码 (webgui/, hosts/) → 标记待审查            │
│     │   └── 上游 API (server.ts, config.ts, mcp/) → 高风险      │
│     └── 生成合并报告 markdown                                    │
│                                                                 │
│  3. 合并（如果可自动解决或手动触发）                              │
│     ├── git merge --no-commit opencode/dev                      │
│     ├── git rerere（应用已学习的解决方案）                        │
│     ├── 解决锁文件：bun install → git add bun.lock              │
│     └── git commit（带范围的结构化消息）                          │
│                                                                 │
│  4. 验证                                                        │
│     ├── bun turbo typecheck                                     │
│     ├── bun turbo test (packages/opencode)                      │
│     ├── bun turbo build (webgui)                                │
│     └── hosts/scripts/build_vscode.sh（VSCode 扩展能编译？）     │
│                                                                 │
│  5. 报告                                                        │
│     ├── 通过 @octokit/rest 创建/更新 PR                         │
│     ├── 标签：upstream-sync、冲突严重程度                        │
│     ├── PR 内容：上游范围、冲突、构建结果                        │
│     └── 写入 .planning/merges/YYYY-MM-DD.md                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 已知冲突热点（2026-04-12 验证）

几乎每次上游合并都会冲突的文件。这些驱动了工具选择：

| 文件                                                      | 冲突类型        | 可自动解决？ | 策略                                                                |
| --------------------------------------------------------- | --------------- | ------------ | ------------------------------------------------------------------- |
| `bun.lock`                                                | 锁文件          | 是           | 合并后重新生成（`bun install`）                                     |
| `packages/opencode/package.json`                          | 版本 + 依赖     | 部分         | 合并文本，然后 `bun install` 协调                                   |
| `packages/opencode/src/config/config.ts`                  | API 新增        | 否           | 我们的技能权限覆盖层 + 上游配置变更。需手动审查。                   |
| `packages/opencode/src/mcp/index.ts`                      | 功能新增        | 否           | 我们的 setEnabled/setToolEnabled + 上游 MCP 变更。需手动审查。      |
| `packages/opencode/src/provider/provider.ts`              | SSE 规范化      | 否           | 我们的 Anthropic SSE 修复 + 上游 provider 变更。需手动审查。        |
| `packages/opencode/src/server/server.ts`                  | 路由排序        | 可能         | 我们的 /app 路由在 WorkspaceRouter 之前。模式可能可被 rerere 记忆。 |
| `packages/opencode/src/server/instance/index.ts`          | Webgui 路由     | 可能         | 我们的 webgui 路由注册。模式可能可被 rerere 记忆。                  |
| `packages/opencode/src/session/compaction.ts`             | Bug 修复覆盖    | 否           | 我们的 TypeValidationError 恢复。需手动审查。                       |
| `packages/opencode/src/session/message-v2.ts`             | 功能新增        | 否           | 需手动审查。                                                        |
| `packages/opencode/src/skill/index.ts`                    | 权限覆盖        | 否           | 我们的技能权限覆盖层。需手动审查。                                  |
| `packages/opencode/test/session/llm.test.ts`              | 测试更新        | 可能         | 通常双方只是追加。                                                  |
| `packages/app/src/pages/session/use-session-commands.tsx` | 上游 Solid 应用 | 可能         | 我们不大量修改此文件。                                              |

## 合并自动化的文件分类

```
仅我方（永不冲突——上游不触碰）：
  hosts/vscode-plugin/**
  hosts/jetbrains-plugin/**
  hosts/scripts/**
  packages/opencode/webgui/**（上游有 packages/app/ 替代）
  .planning/**

仅上游（取上游——我们不修改）：
  .github/workflows/*（除了我们自定义的）
  docs/**
  nix/**
  packages/app/**（上游的 Solid Web 应用）
  packages/console/**
  packages/desktop/**
  README.*.md

冲突区（双方都修改）：
  packages/opencode/src/server/**
  packages/opencode/src/config/**
  packages/opencode/src/mcp/**
  packages/opencode/src/session/**
  packages/opencode/src/skill/**
  packages/opencode/src/provider/**
  packages/opencode/package.json
  bun.lock
  package.json
```

## 安装

无需新包。对于自定义同步脚本：

```bash
# 已安装：
# @octokit/rest@22.0.1, semver@^7.6.0, glob@13.0.5

# 需要创建的新文件（不是包）：
# .github/workflows/upstream-sync.yml    — 定时 + 手动工作流
# script/upstream-sync.ts                — Bun 脚本用于冲突分析
# script/upstream-report.ts              — 生成合并报告 markdown
# .gitattributes                         — 锁文件的合并驱动
```

## Git 配置

```bash
# 启用 rerere（记住冲突解决）
git config rerere.enabled true
git config rerere.autoupdate true

# .gitattributes 用于合并策略
echo "bun.lock merge=ours" >> .gitattributes
```

## 来源

- `git merge-tree --write-tree`——在此仓库上验证（2026-04-12），正确预测 12 个冲突文件
- `@octokit/rest`——已在 `package.json` 中，版本 22.0.1，通过 `grep` 验证
- `aormsby/Fork-Sync-With-Upstream-action` v3.4.3——GitHub Marketplace 页面（未积极维护，311 stars）
- `peter-evans/create-pull-request` v8.1.1——GitHub Marketplace 页面（2.7k stars，活跃）
- 上游发布节奏——通过 `git log --grep="release:"` 验证（v1.3.0 → v1.4.3+）
- 冲突热点——通过 `git merge-tree --write-tree --no-messages ide-plugin opencode/dev` 验证
- 所有现有 CI 基础设施——从 `.github/workflows/`、`turbo.json`、`package.json` 验证

---

_技术栈研究：2026-04-12_
