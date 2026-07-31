# Outcome

将本项目从当前已集成的上游 `opencode/dev@77429f59823c8c6df9cfee95d4c663043b017f46` 更新到最新稳定发版 `v1.18.6`，并保留 WebGUI、VS Code 与 JetBrains 插件的下游能力。Git 历史按上游稳定发版逐 tag 留下独立 merge commit，便于后续定位、回退和继续同步。

# Scope

- 依次合并 `v1.17.16`、`v1.17.17`、`v1.17.18`、`v1.17.19`、`v1.17.20`、`v1.18.0`、`v1.18.1`、`v1.18.2`、`v1.18.3`、`v1.18.4`、`v1.18.5`、`v1.18.6`。
- 逐次解决合并冲突，优先保留上游修复与架构演进，同时维持 `packages/opencode/webgui`、`hosts/vscode-plugin`、`hosts/jetbrains-plugin` 及其构建链路。
- 同步受上游版本变化影响的依赖、lockfile、SDK/生成产物和构建配置。
- 验证后端、WebGUI 和 IDE host 的关键构建与测试路径。
- 以独立测试提交解耦 Anthropic replay fixture 对共享模型目录 fixture 的依赖。

# Non-goals

- 不合并 `v1.18.6` 之后的 `opencode/dev` 未发版提交、beta tag 或 CI tag。
- 不以官方 `packages/app`、Desktop、网站或 Console 取代本项目自有 WebGUI。
- 不在本次同步中主动重构无关下游功能，也不发布新的 VSIX/JetBrains 安装包。
- 不提交 Comet 配置和工作流产物。

# Acceptance examples

- 从同步前 HEAD 查看 first-parent 历史时，12 个目标 tag 按上述顺序各对应一个独立 merge commit，且最终历史包含 `v1.18.6`。
- 上游某 tag 与自有 WebGUI 或 IDE bridge 冲突时，结果采用兼容上游新接口且继续保留下游入口的实现，而不是静默删除下游能力。
- `v1.18.6` 之后的 `opencode/dev` 提交不出现在合并结果中。
- WebGUI 能完成类型检查、生产构建和测试；VS Code 插件能编译并通过测试；JetBrains 插件能完成适用的单元测试或构建检查。
- 若 Protocol 或 Server `HttpApi` 的公开契约发生变化，生成产物由项目命令重新生成且与源码一致。

# Constraints and invariants

- 上游远端固定为 `opencode`，发版边界以已获取的稳定 semver tag 和 GitHub non-prerelease release 为准；本次目标上限为 `v1.18.6`。
- 每个 tag 使用非快进 merge，禁止 squash、rebase 或一次性合并 `opencode/dev` 代替逐 tag 历史。
- 不覆盖用户已有的 `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml` 工作树状态。
- 遵守仓库依赖方向、Effect v4、生成代码和 vfox 工具链规则。
- 无法依据上游意图、现有下游行为和测试唯一决定的冲突必须暂停并询问用户。
- `v1.18.6` merge commit 的授权仅覆盖已验证的 75-file tag merge；Anthropic replay fixture 解耦使用后续独立测试提交，Comet 文档和用户 dirty 文件继续保持未提交。

# Decisions

- 当前同步基线取自最近一次上游 merge 的第二父提交 `77429f59823c8c6df9cfee95d4c663043b017f46`；该提交时间位于 `v1.17.15` 与 `v1.17.16` 之间，因此首个待合并稳定 tag 为 `v1.17.16`。
- “最新发版”解释为 2026-07-27 从 `https://github.com/anomalyco/opencode.git` remote tags 与 GitHub Releases 交叉确认的最新稳定 tag `v1.18.6`，不使用更新但尚未发版的 `opencode/dev`。
- npm latest 为 `1.18.6`；未设置 `OPENCODE_VERSION` 时，本项目开发构建脚本会自动增加一个 patch 并显示 `1.18.7`，该值不是 release/tag 证据。
- 用户明确确认将 `v1.18.6` 纳入当前 change，并授权以正式 merge commit `c6024fe5decee2581a2c09bb0d75a6887e9e52f9` 完成 ancestry；其第二 parent 精确为 tag commit `00ac24ee5176117aae9df7873924d26b034a3229`。
- 用户明确授权以独立 commit `253389db631ad45627e133c7318b5e65a06479a8` 提交 Anthropic replay fixture 解耦，并重新确认该提交属于当前 contract。
- 冲突处理以“采用上游新契约并迁移下游集成”为默认方向；仅在两种结果都会改变用户可见行为且仓库事实无法裁决时提问。
- 官方 App/Desktop/UI/网站/Console 与历史 Comet 证据不属于插件验收范围，但 Git 合并仍完整接收目标 tag 中的这些内容。
- 用户已重新确认上述版本边界、逐 tag merge 历史、独立 replay 测试提交、下游保留策略与非目标。

# Open questions

- 当前没有阻塞问题；遇到无法唯一裁决的实际冲突时再记录并提问。

# Verification expectations

- 校验每个 merge commit 的父提交、顺序和 tag 可达性，并确认 `opencode/dev` 在 `v1.18.6` 后的目标外提交未被引入。
- 按受影响包运行 `bun typecheck`、生成一致性检查及最小充分测试；测试不得从仓库根目录运行。
- 从 `packages/opencode/webgui` 运行生产构建和测试。
- 从 `hosts/vscode-plugin` 运行编译与测试；从 `hosts/jetbrains-plugin` 使用 vfox 管理的 JDK 运行适用的 Gradle 检查。
- 检查最终 `git status`、未解决冲突、生成差异和下游关键入口，诚实记录任何环境限制或已有失败。
