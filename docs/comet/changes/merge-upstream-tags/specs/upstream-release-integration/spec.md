# 上游发布集成

## 目的

建立可重复、可审计的上游发布同步能力，使下游 IDE 插件持续吸收官方稳定 release tag，同时保留本地行为并把回归限制在单个发布边界内。

## 要求

### 按发布顺序推进

系统必须从当前已集成的最高官方稳定 release tag 之后开始，按语义版本升序逐个处理全部后续稳定 release tag，不得以 `dev` 分支、非 release commit、prerelease 或不稳定 tag 替代。

- 多个 tag 待处理时，一次只处理一个 tag。
- 相邻 tag 彼此不是祖先时，仍分别建立发布边界，不压缩为一次同步。

### 持续追踪发布前沿

系统必须在完成当前已发现的最高 tag 后重新查询官方远端，并持续追加更高稳定 release tag，直到一次查询确认没有新增。

- 执行期间出现新稳定 tag 时，将其按版本顺序加入同一流程。
- 一次查询无新增后，结束合并循环并进入最终验证。

### 保留可审计的 tag 边界

每个 release tag 必须对应一个独立双父 merge commit；第一父是前一 tag 已验证后的下游状态，第二父精确匹配该官方 tag 的 peeled commit，subject 使用 `chore(opencode): merge upstream <tag>`。

- 冲突解决属于当前 tag 的 merge commit。
- 合并后验证发现需要聚焦修复时，可在 merge commit 后创建普通修复提交，但必须在推进下一 tag 前重新完成当前 tag 全部验证。
- 不得 squash 多个 tag，也不得重写已经建立的逐 tag 历史。

### 保护下游行为

系统必须保留 IDE bridge、WebGUI、远程 Workspace 和其他下游扩展行为。冲突必须按双方意图进行语义三方合并，不得批量采用 `ours` 或 `theirs`。

- 无法证明上游实现等价时，保留下游行为并记录判断。
- 上游实现可能等价替换下游实现时，必须先提供调用路径、测试覆盖、差异、风险和建议，并等待用户明确选择后再删除下游实现。
- 上游拥有的 workspace package 版本随 tag 更新；下游独有宿主和发布版本保持独立。

### 保持生成物与协议一致

公共 Protocol 或 Server `HttpApi` 变化时，系统必须使用仓库规定流程刷新 Client 和 legacy JavaScript SDK，不得直接编辑 `src/generated` 或 `src/generated-effect`。

- 从 `packages/client` 运行 `bun run generate`，并执行 generated 一致性检查。
- 按仓库规定运行 legacy JavaScript SDK build，并执行 `packages/opencode` 的 `test:httpapi`、WebGUI 和 VS Code 默认门禁。
- manifest 或 lockfile 变化时使用对应 package manager 重新生成并通过 frozen install，不得手工编辑 lockfile。

### 合并前建立零失败基线

合并首个待处理 tag 前，系统必须使已知队列影响闭包内全部适用默认 package test、typecheck、build 和生成物检查达到零失败；历史残余或允许失败清单不得替代当前验证。

- 当前任一适用门禁失败时，先修复并重新完成全部基线门禁，不开始 tag 合并。
- skip/todo 数量必须记录为基线，后续不得无解释增加。

### 每个 tag 通过完整验证

每个 tag 后必须对全部受影响 owning package 完成适用 test、typecheck 和 build；任何未解决失败都必须阻止下一个 tag。

- 验证从 package 目录运行；不从仓库根运行测试，不直接调用 `tsc`。
- 适用门禁零失败且 skip/todo 不高于基线后，才能推进下一 tag。
- App E2E、benchmark、Desktop 平台打包和 VSIX 发布不属于默认门禁。

### 保持 change 边界

本 change 只提交上游发布集成、必要聚焦修复、验证证据和正式 workflow 产物。既有用户或工具升级改动不得被回滚、stage 或夹带提交。

### 完成最终审计

一次远端查询确认无新增稳定 tag 后，系统必须审计 tag 顺序、每个 merge 的双父父链、版本、manifest、lockfile、生成物和适用跨包门禁，并由独立 reviewer 对完整规格和证据作出结论。
