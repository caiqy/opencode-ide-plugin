# 能力：non-git 项目目录隔离

> **象限**：Reference（能力参考）
> **能力编号**：F2（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线能力；当前实现已修正 non-git global 串项目风险

## 代码真源

| 角色           | 文件                                             |
| -------------- | ------------------------------------------------ |
| 项目识别与迁移 | `packages/opencode/src/project/project.ts`       |
| ProjectID 规则 | `packages/opencode/src/project/schema.ts`        |
| 回归测试       | `packages/opencode/test/project/project.test.ts` |

> 命名交叉核验（Step 5）：`ProjectID.nonGit()` 在 `schema.ts` 第 24-26 行按目录 hash 生成 `local_` 前缀 id；`Project.fromDirectory()` 在 `project.ts` 第 217-223 行对无 `.git` 目录使用该 id。

## 意图

IDE 经常直接打开非 Git 临时目录。non-git 普通目录必须按实际目录隔离 project/session/workspace 状态，不能全部坍缩到 `ProjectID.global`，否则 workspace tabs、drafts、selection 会跨目录串数据。

## 行为契约

- non-git 目录使用目录派生 id：`project.ts` 第 217-223 行返回 `ProjectID.nonGit(directory)`，`worktree` 和 `sandbox` 都是当前目录。
- 目录归一化参与 id 生成：`schema.ts` 第 13-19 行 resolve、Windows 小写化并去尾部分隔符；第 24-26 行用 `Hash.fast(...)` 生成 `local_` id。
- 同目录重复打开得到同一 id：`project.test.ts` 第 194-207 行锁定。
- 不同 non-git 目录得到不同 id：`project.test.ts` 第 209-219 行锁定。
- legacy global session 运行时迁移：`project.ts` 第 163-175 行按 directory 更新旧 `ProjectID.global` session；第 356-360 行在 non-git 项目识别后执行迁移。
- 迁移行为测试在 `project.test.ts` 第 221-239 行，确认旧 global session 被改到目录派生 project id。

## 边界与约束

- Git 仓库仍优先按 Git identity 识别；non-git 规则只覆盖找不到 `.git` 的普通目录。
- workspace 级 scoped storage 的隔离边界依赖 project/workspace identity；状态 key 细节见 [scoped-storage](scoped-storage.md)。
- 修改 project identity、路径归一化、session list 或 global fallback 时，必须跑 `packages/opencode/test/project/project.test.ts`。

## 维护检查

- 改 `ProjectID.nonGit()` 前先确认 Windows 大小写归一化仍稳定。
- 改尾部分隔符处理时确认根目录不会被错误裁剪。
- 改 Git discovery 时确认无 `.git` 分支仍在 `project.ts` 第 217-223 行提前返回 non-git id。
- 改 session 查询或迁移时确认 legacy global session 不会留在 `ProjectID.global`。
- 改 workspace storage 作用域时同步检查 tabs/drafts/selection 的跨目录隔离。
- 改测试 fixture 时保留同目录、不同目录、legacy migration 三类断言。
- 改上游同步逻辑时不要把 git failure fallback 扩大到普通 non-git 目录。
- 改 project 表 upsert 时确认 `ProjectID.isNonGit(result.id)` 后仍执行迁移。

## 已知漂移

- [scoped-storage](scoped-storage.md) 与 [upstream-compatibility](upstream-compatibility.md) 对 non-git 规则描述与当前代码一致；本文只补充精确行号锚点。

## 运行时待核验

- [ ] 在真实 VSCode/JetBrains 中打开两个不同 non-git 目录，确认 tabs/drafts/selection 不共享（`待运行时核验`：代码和测试覆盖 project id，宿主 workspace storage 组合仍需实机确认）。

## 相关

- scoped storage：[scoped-storage](scoped-storage.md)
- 状态持久化：[scoped-storage](scoped-storage.md)
- 上游适配边界：[upstream-compatibility](upstream-compatibility.md)
