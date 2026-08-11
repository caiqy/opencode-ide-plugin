---
comet_change: merge-upstream-tags
role: technical-design
canonical_spec: openspec
---

# 上游逐 Tag 合并技术设计

## 1. 上下文与约束

能力和验收要求以 `docs/openspec/changes/merge-upstream-tags/specs/upstream-release-integration/spec.md` 为事实源。本设计细化执行方式，不复制或替代该规范。

当前 `ide-plugin` HEAD 为 `baf0674fd1`，最高已集成 tag 为 `v1.18.6`。历史上的 `v1.18.0` 至 `v1.18.6` 都使用独立双父 merge commit；`v1.18.5` 后曾增加一个聚焦修复提交。当前已发现 `v1.18.7` 至 `v1.18.16`，相邻 release tag 彼此不是祖先。已知上游范围与下游 HEAD 有 28 个重叠文件，主要涉及 Provider、Session、Workspace routing、TUI 和 SDK/OpenAPI。

本次采用单一隔离分支串行执行，不新增合并编排脚本。显式命令和持续更新的验证报告已经足够；只有后续证明重复命令本身造成错误时，才考虑脚本化。

## 2. 不变量

整个执行过程必须保持以下不变量：

1. 只接受 `opencode` remote 上的稳定 release tag，不用 `dev` 或任意未标记 commit 替代。
2. 每个 tag 有独立 merge commit，第一父是前一轮已验证状态，第二父精确等于官方 tag commit。
3. 当前基线和每个 tag 的适用默认门禁都必须零失败，未解决失败（包括超时）阻止推进；不接受环境例外、skip/todo、增加 timeout 或忽略失败作为通过条件。
4. 不通过整文件 `ours`/`theirs`、手工拼 lockfile 或直接编辑 generated 文件解决冲突。
5. IDE 插件下游行为默认受保护；等价替换只有在用户明确选择后发生。
6. 每轮结束时不存在活动 merge、冲突标记、意外 generated 漂移或未归因工作区变化。

## 3. 执行状态机

```text
选择隔离分支
  ↓
发现并精确 fetch 官方 release tags
  ↓
建立已知队列影响闭包和验证矩阵
  ↓
当前 HEAD 基线修复到零失败
  ↓
取队列首 tag
  ↓
git merge --no-ff --no-commit {tag}
  ↓
语义解冲突 → 生成 lock/SDK → merge commit
  ↓
运行当前 tag 完整默认门禁
  ├─ 失败：discovery 聚焦根因 → 修复提交 → 单项通过后重跑一次完整门禁
  └─ 通过：验证父链、生成物和工作区
  ↓
处理下一个 tag
  ↓
队列清空后重新查询官方远端
  ├─ 有新增：精确 fetch 并追加队列
  └─ 无新增：最终跨包验证和 thorough 审查
```

状态机严格串行。任何时刻只允许一个 tag 处于活动状态，避免测试结果、冲突和修复提交跨 tag 混淆。

## 4. Release 前沿发现

### 4.1 发现与获取

使用 `git ls-remote --tags --refs opencode` 只读发现远端稳定 semver tag。对高于已集成前沿的 tag 按版本升序排队，并使用精确 tag fetch 获取每个对象，避免抓取本地冲突的 `latest` tag。

精确 fetch 后必须比较本地 tag commit 与 `ls-remote` 返回 SHA。轻量 tag 直接比较 commit；若未来出现 annotated tag，则同时解析 tag object 和 peeled commit，最终以 merge 使用的 commit 为准。

### 4.2 动态前沿

完成当前队列最高 tag 的验证后重新发现远端。出现新 tag 时先计算新增影响闭包；若包含此前未进入验证矩阵的 owning package，则在 merge 前补齐这些 package 的零失败基线，再追加并继续。一次查询没有新增时视为发布前沿稳定。查询只发生在 tag 边界，不改变活动 tag 的验收范围。

## 5. 合并前零失败基线

在第一个 tag 前，根据当前已知队列的总 diff 建立验证影响闭包。它包含直接变更 package，以及 Protocol、SDK、Server 和 UI 变化会影响的 IDE 下游消费者。

基线矩阵必须在未合并 `v1.18.7` 的当前代码上零失败。发现失败时：

