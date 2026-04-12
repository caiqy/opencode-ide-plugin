# Roadmap: OpenCode IDE Plugin — 上游同步工作流

## Overview

本路线图为一个深度分叉的 fork（领先 384 个 commit，新增 10.5 万行代码）构建可靠的上游同步流水线。演进路径遵循自动化阶梯：建立安全、有文档的合并流程 → 通过自动化验证证明合并未破坏任何内容 → 自动化冲突检测和 SDK/补丁检查 → 增加合并前影响分析以辅助决策。每个阶段都交付一个完整且独立可用的能力。

## Phases

**阶段编号说明：**

- 整数阶段（1, 2, 3）：已规划的里程碑工作
- 小数阶段（2.1, 2.2）：紧急插入项（标记为 INSERTED）

小数阶段按数值顺序排列在相邻整数阶段之间。

- [ ] **Phase 1: Merge Foundation** - 在隔离的 sync 分支上建立安全、有文档、可重复的上游合并流程
- [ ] **Phase 2: Build Verification** - 自动化的合并后验证流水线，证明没有任何内容被破坏
- [ ] **Phase 3: Conflict Detection** - 自动化冲突报告、SDK 重新生成检查和补丁兼容性验证
- [ ] **Phase 4: Impact Analysis** - 合并前变更分类、试运行预览、变更日志提取和同步追踪

## Phase Details

### Phase 1: Merge Foundation

**Goal**: 开发者可以在隔离分支上安全地合并上游变更，具备文档化的流程和清晰的回滚路径
**Depends on**: Nothing (first phase)
**Requirements**: SYNC-01, SYNC-05, SYNC-06
**Success Criteria** (以下条件必须为 TRUE):

1. 开发者可以创建 sync 分支、拉取上游并合并——不影响主开发分支
2. 开发者可以在 1 分钟内中止或回滚失败的合并，恢复到干净状态
3. 存在一份书面检查单，其他开发者可以按照它完成完整的上游同步
4. 该检查单已通过至少一次端到端的实际上游合并验证
   **Plans**: 2 plans

Plans:

- [x] 01-01-PLAN.md — Configure git rerere and write upstream merge checklist document
- [ ] 01-02-PLAN.md — Execute real end-to-end upstream merge to validate checklist

### Phase 2: Build Verification

**Goal**: 每次合并后，一条命令即可验证所有组件的类型安全、构建和测试——并输出结构化的通过/失败报告
**Depends on**: Phase 1
**Requirements**: BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-05, BUILD-06
**Success Criteria** (以下条件必须为 TRUE):

1. 运行验证脚本生成结构化报告，显示每个组件（typecheck、webgui、vscode、jetbrains、tests）的通过/失败状态
2. 任何包中的类型错误会导致该组件在验证中报告失败
3. WebGUI vite build、VSCode pnpm compile 和 JetBrains gradle build 在一次运行中全部验证
4. 测试套件（webgui 的 vitest、vscode 的 mocha）运行并在报告中显示结果
5. 验证脚本可以独立于同步工作流运行（对日常开发同样有用）
   **Plans**: TBD

Plans:

- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

### Phase 3: Conflict Detection

**Goal**: 合并后自动按风险区域检测并报告冲突，标记 SDK 重新生成需求，验证依赖补丁兼容性
**Depends on**: Phase 1
**Requirements**: SYNC-02, SYNC-03, SYNC-04
**Success Criteria** (以下条件必须为 TRUE):

1. 合并后生成冲突报告，将文件分类为 downstream-only / upstream-only / shared 并标注风险等级
2. 当上游修改 server routes 或 OpenAPI spec 时，报告标记需要重新生成 SDK
3. 当上游升级 4 个已打补丁依赖的版本时，报告标记哪些补丁需要重新验证
   **Plans**: TBD

Plans:

- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Impact Analysis

**Goal**: 在提交合并之前，开发者可以预览预期冲突、理解上游变更，并追踪同步健康度
**Depends on**: Phase 3
**Requirements**: IMPACT-01, IMPACT-02, IMPACT-03, IMPACT-04
**Success Criteria** (以下条件必须为 TRUE):

1. 合并发生前，上游变更被分类为安全区域（upstream-only 目录）和风险区域（shared 目录）
2. 开发者可以执行试运行，查看哪些文件会冲突——而不修改工作树
3. 从上游 commit 中提取变更日志，按类别分组（feat/fix/refactor/breaking）
4. 每次同步记录元数据（日期、吸收的 commit 数、遇到的冲突数），支持合并频率追踪
   **Plans**: TBD

Plans:

- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

## Progress

**执行顺序：**
阶段按数值顺序执行：1 → 2 → 3 → 4

| Phase                 | Plans Complete | Status      | Completed |
| --------------------- | -------------- | ----------- | --------- |
| 1. Merge Foundation   | 0/2            | Planned     | -         |
| 2. Build Verification | 0/3            | Not started | -         |
| 3. Conflict Detection | 0/3            | Not started | -         |
| 4. Impact Analysis    | 0/3            | Not started | -         |
