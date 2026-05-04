# WebGUI 本地开发 backend launch.json Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 `.vscode/launch.json` 中追加一个源码方式启动 opencode backend 的 VSCode 配置，并固定使用 `4300` 端口以避开用户日常 `4096` 冲突和系统排除端口范围。

**Architecture:** 本次实现继续保持最小范围：只修改 `.vscode/launch.json`，在保留现有 `WebGUI: dev` 的前提下，新增一个 `node-terminal` 配置 `Backend: source web 4300`。该配置直接运行 `packages/opencode/src/index.ts` 的 web 命令链路，因此使用的是当前工作区源码，而不是历史构建产物。

**Tech Stack:** VSCode launch.json、Bun、opencode 源码入口

**Spec:** `docs/superpowers/specs/2026-05-04-webgui-backend-launch-json-design.md`

---

## 文件结构

- `.vscode/launch.json`
  - 现有正式 VSCode 启动配置文件
  - 当前已包含 `WebGUI: dev`
  - 本次追加 `Backend: source web 4300`

- `.vscode/launch.example.json`
  - 现有示例文件
  - 本次不修改

---

### Task 1: 追加 backend 源码启动配置并验证内容正确

**Files:**

- Modify: `.vscode/launch.json`

- [ ] **Step 1: 先写出目标配置结构，明确两个配置并存**

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node-terminal",
      "request": "launch",
      "name": "WebGUI: dev",
      "command": "bun run --cwd packages/opencode/webgui dev"
    },
    {
      "type": "node-terminal",
      "request": "launch",
      "name": "Backend: source web 4300",
      "command": "bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs"
    }
  ]
}
```

- [ ] **Step 2: 按 Step 1 更新 `.vscode/launch.json`**

```text
路径：D:\Caiqy\Projects\Github\opencode-ide-plugin\.vscode\launch.json
要求：
- 保留现有 `WebGUI: dev`
- 追加 `Backend: source web 4300`
- 不新增第三个配置
```

- [ ] **Step 3: 读取文件确认最终内容正确**

Run: 读取 `.vscode/launch.json`

Expected:

- 文件存在
- `configurations` 中恰好有 2 个配置
- 第二个配置名称是 `Backend: source web 4300`
- 命令包含 `src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs`

- [ ] **Step 4: 在 VSCode 中手工验证 backend 启动入口**

```text
1. 打开 VSCode 的“运行和调试”面板
2. 选择 `Backend: source web 4300`
3. 点击启动
4. 确认终端执行：
   bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs
5. 确认它不会因 4096 被占用而立即失败
```

Expected: VSCode 能成功在终端中按源码方式启动 backend，且端口为 `4300`。

- [ ] **Step 5: Commit（仅在用户已明确要求提交时执行，否则跳过）**

```bash
git add .vscode/launch.json
git commit -m "chore(vscode): add backend source launch config"
```

---

## 计划自检

- **Spec coverage:**
  - 追加 backend launch 配置 → Task 1
  - 保持源码启动而非构建产物 → Task 1 Step 1-4
  - 端口固定为 4300 → Task 1 Step 1-4
  - 与现有 WebGUI: dev 并存 → Task 1 Step 1-3
  - 不修改示例文件 → 文件结构说明
- **Placeholder scan:** 无 `TODO` / `TBD` / “后续补充” 占位语句。
- **Type consistency:** 全程统一使用 `Backend: source web 4300`、`node-terminal`、`--port 4300`。
