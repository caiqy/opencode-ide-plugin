# Outcome

从 `v1.18.7` 起按版本顺序逐个集成 `anomalyco/opencode` 的官方稳定 release tag，在每个发布边界保留下游 IDE 插件行为、可审计 Git 历史和严格零失败验证，并持续追踪到一次远端查询确认没有更高稳定 tag。

# Scope

- 在首个 tag 前将已知队列影响闭包的当前 HEAD 默认 package 门禁修至零失败。
- 逐个处理 `v1.18.7` 至当前已知前沿 `v1.18.16`，之后动态查询并追加更高稳定 release tag。
- 逐 tag 解决语义冲突、刷新必要生成物、执行 owning-package test/typecheck/build，并在通过后才推进。
- 最终审计 merge 父链、版本、manifest、lockfile、生成物和跨包验证证据。

# Non-goals

- 不合并上游 `dev`、非 release commit、prerelease 或不稳定 tag。
- 不 squash 多个 tag，不重写已建立的逐 tag 历史。
- 不借机进行无关重构、产品功能开发、App E2E、benchmark、Desktop 平台打包或 VSIX 发布。
- 不在本 change 修复 Comet、CodeGraph 或 SDD 工具问题。

# Acceptance examples

- A1: 合并 `v1.18.7` 前，已知队列影响闭包内全部适用默认 test、typecheck、build 和生成物检查为零失败，且 skip/todo 不高于记录的基线。
- A2: 每个稳定 tag 都有且仅有一个独立双父 merge commit；第一父为前一已验证下游状态，第二父精确匹配官方 tag peeled commit，subject 为 `chore(opencode): merge upstream <tag>`。
- A3: 每个 tag 的冲突、版本、manifest、lockfile 和生成物完成语义处理后，全部受影响 owning package 门禁通过；任何失败阻止下一个 tag。
- A4: 完成当前最高已验证 tag 后重新查询官方远端；发现更高稳定 tag 就按顺序追加，直到一次查询无新增才结束合并循环。
- A5: IDE bridge、WebGUI、远程 Workspace 和下游扩展行为保持；可能等价替换的上游实现只有在提交代码路径、测试证据、风险和建议并获得用户选择后才能删除下游实现。
- A6: 公共 Protocol 或 Server `HttpApi` 变化时，只通过仓库规定命令刷新 Client 和 legacy JavaScript SDK，并通过 generated 一致性、`test:httpapi`、WebGUI 与 VS Code 默认门禁。
- A7: 最终审计确认 tag 顺序、双父父链、版本、manifest、lockfile、生成物和适用跨包门禁全部一致且零失败，且没有夹带 allowlist 外的既有用户或工具升级改动。

# Constraints and invariants

- 批准基线为 `baf0674fd108ac43785cb4f4622c6f58e7c645f6`，change 分支为 `merge-upstream-tags`，目标分支为 `ide-plugin`。
- 官方 remote 为 `opencode=https://github.com/anomalyco/opencode.git`；只接受稳定语义版本 release tag。
- 使用 vfox 管理的 Bun `1.3.14` 和 Node.js `22.23.1`；测试与 `bun typecheck` 从 package 目录运行，不能从仓库根运行测试或直接调用 `tsc`。
- `bun.lock` 和宿主 lockfile 使用对应 package manager 重新生成，不能手工编辑；`src/generated` 和 `src/generated-effect` 不能直接编辑。
- 根 `.gitignore`、`.agents/`、`.comet/`、`.opencode/`、`docs/openspec/config.yaml` 和 `skills-lock.json` 等既有工具升级改动不属于本 change，不得回滚、stage 或纳入提交。

# Decisions

- 每个 tag 使用独立双父 merge commit；验证后的聚焦修复可作为紧随其后的普通提交，但必须在下一个 tag 前重新通过该 tag 全部门禁。
- 冲突按所有权和行为进行三方语义合并，不批量采用 `ours` 或 `theirs`。
- 默认保留下游行为；等价替换候选是唯一需要在 Build 中暂停并请求用户选择的冲突类别。
- 已知队列完成后按发布边界查询动态前沿；一次无新增即收敛。
- 验证采用严格零失败标准，不使用历史失败或允许失败清单替代当前结果。

# Open questions

无。目标、范围、关键决定、验收项和非目标已在前序设计确认中明确。

# Verification expectations

- 保存初始状态、tag 队列、每 tag merge/fix commit、影响闭包、命令、退出码和 test/skip/todo 计数的可审计报告。
- 每个 tag 后验证 owning-package test/typecheck/build；Protocol/HttpApi、lockfile 和 VS Code 宿主变化时追加对应生成与安装门禁。
- 最终独立审查完整规格、Git 父链、diff、生成物和全部验收证据，并重新查询一次远端前沿。
