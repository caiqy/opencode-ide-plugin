# OpenCode IDE Plugin

## What This Is

基于开源 opencode 项目的 IDE 插件，提供 WebGUI 前端界面 + VSCode/JetBrains 插件包装，让开发者在 IDE 内直接使用 opencode 的 AI 编码能力，与上游原有的 TUI 终端界面并存。

## Core Value

上游合并后构建通过且功能不退化——在持续跟进 opencode 上游更新的同时，保证 webgui 和 IDE 插件始终可用。

## Requirements

### Validated

- ✓ WebGUI React SPA 前端（聊天界面、会话管理、消息展示）— existing
- ✓ VSCode 插件包装（webview 嵌入 webgui、opencode 进程管理）— existing
- ✓ JetBrains 插件包装（JCEF webview、进程管理）— existing
- ✓ IDE Bridge HTTP+SSE 通信协议 — existing
- ✓ opencode 后端 API 集成（session、message、config、provider）— existing

### Active

- [ ] 建立上游合并流程（冲突检测、影响分析、合并策略）
- [ ] 构建通过 + 功能不退化的验证机制
- [ ] 后续新功能需求（待定，随上游更新和用户需求陆续明确）

### Out of Scope

- 替代上游 TUI — 与 TUI 并存而非取代
- 上游核心逻辑的重写 — 尽量保持上游代码不变，仅在 webgui/hosts 层扩展
- 移动端支持 — 仅面向桌面 IDE

## Context

- 上游仓库：opencode 开源项目（Go/TypeScript，Bun 运行时）
- 核心开发目录：`packages/opencode/webgui/`（WebGUI 前端）、`hosts/`（IDE 插件打包）
- 其余为上游 opencode 代码，作为基础依赖
- 上游 API 接口变更是合并时最易出问题的区域
- 目前没有建立上游合并流程，需要从零建立
- 新功能需求会陆续提出，项目需要保持灵活性

## Constraints

- **上游兼容**: 合并时尽量同时保留上游和 webgui 的逻辑，需要二选一时提出方案让用户选择
- **技术栈**: 前端 React 19 + Vite + Tailwind，VSCode 用 TypeScript，JetBrains 用 Kotlin
- **包管理**: 根目录用 Bun，VSCode 插件用 pnpm，JetBrains 用 Gradle

## Key Decisions

| Decision                       | Rationale                               | Outcome   |
| ------------------------------ | --------------------------------------- | --------- |
| WebGUI 与 TUI 并存             | 不干扰上游核心体验，IDE 用户使用 webgui | — Pending |
| 优先建立合并流程               | 没有流程就无法可靠地跟进上游更新        | — Pending |
| 冲突处理策略：尽量保留双方逻辑 | 最大化兼容性，减少功能损失              | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---

_Last updated: 2026-04-12 after initialization_
