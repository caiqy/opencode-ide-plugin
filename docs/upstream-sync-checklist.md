# 上游同步检查单 (Upstream Sync Checklist)

## 概述

这份检查单用于指导开发者在隔离的 `sync/YYYYMMDD` 分支上，将上游 `opencode/dev` 安全合并到 `ide-plugin`，并在每个关键步骤保留清晰的回滚路径。

## 前置条件

- [ ] 工作树干净：`git status`
- [ ] 当前位于 `ide-plugin` 分支：`git checkout ide-plugin`
- [ ] 远程配置正确：`opencode` → `anomalyco/opencode.git`，`origin` → `caiqy/opencode-ide-plugin.git`
- [ ] `git rerere` 已启用：`git config --get rerere.enabled`

## 第 1 步：准备 (Preparation)

- [ ] 确认工作树干净：`git status`
- [ ] 切回主开发分支：`git checkout ide-plugin`
- [ ] 拉取上游最新提交：`git fetch opencode`
- [ ] 记录上游提交号：`UPSTREAM_SHA=$(git rev-parse --short opencode/dev)`

**回滚路径：** 此步骤不修改提交图；如有未提交改动，先处理干净再继续。

## 第 2 步：冲突预览 (Dry-Run Conflict Preview)

- [ ] 执行 dry-run：`git merge-tree --write-tree --name-only ide-plugin opencode/dev`
- [ ] 解释结果：退出码 `0` 表示无冲突，退出码 `1` 表示存在冲突文件
- [ ] 结合下方“冲突区域参考”统计冲突数量并评估风险
- [ ] 决定是否继续本次同步

**回滚路径：** 此步骤不修改任何内容，无需回滚。

## 第 3 步：创建 Sync 分支 (Create Sync Branch)

- [ ] 创建隔离分支：`git checkout -b sync/YYYYMMDD`
- [ ] 确认当前分支：`git branch --show-current`

**回滚路径：** `git checkout ide-plugin && git branch -D sync/YYYYMMDD`

## 第 4 步：执行合并 (Perform Merge)

- [ ] 执行合并：`git merge opencode/dev --no-edit`
- [ ] 若无冲突，直接进入第 6 步
- [ ] 若有冲突，进入第 5 步

**回滚路径：** `git merge --abort`。如果已经提交了错误结果，则执行 `git checkout ide-plugin && git branch -D sync/YYYYMMDD` 后重来。

## 第 5 步：冲突解决 (Conflict Resolution)

遵循 D-01：检查单提供框架，不预先锁定所有具体取舍；真正执行时按实际冲突内容决定，同时尽量保留上游与下游逻辑。

### 5a. bun.lock（机械解决，每次必冲突）

- [ ] 接受上游 lockfile 作为基础：`git checkout --theirs bun.lock`
- [ ] 重新生成依赖锁：`bun install`
- [ ] 暂存 lockfile：`git add bun.lock`

### 5b. 低风险文件

- `packages/app/src/pages/session/use-session-commands.tsx` — 采用上游版本（SolidJS TUI 代码）
- `packages/opencode/test/session/llm.test.ts` — 对齐测试夹具

### 5c. 中风险文件

- `packages/opencode/package.json` — 手工合并，检查版本变化与 patch 依赖
- `packages/opencode/src/session/compaction.ts` — 手工合并，保留双方 session 逻辑
- `packages/opencode/src/session/message-v2.ts` — 手工合并，核对消息格式变化
- `packages/opencode/src/skill/index.ts` — 手工合并，保留下游 skill permission overlay

### 5d. 高风险文件 (⚠️ 需要特别注意)

- `packages/opencode/src/config/config.ts` — **必须保留下游 config overlay（tools、patch）**
- `packages/opencode/src/mcp/index.ts` — **必须保留下游 setEnabled / setToolEnabled**
- `packages/opencode/src/provider/provider.ts` — **必须保留下游 normalizeAnthropic SSE 补丁**
- `packages/opencode/src/server/instance/index.ts` — **新的冲突区，需逐段比对实例路由逻辑**
- `packages/opencode/src/server/server.ts` — **关键：必须保留 WebGUI 的 `webgui/server/app.ts` 导入与 `/app` 挂载点**

### 5e. 完成冲突解决

- [ ] 暂存所有已解决文件：`git add <all-resolved-files>`
- [ ] 继续合并：`git merge --continue`

**回滚路径：** 在合并未完成前，任何时刻都可执行 `git merge --abort`。

## 第 6 步：补丁验证 (Patch Verification)

- [ ] 检查 `bun install` 输出中是否出现 patch 警告
- [ ] 显式确认以下 4 个 patch 仍然有效：
  - `@ai-sdk/anthropic@3.0.64`
  - `@ai-sdk/provider-utils@4.0.21`
  - `@standard-community/standard-openapi@0.2.9`
  - `solid-js@1.9.10`
