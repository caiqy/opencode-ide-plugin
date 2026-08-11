## Context

当前 `ide-plugin` HEAD 为 `baf0674fd1`，`v1.18.6` 已是其祖先。历史上 `v1.18.0` 至 `v1.18.6` 均以独立双父 merge commit 集成，版本文件和 `bun.lock` 每次处理，`v1.18.5` 后曾追加一个聚焦构建修复提交。

官方 remote 为 `opencode=https://github.com/anomalyco/opencode.git`。当前已发现 `v1.18.7` 至 `v1.18.16`；相邻 release tag 彼此不是祖先，因此不能把“逐 tag”理解为简单快进。已知上游范围与下游 HEAD 有 28 个重叠文件，集中在 Provider、Session、Workspace routing、TUI 和 SDK/OpenAPI。

## Goals / Non-Goals

**Goals:**

- 保持每个 release tag 的 Git 边界和失败归因能力。
- 在吸收上游实现时保护 IDE 插件的下游行为。
- 使每个 tag 的生成物和完整验证结果可追溯。
- 在同一执行流程内追踪稳定的最新 release 前沿。

**Non-Goals:**

- 不同步上游 `dev` 分支或非 release commit。
- 不把多个 tag 压缩为一个 merge 或 squash commit。
- 不借机重构无关代码，也不发布 VSIX/其他分发产物。
- 不在本 change 中修复 Comet/CodeGraph 工具自身问题。

## Decisions

### 1. 逐 tag 建立双父 merge commit

从当前已集成的最高 tag 开始，按版本升序合并下一 tag。每个 merge commit 的第一父提交是完成前一 tag 验证后的下游状态，第二父提交精确指向官方 tag，提交信息沿用 `chore(opencode): merge upstream {tag}`。

选择该方案是因为它延续现有历史，并允许通过父提交和 tag 精确审计。备选方案“只合并最新 tag”会丢失中间发布边界；“cherry-pick release 内容”不能忠实保留官方 tag 身份。

### 2. 冲突按所有权和行为处理

- 上游拥有的 workspace package 版本随当前 tag 更新；下游独有的宿主和发布版本保持独立。
- `bun.lock` 通过 vfox 管理的 Bun 和仓库安装流程重新生成，不手工拼接冲突块。
- 纯文本冲突以双方意图为基础做语义三方合并，不按 `ours`/`theirs` 批量覆盖。
- IDE bridge、WebGUI、远程 Workspace 和下游扩展行为默认保留。
- 遇到可能由上游等价替换的下游实现时，先给出调用路径、测试覆盖和差异分析，再由用户选择；决定前不删除下游实现。

备选方案“始终采用上游”会静默破坏插件能力；“始终保留下游”会积累已被上游覆盖的维护负担。

### 3. tag 内修复与生成物保持聚焦

冲突解决属于该 tag 的 merge commit。若 merge commit 后的完整验证发现回归，则在下一个 tag 前创建以受影响区域命名的聚焦修复提交，并重新运行当前 tag 的完整验证。

公共 Protocol 或 Server `HttpApi` 变化时，从 `packages/client` 运行 `bun run generate`；需要更新 legacy JavaScript SDK 时运行仓库规定的 `packages/sdk/js/script/build.ts`。生成目录只由命令更新。

### 4. 每个 tag 使用完整 owning-package 门禁

每次 merge 后根据第一父提交到当前 HEAD 的变更确定受影响 owning packages。对每个受影响 package 执行其完整测试、`bun typecheck` 和适用 build；测试和 typecheck 均从 package 目录运行，不从仓库根运行测试。

在当前 Windows Classic change 中，影响闭包含 `@opencode-ai/core` 时，合并前 baseline、每个包含 Core 的 tag 验证和最终验证都从 `packages/core` 运行 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --only-failures --max-concurrency=1`。影响闭包含 `@opencode-ai/sdk-next` 时，对应阶段都从 `packages/sdk-next` 运行 `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --timeout 5000 --max-concurrency=1`。这些完整套件的输出必须为 `fail=0`、`error=0`，且 `skip`/`todo` 不得较采用该策略前同一完整套件的已记录计数增加。

`--max-concurrency=1` 只改变本 change 验证矩阵内 Core 和 SDK-next gate 的调度并发，不修改对应 `package.json` test script，不影响其他开发者或 CI，不缩减测试文件或测试用例，也不改变其他 package gate。任何超时或其他失败都停留在当前 tag；不接受环境例外、skip/todo、增加 timeout 或忽略失败。使用 discovery 聚焦根因和修复，全部相关单项通过后运行一次完整适用矩阵；不进行无新增信息的全量循环，完整矩阵仍失败时才返回 discovery。

选择该方案是用户明确要求的最强归因策略。备选的聚焦验证或仅最终验证耗时更低，但会扩大故障定位范围。

### 5. 在发布边界查询动态前沿

先处理已发现到 `v1.18.16` 的 tag。完成当前最高 tag 的验证后，重新查询官方远端 tag；发现更高版本则追加到队列，未发现则结束合并循环并运行最终跨包验证和审查。

查询只发生在 tag 边界，避免正在处理一个 tag 时改变其验收范围。

## Risks / Trade-offs

- **[非线性 release tag 导致重复冲突或内容回摆]** → 每次验证第二父提交、检查相对第一父提交的实际 diff，并禁止批量 `ours`/`theirs`。
- **[逐 tag 完整验证耗时和 Windows 资源占用高]** → 默认 `max-concurrency=20` 的 Core 全量套件曾在不同 Git/npm 资源型测试超时；SDK-next 两个文件各自通过，但默认跨文件并发时超过既有 5 秒预算。因此本 Windows Classic change 对这两个 gate 使用 pinned 串行调度。失败不通过环境例外、skip/todo、增加 timeout 或忽略失败掩盖。
- **[动态追踪最新版本使范围增长]** → 只在完成当前前沿后查询；一次查询无新增即收敛。
- **[上游与下游实现表面相似但语义不同]** → 等价替换必须有代码路径和测试证据，并由用户明确选择。
- **[Protocol/SDK 生成物被错误手改]** → 仅执行仓库生成命令并检查生成差异。
- **[工作区已有 Comet 管理文件]** → Build 阶段使用用户确认的 branch 或 worktree 隔离方式，不归因或覆盖既有未提交改动。

## Migration Plan

1. 在 Build 阶段确认隔离方式并从当前 `ide-plugin` HEAD 建立执行分支或 worktree。
2. 查询并固定当前 tag 队列，从 `v1.18.7` 开始逐个 merge、解决冲突、生成产物并完整验证。
3. 每个 tag 通过后记录 merge/修复提交和验证结果，再进入下一 tag。
4. 到达当前前沿后重新查询并追加新 tag，直到一次查询无新增。
5. 运行最终跨包验证、审查 Git 父链和工作区状态。

活动 merge 尚未提交时使用 `git merge --abort` 回滚。已提交的 tag 如需撤销，使用保留历史的 merge revert，并在执行前由用户明确确认；不重写已建立的逐 tag 历史。