1. 按测试名和完整错误签名定位根因。
2. 区分产品缺陷、测试缺陷、生成物漂移和环境缺失。
3. 在当前 change 内创建范围明确的修复提交。
4. 使用 discovery 聚焦根因和修复；全部相关单项通过后运行一次完整基线矩阵。只有该完整矩阵仍失败时才返回 discovery，不重复无新增信息的全量循环。

不接受 2026-07-28 历史残余清单，也不建立允许失败列表。同一代码和环境下不得仅靠重复执行获取偶然通过；环境前置条件修正后仍须达到零失败，不得以环境例外、skip/todo、增加 timeout 或忽略失败通过。

## 6. 单个 Tag 事务

### 6.1 开始条件

- 前一轮完整门禁通过。
- 工作区除已归因的 Comet/报告更新外无未提交实现改动。
- 没有活动 merge/rebase/cherry-pick。
- 当前 tag 已精确 fetch，远端与本地 SHA 一致。

### 6.2 Merge 与提交

记录 tag 前的 `base`，执行 `git merge --no-ff --no-commit {tag}`。解决冲突后先运行 `git diff --check`、冲突标记检查和必要生成命令，再创建：

```text
chore(opencode): merge upstream {tag}
```

提交后立即验证该 commit 恰有两个父提交，第一父等于 `base`，第二父等于 tag commit。若不满足，不进入测试。

### 6.3 验证与修复

以第一父到当前 HEAD 的实际 diff 计算本轮影响闭包并运行完整矩阵。失败时停留在当前 tag，按系统化调试定位并创建聚焦修复提交。全部相关单项通过后运行一次当前 tag 的完整矩阵；只有该矩阵仍失败时才返回 discovery，全部通过后才关闭该事务。

## 7. 冲突解决协议

| 类别 | 处理规则 |
| --- | --- |
| 上游 workspace package 版本 | 采用当前官方 tag 版本 |
| 下游独有宿主/发布版本 | 保持下游版本体系，不随上游 tag 改写 |
| `bun.lock` | 先解决 manifest，再使用 vfox 管理的 Bun 重建 |
| Client/SDK generated | 先解决 Protocol/HttpApi 源，再运行仓库生成命令 |
| 普通语义冲突 | 阅读双方提交意图、调用路径和测试，逐块合并 |
| delete/modify 或 rename 冲突 | 先确认所有权和调用方，再决定保留、迁移或删除 |
| 上游/下游功能重叠 | 进入等价替换决策协议 |

不得使用整文件 `git checkout --ours/--theirs` 处理含语义代码的文件。版本文件也必须逐文件确认所有权，避免把下游发布版本误改成上游版本。

## 8. 等价替换决策协议

发现上游可能覆盖下游能力时，先形成一份短证据：

- 两条实现的入口、调用路径和输出行为。
- 下游额外场景及对应测试是否被上游覆盖。
- 删除下游实现会减少哪些维护成本。
- 未覆盖差异、兼容风险和推荐选择。

随后暂停该冲突并交用户选择“采用上游替换”或“保留下游实现”。无法证明全部下游场景等价时，推荐保留下游；不得把“代码相似”作为等价证据。

## 9. 生成物与依赖

公共 Protocol 或 Server `HttpApi` 变化时，从 `packages/client` 运行 `bun run generate`。需要更新 legacy JavaScript SDK 时运行 `packages/sdk/js/script/build.ts` 对应的仓库构建入口。禁止直接编辑 `src/generated`、`src/generated-effect` 或 SDK 生成输出。

`bun.lock` 只在 manifest 冲突解决后由 vfox 管理的 Bun 更新。命令结束后检查 lockfile 与 manifest 一致，并确认没有与当前 tag 无关的 package 版本漂移。

## 10. 验证矩阵

### 10.1 影响闭包

每轮从实际 diff 提取直接 owning packages，再加入以下下游依赖：

- Protocol/HttpApi/SDK → `packages/client`、`packages/sdk/js`、`packages/opencode`、WebGUI、VS Code 宿主。
- App/UI/Session UI → `packages/app`、`packages/ui`、`packages/session-ui`、Desktop。
- Server/Session/Provider 行为 → `packages/opencode` 及使用对应 SDK 行为的 WebGUI。
- 根 manifest、共享 TypeScript 配置或 lockfile → 所有直接消费该共享配置且位于本轮总影响范围的 package。

