# 架构模式：上游同步系统

**领域:** Fork 维护——下游 IDE 插件 Fork 与上游 CLI 工具同步
**研究日期:** 2026-04-12
**置信度:** 高（基于实际仓库结构、git 历史和合并提交分析）

## 背景

本 Fork（`caiqy/opencode-ide-plugin`）在上游 `anomalyco/opencode` CLI 工具之上添加了 WebGUI 层和 IDE 插件宿主（VSCode、JetBrains）。上游迭代速度快（两次同步之间约 355 个提交）。下游修改了约 28 个同时在上游发生变更的文件，形成了可预测但非平凡的合并冲突面。

**Git 拓扑结构:**

- `opencode` remote → 上游 CLI 仓库（`anomalyco/opencode`，默认分支 `dev`）
- `upstream` remote → 中间 Fork（`paviko/opencode-ide-plugin`）
- `origin` remote → 本仓库（`caiqy/opencode-ide-plugin`，默认分支 `ide-plugin`）

## 推荐架构

同步系统包含 **5 个组件**，以流水线方式组织。每个组件是一个独立步骤，可以独立失败和重试。

```
┌─────────────────────────────────────────────────────────────────┐
│                    UPSTREAM SYNC PIPELINE                        │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐  │
│  │  Fetch & │   │ Impact   │   │  Merge   │   │   Build    │  │
│  │  Detect  │──▶│ Analysis │──▶│ Execute  │──▶│   Verify   │  │
│  │          │   │          │   │          │   │            │  │
│  └──────────┘   └──────────┘   └──────────┘   └────────────┘  │
│       │              │              │               │           │
│       ▼              ▼              ▼               ▼           │
│  "New commits    "These files   "Merge done,    "Build pass,   │
│   available"      will clash"    N conflicts"    tests pass"   │
│                                                     │           │
│                                              ┌──────┴────────┐ │
│                                              │  Regression   │ │
│                                              │  Gate         │ │
│                                              └───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 组件边界

| 组件           | 职责                                                  | 输入                  | 输出                                 | 通信对象                 |
| -------------- | ----------------------------------------------------- | --------------------- | ------------------------------------ | ------------------------ |
| **拉取与检测** | 轮询上游，判断从上次 merge-base 起是否有新提交        | Git 远程仓库          | 提交范围、变更日志摘要               | 影响分析                 |
| **影响分析**   | 识别哪些下游修改过的文件被上游传入的提交触及          | 提交范围 + 已知冲突面 | 冲突风险报告（按文件），分级严重度   | 合并执行（决定策略）     |
| **合并执行**   | 在同步分支上执行 `git merge opencode/dev`，暴露冲突   | 合并策略 + 分支引用   | 已合并的分支（可能包含未解决的冲突） | 构建验证                 |
| **构建验证**   | 运行类型检查、单元测试、WebGUI 构建、SDK 重新生成     | 已合并的分支          | 每项检查的通过/失败状态              | 回归门控                 |
| **回归门控**   | 做出通过/不通过决策：所有检查通过，或报告哪些环节失败 | 构建结果              | 最终裁定 + 报告                      | 人工（用于冲突解决决策） |

### 数据流

```
opencode/dev (upstream)
    │
    ▼
[1] git fetch opencode
    │
    ▼
[2] git log $(git merge-base HEAD opencode/dev)..opencode/dev
    │   → commit list, diffstat
    │
    ▼
[3] Compare diffstat against KNOWN_CONFLICT_FILES list
    │   → per-file risk: SAFE / LIKELY_CONFLICT / GUARANTEED_CONFLICT
    │
    ▼
[4] git checkout -b sync/upstream-YYYYMMDD
    git merge opencode/dev
    │   → merge result (clean or conflicted)
    │
    ▼
[5] If conflicts: generate conflict report with file, ours/theirs context
    Human resolves (with AI assistance)
    │
    ▼
[6] bun install
    bun typecheck
    bun turbo test (from packages/opencode)
    Build WebGUI: bun --cwd packages/opencode/webgui build
    Build SDK: bun packages/sdk/js/script/build.ts
    VSCode compile: pnpm --cwd hosts/vscode-plugin compile
    JetBrains compile: gradle build (from hosts/jetbrains-plugin)
    │
    ▼
[7] All pass? → merge sync branch into ide-plugin
    Any fail? → report which step failed, stop
```

## 组件详情

### 组件 1：拉取与检测

**目的:** 判断上游自上次同步以来是否有新内容。

**机制:**

```bash
git fetch opencode
MERGE_BASE=$(git merge-base HEAD opencode/dev)
UPSTREAM_HEAD=$(git rev-parse opencode/dev)

if [ "$MERGE_BASE" = "$UPSTREAM_HEAD" ]; then
  echo "Already up to date"
  exit 0
