# OpenCode IDE Plugin

## 项目简介

基于开源 opencode 项目的 IDE 插件，提供 WebGUI 前端界面 + VSCode/JetBrains 插件包装，让开发者在 IDE 内直接使用 opencode 的 AI 编码能力，与上游原有的 TUI 终端界面并存。

## 核心价值

上游合并后构建通过且功能不退化——在持续跟进 opencode 上游更新的同时，保证 webgui 和 IDE 插件始终可用。

## 需求

### 已验证

- ✓ WebGUI React SPA 前端（聊天界面、会话管理、消息展示）— 已有
- ✓ VSCode 插件包装（webview 嵌入 webgui、opencode 进程管理）— 已有
- ✓ JetBrains 插件包装（JCEF webview、进程管理）— 已有
- ✓ IDE Bridge HTTP+SSE 通信协议 — 已有
- ✓ opencode 后端 API 集成（session、message、config、provider）— 已有

### 进行中

- [ ] 建立上游合并流程（冲突检测、影响分析、合并策略）
- [ ] 构建通过 + 功能不退化的验证机制
- [ ] 后续新功能需求（待定，随上游更新和用户需求陆续明确）

### 超出范围

- 替代上游 TUI — 与 TUI 并存而非取代
- 上游核心逻辑的重写 — 尽量保持上游代码不变，仅在 webgui/hosts 层扩展
- 移动端支持 — 仅面向桌面 IDE

## 背景

- 上游仓库：opencode 开源项目（Go/TypeScript，Bun 运行时）
- 核心开发目录：`packages/opencode/webgui/`（WebGUI 前端）、`hosts/`（IDE 插件打包）
- 其余为上游 opencode 代码，作为基础依赖
- 上游 API 接口变更是合并时最易出问题的区域
- 目前没有建立上游合并流程，需要从零建立
- 新功能需求会陆续提出，项目需要保持灵活性

## 约束条件

- **上游兼容**: 合并时尽量同时保留上游和 webgui 的逻辑，需要二选一时提出方案让用户选择
- **技术栈**: 前端 React 19 + Vite + Tailwind，VSCode 用 TypeScript，JetBrains 用 Kotlin
- **包管理**: 根目录用 Bun，VSCode 插件用 pnpm，JetBrains 用 Gradle

## 关键决策

| 决策                           | 理由                                    | 结果   |
| ------------------------------ | --------------------------------------- | ------ |
| WebGUI 与 TUI 并存             | 不干扰上游核心体验，IDE 用户使用 webgui | — 待定 |
| 优先建立合并流程               | 没有流程就无法可靠地跟进上游更新        | — 待定 |
| 冲突处理策略：尽量保留双方逻辑 | 最大化兼容性，减少功能损失              | — 待定 |

## 演进规则

本文档在阶段转换和里程碑节点时更新。

**每次阶段转换后**（通过 `/gsd-transition`）：

1. 需求被推翻？→ 移至超出范围并注明原因
2. 需求被验证？→ 移至已验证并引用阶段编号
3. 发现新需求？→ 添加到进行中
4. 有决策要记录？→ 添加到关键决策
5. "项目简介"还准确吗？→ 如有偏差则更新

**每次里程碑完成后**（通过 `/gsd-complete-milestone`）：

1. 全面审查所有章节
2. 核心价值检查——优先级是否仍然正确？
3. 审计超出范围——理由是否仍然成立？
4. 用当前状态更新背景

---

_最后更新：2026-04-12 初始化后_
