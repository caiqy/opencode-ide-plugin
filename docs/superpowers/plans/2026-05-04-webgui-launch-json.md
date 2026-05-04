# WebGUI 本地开发 launch.json Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为本仓库新增一个正式的 VSCode `.vscode/launch.json`，让开发者可以一键启动 `packages/opencode/webgui` 的 Vite dev server。

**Architecture:** 这次实现保持最小范围：只新增 `.vscode/launch.json`，并只放一个 `node-terminal` 启动配置，直接复用现有命令 `bun run --cwd packages/opencode/webgui dev`。不修改示例文件，不引入 backend 启动、compound 配置或 Bun attach 调试。

**Tech Stack:** VSCode launch.json、Bun、Vite

**Spec:** `docs/superpowers/specs/2026-05-04-webgui-launch-json-design.md`

---

## 文件结构

- `.vscode/launch.json`
  - 新增正式 VSCode 启动配置
  - 只包含一个 `WebGUI: dev` 配置
  - 负责在 VSCode 终端中执行 `bun run --cwd packages/opencode/webgui dev`

- `.vscode/launch.example.json`
  - 现有示例文件
  - 本次不修改，仅保留 Bun attach 示例

---

### Task 1: 新增正式 launch.json 并验证可启动 WebGUI dev

**Files:**

- Create: `.vscode/launch.json`

- [ ] **Step 1: 先写出目标配置文件内容**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node-terminal",
      "request": "launch",
      "name": "WebGUI: dev",
      "command": "bun run --cwd packages/opencode/webgui dev"
    }
  ]
}
```

- [ ] **Step 2: 创建 `.vscode/launch.json` 并写入上述内容**

```text
路径：D:\Caiqy\Projects\Github\opencode-ide-plugin\.vscode\launch.json
内容：与 Step 1 完全一致
```

- [ ] **Step 3: 用文件检查确认内容与预期一致**

Run: 读取 `.vscode/launch.json`

Expected: 文件存在，且只包含一个 `WebGUI: dev` 配置；没有 backend、attach、compound 等额外配置。

- [ ] **Step 4: 在 VSCode 中手工验证启动入口**

```text
1. 打开 VSCode 的“运行和调试”面板
2. 选择 `WebGUI: dev`
3. 点击启动
4. 确认 VSCode 终端执行：`bun run --cwd packages/opencode/webgui dev`
5. 等待 Vite 输出本地地址后，在浏览器手动打开 `/app`
```

Expected: VSCode 能成功拉起终端并运行 WebGUI dev 命令。

- [ ] **Step 5: Commit（仅在用户已明确要求提交时执行，否则跳过）**

```bash
git add .vscode/launch.json
git commit -m "chore(vscode): add webgui dev launch config"
```

---

## 计划自检

- **Spec coverage:**
  - 正式 `launch.json` 文件 → Task 1
  - 仅保留单个 WebGUI dev 配置 → Task 1 Step 1-3
  - 不修改示例文件 → 文件结构说明 + Task 1
  - 手工验证 VSCode 启动流程 → Task 1 Step 4
- **Placeholder scan:** 无 `TODO` / `TBD` / “后续补充” 占位语句。
- **Type consistency:** 全程统一使用 `WebGUI: dev`、`node-terminal`、`bun run --cwd packages/opencode/webgui dev`。