fi

# Count commits
git rev-list --count $MERGE_BASE..opencode/dev
# Get summary
git log --oneline $MERGE_BASE..opencode/dev
```

**输出:** 提交数量、简要日志、新上游提交的日期范围。

**边界:** 此组件不修改任何分支。仅读操作。

### 组件 2：影响分析

**目的:** 在尝试合并前预测合并难度。

**从仓库分析得出的关键洞察:** 冲突面是有限且可预测的。基于 git 历史，以下文件在上下游均有修改：

**确定冲突区域（双方都在积极修改）:**
| 文件 | 下游修改原因 | 风险 |
|------|-------------|------|
| `packages/opencode/src/server/server.ts` | WebGUI `/app` 路由挂载、CORS | 高 |
| `packages/opencode/src/config/config.ts` | 工具覆盖层、技能权限覆盖层 | 高 |
| `packages/opencode/src/server/routes/mcp.ts` | MCP 启用/禁用路由 | 中 |
| `packages/opencode/src/session/compaction.ts` | 流式错误恢复 | 中 |
| `packages/opencode/src/mcp/index.ts` | setEnabled、setToolEnabled、toolsByServer | 中 |
| `packages/opencode/src/skill/index.ts` | 技能权限覆盖层 | 中 |
| `bun.lock` | 依赖更新时始终冲突 | 低（可自动解决） |
| `package.json` | 工作区/依赖变更 | 低 |
| `turbo.json` | 任务配置 | 低 |

**安全区域（仅下游新增，上游不触及）:**
| 区域 | 文件 |
|------|------|
| `hosts/` 整个目录 | VSCode 插件、JetBrains 插件、构建脚本、桥接规范 |
| `packages/opencode/webgui/` | 整个 WebGUI SPA（React 前端） |
| `.planning/` | 项目管理 |

**分析机制:**

```bash
# Get upstream changes
git diff --name-only $MERGE_BASE..opencode/dev > /tmp/upstream.txt
# Get downstream changes
git diff --name-only $MERGE_BASE..HEAD > /tmp/downstream.txt
# Find overlap
comm -12 <(sort /tmp/upstream.txt) <(sort /tmp/downstream.txt)
```

**输出:** 按风险等级分类的文件列表。如果上游只更改了安全区域的文件，合并就很轻松。

**边界:** 仅读分析。不修改分支。

### 组件 3：合并执行

**目的:** 在隔离分支上执行实际合并。

**策略（源自本仓库过去的合并提交）:**

1. **始终创建同步分支:** 从当前 `ide-plugin` HEAD 创建 `sync/upstream-YYYYMMDD`
2. **使用 `git merge`（而非 rebase）:** 历史记录表明所有过去的同步都使用了合并提交。Rebase 会重写下游历史，并与 IDE 插件开发分支冲突。
3. **尽可能保留双方内容:** 合并提交 `41ce0564a` 记录了该模式："所有 15 个冲突已解决，保留了 webgui 插件功能"

**冲突解决优先级（来自 PROJECT.md）:**

1. 保留上游逻辑变更（我们需要他们的功能）
2. 保留下游新增内容（我们的 `/app` 路由、配置覆盖层、MCP 路由）
3. 当不兼容时：保留双方并加入条件逻辑，或标记由人工决策

**历史记录中观察到的关键合并模式:**

- `/app` 路由：在 `server.ts` 中的 `WorkspaceRouter` 中间件之前插入
- 配置覆盖层：将下游的 `patchProjectField` / `toolsOverlay` 合并到上游的 Config.get() 中
- MCP 路由：下游添加了 `PATCH /mcp/:name/enabled` — 确保路由注册在上游重构后仍然存在
- SSE 错误恢复：下游添加了 `normalizeAnthropic`、`TypeValidationError` 捕获 — 在上游的流式管道中保留这些内容

**边界:** 创建新分支。不直接修改 `ide-plugin`。

### 组件 4：构建验证

**目的:** 确认合并后的代码能编译通过、类型检查通过、测试通过。

**验证链（顺序很重要——每步依赖前一步）:**

```
Step 1: bun install                              [dependency resolution]
   ↓
Step 2: bun typecheck                            [TypeScript across all packages]
   ↓  (parallel from here)
Step 3a: bun turbo test                          [unit tests - packages/opencode]
Step 3b: bun --cwd packages/opencode/webgui build [WebGUI compiles]
Step 3c: bun packages/sdk/js/script/build.ts     [SDK regeneration from OpenAPI]
   ↓  (after 3a-3c pass)
