# WebGUI 本地开发 launch.json 设计

> 日期：2026-05-04
> 状态：待审阅

## 概述

为本仓库新增一个正式的 VSCode `.vscode/launch.json`，提供一个最小可用的本地开发入口，让开发者可以在 VSCode 中一键启动 `packages/opencode/webgui` 的 Vite dev server，而不必依赖 AI 代管后台进程。

本次只解决“启动 WebGUI dev”这一个场景，不扩展到 backend 自动启动、compound 配置或 Bun attach 调试。

## 目标

1. 在 VSCode 中提供可直接点击的 WebGUI dev 启动入口。
2. 复用仓库已有脚本 `bun run --cwd packages/opencode/webgui dev`。
3. 保持实现最小，不影响现有 `.vscode/launch.example.json`。

## 非目标

- 不自动启动 opencode backend。
- 不新增 compound 调试配置。
- 不改成 Bun inspector attach 调试。
- 不自动打开浏览器。

## 方案

采用一个单独的正式 `launch.json` 配置，使用 VSCode `node-terminal` 启动类型：

- 文件：`.vscode/launch.json`
- 配置名：`WebGUI: dev`
- 类型：`node-terminal`
- 请求：`launch`
- 命令：`bun run --cwd packages/opencode/webgui dev`

## 选择理由

- `node-terminal` 最贴近日常“打开终端执行命令”的习惯，稳定且简单。
- 直接复用现有 `package.json` script，避免把 Vite 细节硬编码到编辑器配置里。
- 只新增一个配置，最适合当前“手动运行前端看改动”的目标。

## 不采用的方案

### 方案 A：Bun attach 调试

仓库已有 `.vscode/launch.example.json` 示例，但这更适合附加到已运行的 Bun 调试端口，不适合当前“一键启动 dev server”的目标。

### 方案 B：前后端多配置合集

虽然可以把 backend 启动和 WebGUI dev 一起放进 `launch.json`，但这会让当前需求复杂化。当前更需要的是一个最小、直接、可立即使用的入口。

## 文件边界

### 新增

- `.vscode/launch.json`

### 不修改

- `.vscode/launch.example.json`
- `.vscode/settings.example.json`
- 任何 `package.json` script

## 验证方式

1. 在 VSCode 打开“运行和调试”。
2. 选择 `WebGUI: dev`。
3. 启动后确认终端执行 `bun run --cwd packages/opencode/webgui dev`。
4. 终端出现 Vite 本地地址后，手动打开浏览器访问 `/app`。

## 结论

本次采用单配置、最小范围的 `launch.json` 方案，仅为 WebGUI 本地开发提供一个正式的 VSCode 启动入口，满足“手动运行、立即返回、前端可持续运行”的需求，同时避免把调试场景扩展得过重。
