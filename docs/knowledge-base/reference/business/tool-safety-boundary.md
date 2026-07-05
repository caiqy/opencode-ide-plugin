# 能力：工具外部目录安全边界

> **象限**：Reference（能力参考）
> **能力编号**：J3（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| 外部目录校验 | `packages/opencode/src/tool/external-directory.ts` |
| 调用方 | `packages/opencode/src/tool/read.ts`、`write.ts`、`edit.ts`、`apply_patch.ts`、`glob.ts`、`grep.ts`、`lsp.ts`、`repo_overview.ts` |

> 命名交叉核验（Step 5）：J3 对应 [upstream-compatibility](upstream-compatibility.md)。代码当前实现是“项目外路径触发 `external_directory` permission ask”，不是无条件拒绝。

## 意图

IDE 场景下工具经常接收来自 WebGUI、宿主菜单、拖拽和模型生成的路径。外部目录边界用于防止工具静默越过当前 project/worktree 根访问文件系统。

## 行为契约

- 校验入口是 `assertExternalDirectoryEffect(ctx, target, options)`；空 target 或显式 `bypass` 直接放行（`external-directory.ts` 第 16-24 行）。
- 边界以当前 `InstanceState.context` 的 `directory/worktree` 为准；`containsPath(full, ins)` 为真时放行（`external-directory.ts` 第 25-28 行）。
- 项目外路径会按 file/directory 计算父目录 glob，并调用 `ctx.ask({ permission: "external_directory" })`（`external-directory.ts` 第 29-45 行）。
- Windows 下会补齐 `/path` 形式缺失的 drive，并用 `AppFileSystem.normalizePath` 规范化（`external-directory.ts` 第 51-56 行）。
- 已确认调用该校验的工具包括 Write、Read、Edit、ApplyPatch、Glob、Grep、LSP、Repo overview（grep 结果：`write.ts` 第 44 行，`read.ts` 第 221 行，`edit.ts` 第 83 行，`apply_patch.ts` 第 74/143 行，`glob.ts` 第 49 行，`grep.ts` 第 62 行，`lsp.ts` 第 49 行，`repo_overview.ts` 第 185 行）。

## 边界与约束

- 当前实现不是路径 sandbox，也不自行解析所有 symlink/junction；是否允许项目外目录由 permission 层决定。
- 新增任何可读写文件系统的工具时，必须显式调用该校验或说明为什么 `bypass` 成立。
- `kind: "directory"` 用于目录型目标，避免只取父目录导致 permission pattern 偏移。

## 静态锚点

- 校验入口：`packages/opencode/src/tool/external-directory.ts:16`
- bypass 分支：`packages/opencode/src/tool/external-directory.ts:23`
- instance 边界读取：`packages/opencode/src/tool/external-directory.ts:25`
- project/worktree contains 判断：`packages/opencode/src/tool/external-directory.ts:27`
- external_directory permission ask：`packages/opencode/src/tool/external-directory.ts:36`
- Windows target 规范化：`packages/opencode/src/tool/external-directory.ts:51`
- Write 调用：`packages/opencode/src/tool/write.ts:44`
- Read 调用：`packages/opencode/src/tool/read.ts:221`
- Edit 调用：`packages/opencode/src/tool/edit.ts:83`
- ApplyPatch move path 调用：`packages/opencode/src/tool/apply_patch.ts:143`
- Glob/Grep 调用：`packages/opencode/src/tool/glob.ts:49`、`packages/opencode/src/tool/grep.ts:62`

## 维护检查

- 新增 Bash 子路径解析、批量文件工具或 generated file 工具时，先确认是否覆盖 `assertExternalDirectoryEffect`。
- 修改 `containsPath` 或 InstanceContext 时，要复查本能力，因为它直接改变项目边界。
- 修改 permission UI 时，确认 `external_directory` 的 patterns 与 always patterns 仍被展示/持久化为用户能理解的目录。

## 运行时待核验

- [ ] symlink/junction 指向 project 外时，`containsPath` 与实际文件操作的最终路径是否一致（`待运行时核验`：需要构造真实文件系统链接）。
- [ ] WebGUI permission UI 对 `external_directory` 的 allow/always pattern 是否符合用户预期（`待运行时核验`）。

## 相关

- 上游适配总览：[upstream-compatibility](upstream-compatibility.md)
- 工具渲染：[tool-rendering](tool-rendering.md)