### 10.2 默认门禁

对影响闭包中的每个 package，从该 package 目录运行存在的默认脚本：

- `test`
- `typecheck`，必须使用 `bun typecheck`，不直接运行 `tsc`
- `build`

当前 Windows Classic change 中，合并前 baseline、每个影响闭包含 `@opencode-ai/core` 的 tag 验证和最终验证，均从 `packages/core` 运行完整 pinned Core gate：

```text
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --only-failures --max-concurrency=1
```

该命令输出必须为 `fail=0`、`error=0`，且 `skip`/`todo` 不得较采用此策略前同一完整套件的已记录计数增加。`--max-concurrency=1` 只改变本 change 验证矩阵内 Core gate 的调度并发：不修改 `packages/core/package.json` test script，不影响其他开发者或 CI，不缩减测试文件或测试用例，也不改变其他 package gate。默认 `max-concurrency=20` 的 Core 全量套件曾在不同 Git/npm 资源型测试超时，而相同 focused tests 通过；已有持续扩大 timeout 的趋势，因此采用串行调度，而不是以 timeout 或环境例外掩盖失败。

条件门禁：

- Client 生成变化：`packages/client` 的 `check:generated`。
- HttpApi/路由变化：`packages/opencode` 的 `test:httpapi`。
- SDK 变化：JavaScript SDK 的 test/typecheck/build。
- IDE 消费面变化：WebGUI 和 VS Code 宿主的默认 test/build。

不执行 App Playwright E2E、稳定性/benchmark、Desktop 平台打包等非默认环境依赖脚本。测试不得从仓库根运行。

### 10.3 证据

持续更新 `docs/superpowers/reports/2026-08-10-merge-upstream-tags.md`，每个 tag 记录：

- tag、远端 SHA、merge commit 和可选修复 commit。
- 影响闭包和实际命令。
- 每个命令的退出码、通过/失败数量和关键失败签名。
- Core gate 的完整 pinned 命令、`fail`/`error`/`skip`/`todo` 计数，以及适用阶段（baseline、tag 或最终验证）。
- 冲突文件、生成命令和等价替换决策。

报告保留高信号摘要，不复制完整终端日志。

## 11. 失败与恢复

- **活动 merge 冲突无法安全处理**：保留现场调查；确认 tag 或边界错误时才 `git merge --abort`。
- **测试或 build 失败**：不推进 tag；定位根因、聚焦修复，全部相关单项通过后运行一次完整矩阵。只有完整矩阵仍失败时才返回 discovery。
- **环境前置条件缺失**：修复可验证的环境前置条件后重新运行；仍须零失败，不能把环境失败记为通过，也不能以 skip/todo、增加 timeout 或忽略失败替代。
- **生成物漂移**：回到源 Protocol/HttpApi/manifest 修复并重新生成。
- **已提交 merge 需要撤销**：不重写历史；仅在用户明确确认后使用 merge revert。
- **执行中断**：从报告、tasks、当前父链和工作区状态恢复，先确认活动 tag 再继续。

## 12. 最终验证

发布前沿稳定后执行：

1. 审计所有新 merge commit 的第一父链、第二父 tag 和提交信息。
2. 对整个执行期间影响闭包运行最终默认门禁。
3. 运行 Client/SDK generated 一致性和 HttpApi 条件门禁。
4. 检查冲突标记、意外版本漂移、未归因文件和工作区状态。
5. 进行 thorough 独立代码审查，处理 Critical/Important 发现后重新验证。

完成条件是：基线零失败、所有发现 tag 已集成且每 tag 门禁零失败、最后一次远端查询无新增、父链和生成物审计通过、没有未处理的等价替换或审查阻塞项。

## 13. 回滚边界

隔离分支保留原 `ide-plugin` 分支不变。活动 merge 可在确认后 abort；已提交历史不使用 reset、rebase 或强制改写。若某个已提交 tag 最终不能接受，则由用户决定 merge revert 或停止该 change。
