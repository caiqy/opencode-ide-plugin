# 上游稳定发版同步

## 目标状态

项目必须完整包含上游 OpenCode 稳定发版至 `v1.18.6` 的代码，同时继续提供自有 WebGUI、VS Code 插件和 JetBrains 插件。同步历史必须能够按单个上游发版审计和回退。

## 发版边界与顺序

1. 当前同步基线为已集成的 `opencode/dev@77429f59823c8c6df9cfee95d4c663043b017f46`。
2. 项目必须按顺序分别合并 `v1.17.16`、`v1.17.17`、`v1.17.18`、`v1.17.19`、`v1.17.20`、`v1.18.0`、`v1.18.1`、`v1.18.2`、`v1.18.3`、`v1.18.4`、`v1.18.5`、`v1.18.6`。
3. 每个发版必须形成独立的非快进 merge commit；不得用 squash、rebase 或一次性合并上游开发分支替代。
4. 同步结果不得包含 `v1.18.6` 之后仅存在于 `opencode/dev` 的未发版提交。

## 下游兼容

1. 合并结果必须保留 `packages/opencode/webgui` 及其服务端托管、SDK 调用和 IDE bridge 集成。
2. 合并结果必须保留 `hosts/vscode-plugin` 和 `hosts/jetbrains-plugin` 的构建、启动、上下文传递与通知能力。
3. 上游接口或目录结构变化与下游代码冲突时，必须迁移下游调用以适配上游新契约；不得仅通过删除下游入口消除冲突。
4. 与插件无关的官方 App、Desktop、UI、网站和 Console 内容可直接采用对应 tag 的上游结果，不要求移植到自有 WebGUI。

## 生成与依赖一致性

1. 目标 tag 引起的依赖声明和 lockfile 变化必须保持一致。
2. 公共 Protocol 或 Server `HttpApi` 变化时，Client 生成代码必须通过仓库生成命令更新，不得手工编辑生成目录。
3. 构建使用仓库指定且由 vfox 管理的 Bun、Node.js 与 JDK 版本。
4. Anthropic replay 测试必须使用本地测试模型配置，不依赖共享模型目录 fixture。

## 验收

1. Git first-parent 历史可按顺序识别全部 12 个目标 tag 的独立 merge commit，最终历史包含 `v1.18.6`。
2. 后端受影响包通过类型检查和相关测试，生成代码检查无漂移。
3. 自有 WebGUI 通过生产构建和测试。
4. VS Code 插件通过编译和测试；JetBrains 插件通过适用的 Gradle 单元测试或构建检查。
5. 最终工作树没有未解决冲突，且用户在同步前已有的工作树状态未被覆盖。
6. Anthropic replay fixture 解耦必须位于独立测试提交，且聚焦测试与 OpenCode 类型检查通过。