- [ ] 如果 patch 失效，先确认是否是上游升级了依赖版本，再更新补丁

**回滚路径：** 若 patch 无法恢复，放弃当前同步：`git merge --abort`；若已完成合并提交，则删除 `sync/YYYYMMDD` 并重新准备。

## 第 7 步：快速验证 (Quick Verification)

- [ ] 安装并对齐依赖：`bun install`
- [ ] 类型检查：`cd packages/opencode && bun typecheck`
- [ ] 确认 `packages/opencode/src/server/server.ts` 仍然引用 `webgui/server/app.ts`
- [ ] 确认 `/app` 挂载仍然存在，避免 WebGUI 被上游改动静默移除
- [ ] 记录本轮同步是否出现新的高风险冲突区

**回滚路径：** 若验证失败且尚未将 sync 分支集成回 `ide-plugin`，执行 `git checkout ide-plugin && git branch -D sync/YYYYMMDD` 重新开始。

## 第 8 步：集成到主分支 (Integrate to Main Branch)

- [ ] 切回主开发分支：`git checkout ide-plugin`
- [ ] 合并 sync 分支：`git merge sync/YYYYMMDD --no-ff -m "sync: absorb upstream opencode/dev (N commits)"`
- [ ] 使用以下命令计算 `N`：`git rev-list --count $(git merge-base ide-plugin opencode/dev)..opencode/dev`

**回滚路径：** 若尚未推送，可执行 `git reset --hard HEAD~1` 撤销错误集成提交；更稳妥的方式是删除失败的 `sync/YYYYMMDD` 后重新走检查单。

## 第 9 步：标记同步点 (Tag Sync Point)

- [ ] 创建同步标签：`git tag sync/upstream-$(git rev-parse --short opencode/dev)`

**回滚路径：** 如果打错标签：`git tag -d sync/upstream-$(git rev-parse --short opencode/dev)`

## 第 10 步：清理 (Cleanup)

- [ ] 删除 sync 分支：`git branch -d sync/YYYYMMDD`
- [ ] 检查是否仍有遗留 sync 分支：`git branch | grep sync/`

**回滚路径：** 此步骤本身是清理动作；如需保留现场用于排查，可暂时跳过删除分支。

## 冲突区域参考 (Conflict Zone Reference)

| File                                                      | Risk             | Strategy                                   |
| --------------------------------------------------------- | ---------------- | ------------------------------------------ |
| `bun.lock`                                                | LOW (mechanical) | 接受上游后执行 `bun install` 重新生成      |
| `packages/app/src/pages/session/use-session-commands.tsx` | LOW              | 采用上游（SolidJS TUI）                    |
| `packages/opencode/package.json`                          | MEDIUM           | 手工合并并检查 patch 依赖                  |
| `packages/opencode/src/config/config.ts`                  | **HIGH**         | 手工合并，保留 config overlay              |
| `packages/opencode/src/mcp/index.ts`                      | **HIGH**         | 手工合并，保留 setEnabled / setToolEnabled |
| `packages/opencode/src/provider/provider.ts`              | **HIGH**         | 手工合并，保留 normalizeAnthropic SSE      |
| `packages/opencode/src/server/instance/index.ts`          | **HIGH**         | 手工比对新的冲突区                         |
| `packages/opencode/src/server/server.ts`                  | **HIGH**         | 手工合并，确保保留 WebGUI `/app` 挂载      |
| `packages/opencode/src/session/compaction.ts`             | MEDIUM           | 手工合并 session compaction 逻辑           |
| `packages/opencode/src/session/message-v2.ts`             | MEDIUM           | 手工合并消息格式变更                       |
| `packages/opencode/src/skill/index.ts`                    | MEDIUM           | 手工合并 skill permission overlay          |
| `packages/opencode/test/session/llm.test.ts`              | LOW              | 对齐测试夹具                               |

## 常见陷阱 (Common Pitfalls)

1. **不要手工解决 bun.lock 冲突**：始终 `git checkout --theirs bun.lock` 后再执行 `bun install`。
2. **不要忘记验证 4 个 patch**：`@ai-sdk/anthropic`、`@ai-sdk/provider-utils`、`@standard-community/standard-openapi`、`solid-js`。
3. **不要漏查 server.ts 挂载点**：每次合并后都要确认 `webgui/server/app.ts` 导入和 `/app` 路由仍在。
4. **不要在验证前跳过 bun install**：依赖状态不一致会导致假阳性。
5. **不要遗留 sync 分支**：合并完成后删除 `sync/YYYYMMDD`，避免后续混淆。
6. **不要忽略 Effect.js 迁移导致的类型错误**：合并后立刻运行 `bun typecheck`。

## 建议合并频率 (Recommended Merge Cadence)

建议每周至少同步一次。间隔越长，冲突范围越大，人工判断成本越高。