Step 4a: pnpm --cwd hosts/vscode-plugin compile  [VSCode extension compiles]
Step 4b: gradle build (hosts/jetbrains-plugin)    [JetBrains plugin compiles]
```

**为什么是这个顺序:**

- `bun install` 必须先执行——上游经常变更依赖
- `typecheck` 在浪费时间运行测试之前捕获整个 monorepo 的类型错误
- 单元测试和构建可以并行运行（互相独立）
- IDE 插件依赖 opencode 后端可构建，因此排在最后

**边界:** 在同步分支上运行。每步产生通过/失败结果。

### 组件 5：回归门控

**目的:** 最终的通过/不通过决策，附带可操作的报告。

**门控标准:**

| 检查项                 | 必需 | 理由                    |
| ---------------------- | ---- | ----------------------- |
| `bun install` 成功     | 是   | 没有依赖就无法继续      |
| `bun typecheck` 通过   | 是   | 类型错误 = API 表面损坏 |
| `bun turbo test` 通过  | 是   | 核心功能已验证          |
| WebGUI 构建成功        | 是   | WebGUI 是产品的 UI      |
| SDK 正常重新生成       | 是   | API 契约得到维护        |
| VSCode 插件编译成功    | 是   | 主要交付载体            |
| JetBrains 插件编译成功 | 软性 | 可以带着已知问题继续    |

**报告格式:**

```
Upstream Sync Report: opencode/dev @ <sha>
Commits merged: <N>
Conflicts resolved: <N>

Build Results:
  ✓ bun install
  ✓ typecheck
  ✓ unit tests (N passed, M failed)
  ✓ webgui build
  ✓ sdk regeneration
  ✓ vscode compile
  ✗ jetbrains compile (error: ...)

