# OpenCode IDE Plugin 知识库

OpenCode IDE Plugin 是基于开源 opencode 项目的 IDE 插件，提供 WebGUI 前端界面 + VSCode/JetBrains 插件包装，让开发者在 IDE 内直接使用 opencode 的 AI 编码能力，与上游原有的 TUI 终端界面并存。

## 知识库目录树

```text
knowledge-base/
├── README.md
├── adr/
│   ├── 001-webgui-local-hosting.md
│   ├── 002-ide-bridge-protocol.md
│   └── 003-scoped-storage-hardcut.md
├── explanation/
│   ├── architecture-overview.md
│   ├── ide-bridge-design.md
│   ├── state-storage-model.md
│   └── upstream-adaptation-strategy.md
├── how-to/
│   ├── frontend/add-webgui-capability.md
│   ├── frontend/add-ide-bridge-message.md
│   ├── hosts/add-vscode-command.md
│   ├── hosts/add-jetbrains-action.md
│   ├── maintainer/sync-upstream.md
│   └── maintainer/package-and-release.md
└── reference/
    ├── capabilities-index.md
    ├── api-docs.md
    ├── glossary.md
    ├── repositories/*.md
    └── business/*.md
```

## 速查表

| 想了解 | 看 |
|---|---|
| 架构 | [architecture-overview](explanation/architecture-overview.md) |
| 能力总览 | [capabilities-index](reference/capabilities-index.md) |
| 仓库结构 | [packages-opencode](reference/repositories/packages-opencode.md)、[hosts-vscode-plugin](reference/repositories/hosts-vscode-plugin.md)、[hosts-jetbrains-plugin](reference/repositories/hosts-jetbrains-plugin.md) |
| WebGUI 如何工作 | [embedded-webgui-serving](reference/business/embedded-webgui-serving.md)、[ADR 001](adr/001-webgui-local-hosting.md) |
| IDE Bridge | [ide-bridge-design](explanation/ide-bridge-design.md)、[ide-bridge](reference/business/ide-bridge.md)、[ADR 002](adr/002-ide-bridge-protocol.md) |
| 上游同步 | [upstream-adaptation-strategy](explanation/upstream-adaptation-strategy.md)、[sync-upstream](how-to/maintainer/sync-upstream.md)、[upstream-compatibility](reference/business/upstream-compatibility.md) |
| 如何打包发布 | [package-and-release](how-to/maintainer/package-and-release.md)、[packaging-release](reference/business/packaging-release.md) |
| 设置 Provider | [provider-settings](reference/business/provider-settings.md)、[settings-panel](reference/business/settings-panel.md) |
| 开发新能力 | [add-webgui-capability](how-to/frontend/add-webgui-capability.md)、[capabilities-index](reference/capabilities-index.md) |
| 新手入门 | [architecture-overview](explanation/architecture-overview.md)、[glossary](reference/glossary.md)、[capabilities-index](reference/capabilities-index.md) |

## 能力分组

全量能力见 [capabilities-index](reference/capabilities-index.md)。

| 组 | 代表能力 |
|---|---|
| A. WebGUI 托管与运行时 | 嵌入式 WebGUI `/app` 托管、浏览器/IDE 双模式、中文本地化 |
| B. 会话与聊天体验 | 会话生命周期、消息流分页、多标签页会话工作台 |
| C. 工具、子任务与可视化 | ToolPart 渲染、流式工具预览、Diff / 文件变更浏览 |
| D. 状态面板与运行时开关 | 状态面板、MCP 启停、Skills runtime overlay |
| E. 设置、Provider、Agent | Provider 设置页、Agent 配置热重载、模型/Agent/Variant 选择器 |
| F. 状态持久化 | scoped storage、non-git 项目目录隔离 |
| G. IDE Bridge 与宿主能力 | IDE Bridge 协议、IDE 上下文插入、宿主动作 |
| H. 宿主生命周期与集成 | 后端启动生命周期、Webview/JCEF 承载、JetBrains 后端日志懒显示 |
| I. 版本、更新与发布 | 版本门禁、VSCode 更新、插件打包 |
| J. 上游适配边界 | 前台读取优先、流错误恢复、工具外部目录安全边界 |

## 文档组织

本知识库按 Diátaxis 象限组织，是理解本项目的唯一文档入口。
`explanation/` 解释设计，`how-to/` 给操作步骤，`reference/` 记录能力契约和逐文件地图，`adr/` 追溯历史决策。

逐文件模块地图放在 [reference/repositories/](reference/repositories/)：`packages-opencode.md` 含 WebGUI 模块覆盖矩阵和上游适配点，两个 host 文件含宿主插件目录结构。

## 阅读路径

1. 全景：先读 [architecture-overview](explanation/architecture-overview.md)。
2. 索引：再读 [capabilities-index](reference/capabilities-index.md)。
3. 能力详情：进入对应 [business](reference/business/) 文档。
4. 操作指南：按任务打开 [how-to](how-to/) 下的步骤文档。

## 维护规则

- 代码先行：文档描述必须能追到当前代码真源。
- 标注未核验：没有运行验证的结论要明确写出待核验。
- 每象限一份文档：解释、指南、参考、ADR 不混写。
- ADR 只追加：历史决策不重写，变化用新 ADR 记录。
- 新增能力先改 [capabilities-index](reference/capabilities-index.md)，再写或更新对应 business 文档。