Verdict: PASS / FAIL / PASS_WITH_WARNINGS
```

**边界:** 决策点。如果 PASS，同步分支即可合并到 `ide-plugin`。

## 应遵循的模式

### 模式 1：已知冲突面注册表

**是什么:** 维护一份显式列表，记录所有下游修改过且可能与上游变更冲突的文件。

**为什么:** 冲突面是有限的（约 28 个文件）。提前知道可以让你：

- 在尝试合并前预测合并难度
- 为已知热点预先准备解决策略
- 检测上游重构是否将代码移出已知位置（新风险）

**实现:**

```typescript
// .planning/sync/CONFLICT_SURFACE.md or a JSON/TS config
const CONFLICT_SURFACE = {
  high: [
    "packages/opencode/src/server/server.ts", // /app route mounting
    "packages/opencode/src/config/config.ts", // tools/skill overlays
  ],
  medium: [
    "packages/opencode/src/server/routes/mcp.ts", // MCP toggle routes
    "packages/opencode/src/mcp/index.ts", // MCP methods
    "packages/opencode/src/skill/index.ts", // skill overlay
    "packages/opencode/src/session/compaction.ts", // error recovery
  ],
  low: [
    "bun.lock", // auto-resolvable
    "package.json", // dep changes
    "turbo.json", // task config
  ],
  safe: [
    "hosts/**", // downstream-only
    "packages/opencode/webgui/**", // downstream-only
  ],
}
```

**更新纪律:** 每次同步后，检查冲突面是否变化。重叠部分中出现新文件 = 添加到注册表。

### 模式 2：同步分支隔离

**是什么:** 永远不要将上游直接合并到 `ide-plugin`。始终通过 `sync/upstream-YYYYMMDD` 中转。

**为什么:**

- 如果合并出问题，丢弃该分支即可。`ide-plugin` 未受影响。
- CI 可以在合并前对同步分支运行测试。
- 多人可以在同步分支上协作解决冲突。
- 干净的合并提交消息（如 `41ce0564a`）记录了变更内容。

### 模式 3：锁文件解决策略

**是什么:** 始终通过接受上游版本然后重新运行 `bun install` 来解决 `bun.lock` 冲突。

**为什么:** `bun.lock` 是生成文件。手动合并既不可能也没有意义。下游的 `webgui` 和 `hosts` 包声明在 `package.json` 工作区中，因此 `bun install` 会正确地同时基于上游和下游依赖重新生成锁文件。

```bash
# During merge conflict on bun.lock:
git checkout --theirs bun.lock
bun install
git add bun.lock
```

### 模式 4：合并后 SDK 重新生成

**是什么:** 在任何涉及服务端路由的合并之后，始终重新生成 SDK。

**为什么:** SDK 是从 OpenAPI 规范（Hono 路由元数据）自动生成的。如果上游更改了路由，SDK 必须重新生成以保持匹配。WebGUI 和宿主插件消费此 SDK。

```bash
bun packages/sdk/js/script/build.ts
```

**检测:** 如果 `packages/opencode/src/server/routes/**` 出现在上游 diff 中，SDK 重新生成就是强制性的。

## 应避免的反模式

### 反模式 1：Cherry-Pick 同步

**是什么:** 逐个 cherry-pick 上游提交而不是合并。
**为什么不好:** 两次同步间上游有 200-400 个提交。Cherry-pick 会产生幻影冲突，丢失合并历史，并使下次同步更加困难。Git merge 能正确保留关系。

### 反模式 2：将下游 Rebase 到上游

**是什么:** 在 `ide-plugin` 分支上执行 `git rebase opencode/dev`。
**为什么不好:** 重写所有下游提交哈希。破坏所有基于 `ide-plugin` 的分支。需要强制推送。现有历史表明基于 merge 的同步方式是有效的。

### 反模式 3：修改上游文件但不跟踪

**是什么:** 对上游拥有的文件进行修改，但不将其添加到冲突面注册表中。
**为什么不好:** 在下次同步时产生意外冲突。对上游文件的每次下游修改都应该是有意的、最小化的，并且已注册。

### 反模式 4：跳过构建验证

**是什么:** 合并上游后不运行完整的构建流水线。
**为什么不好:** 上次大型合并（`41ce0564a`）有 15 个冲突。未解决冲突导致的类型错误和测试失败只有通过运行流水线才能发现。"合并没有冲突" ≠ "它能正常工作。"

## 建议的构建顺序（依赖关系）

同步流水线的组件必须按此顺序构建：

```
Phase 1: Fetch & Detect + Impact Analysis
  ├── These are pure analysis tools, no dependencies on each other
  ├── Can be a single script or CI job
  └── Output: decision to proceed or skip

Phase 2: Merge Execute
  ├── Depends on Phase 1 (needs commit range info)
  ├── Core git operations + conflict resolution
  └── Output: sync branch with resolved merge

Phase 3: Build Verify
  ├── Depends on Phase 2 (needs merged code)
  ├── Run on sync branch
  ├── Internal dependency chain:
  │   bun install → typecheck → [tests | webgui | sdk] → [vscode | jetbrains]
  └── Output: pass/fail results

Phase 4: Regression Gate
  ├── Depends on Phase 3 (needs build results)
  ├── Decision logic + report generation
  └── Output: go/no-go + merge into ide-plugin
```

**实现优先级:** 首先构建阶段 3（构建验证）——这是机械复杂度最高的组件，即使在常规开发中（不仅仅是同步时）也很有用。然后是阶段 1+2（git 工作流），最后是阶段 4（报告/门控）。

## 自动化程度渐进

并非所有环节都需要在第一天就自动化。以下是推荐的渐进路径：

| 级别            | 内容                           | 方式                            | 优先级     |
| --------------- | ------------------------------ | ------------------------------- | ---------- |
| **手动 + 清单** | 按照文档化清单执行整个同步过程 | `.planning/` 中的 Markdown 文档 | 最先构建   |
| **脚本化**      | 构建验证链（阶段 3）           | 运行验证步骤的 Shell 脚本       | 第二个构建 |
| **半自动**      | 拉取 + 影响分析（阶段 1）      | 只报告不执行的脚本              | 第三个构建 |
| **CI 集成**     | 完整流水线作为 GitHub Action   | 手动或定时触发的工作流          | 最后构建   |

**理由:** 当前仓库已进行约 15 次上游合并，全部是手动完成的。瓶颈不在自动化——而在于拥有一个可靠、可重复的流程。一份被遵循的清单胜过一个半残的、被忽视的 CI 流水线。

## 可扩展性考虑

| 关注点       | 当前（手动，约每月同步） | 每周同步时                     | 每日同步时           |
| ------------ | ------------------------ | ------------------------------ | -------------------- |
| 冲突数量     | 5-15 个文件冲突          | 1-3 个文件冲突（更小的差异量） | 罕见（极小的差异量） |
| 解决时间     | 1-4 小时                 | 15-30 分钟                     | 数分钟               |
| 自动化需求   | 清单即可                 | 脚本必不可少                   | CI 为必需            |
| SDK 重新生成 | 每次同步                 | 每次同步                       | 仅在路由变更时       |
| 构建时间     | 约 5 分钟                | 约 5 分钟                      | 利用缓存，约 2 分钟  |

**关键洞察:** 同步频率越高，每次同步就越小越容易。架构应支持随时间推移逐步提高同步频率。

## 来源

- Git 历史分析：在实际仓库上运行 `git log`、`git diff`、`git merge-base`
- 过去的合并提交：`41ce0564a`（355 个提交的合并，附带详细的冲突文档）
- 构建流水线：`turbo.json`、`package.json`、`hosts/scripts/build_vscode.sh`
- CI 工作流：`.github/workflows/test.yml`、`.github/workflows/typecheck.yml`
- 项目上下文：`.planning/PROJECT.md`、`.planning/codebase/ARCHITECTURE.md`
- 集成映射：`.planning/codebase/INTEGRATIONS.md`

---

_架构研究：2026-04-12_
