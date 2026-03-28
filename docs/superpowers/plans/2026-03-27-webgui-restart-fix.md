# WebGUI Restart Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 webgui 对应 VSCode 插件的重启链路，减少扩展停用卡住、重启误报失败和 bridge 请求悬挂。

**Architecture:** 在 VSCode 宿主侧补齐 webview/provider/bridge/backend 的释放顺序，修复 backend 终止兜底逻辑，并把 `restartHost` 从“先 reload 后回包”改为“先回包后异步 reload”。在 webgui 前端为 `ideBridge.request()` 增加 timeout 与 pending 清理，保证宿主销毁时请求能结束。

**Tech Stack:** TypeScript、VSCode Extension Host、Node HTTP server、React、Vitest、vscode-test

---

### Task 1: 补齐宿主清理链路

**Files:**

- Modify: `hosts/vscode-plugin/src/extension.ts`
- Modify: `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`
- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewManager.ts`
- Test: `hosts/vscode-plugin/src/test/suite/extension.test.ts`

- [ ] **Step 1: 在 `hosts/vscode-plugin/src/test/suite/extension.test.ts` 写失败测试，覆盖扩展释放时会按顺序触发 `webviewManager.dispose()`、`activityBarProvider.dispose()`、`bridgeServer.stop()`、`backendLauncher.terminate()`，且重复调用不抛错**
- [ ] **Step 2: 运行 `pnpm test -- --grep "Extension Test Suite"`（在 `hosts/vscode-plugin` 目录）；若 grep 在当前 `vscode-test` 环境不可用，则退回 `pnpm test`**
- [ ] **Step 3: 修改 `hosts/vscode-plugin/src/extension.ts`，补齐 provider 的持有与释放，并显式调用 `bridgeServer.stop()`**
- [ ] **Step 4: 如需支持稳定顺序与幂等释放，最小修改 `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`、`hosts/vscode-plugin/src/ui/WebviewManager.ts` 或相关调用点**
- [ ] **Step 5: 重新运行上一步测试命令，确认通过**

### Task 2: 修复 restartHost 回包时序

**Files:**

- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Test: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`

- [ ] **Step 1: 在 `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts` 写失败测试，覆盖 `restartHost` 回复会在 reload handler 完成前返回 OK，且 handler 最终仍被调用**
- [ ] **Step 2: 运行 `pnpm test -- --grep "IdeBridgeServer"`（在 `hosts/vscode-plugin` 目录）确认新测试先失败**
- [ ] **Step 3: 修改 `hosts/vscode-plugin/src/ui/WebviewController.ts` 与 `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`，把 `restartHost` 改为先回包再异步执行 reload，并补日志**
- [ ] **Step 4: 重新运行 `pnpm test -- --grep "IdeBridgeServer"`，确认通过**

### Task 3: 修复 backend terminate 兜底逻辑

**Files:**

- Modify: `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
- Test: `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`

- [ ] **Step 1: 在 `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts` 写失败测试，覆盖强杀定时器使用的是 terminate 调用时捕获的原进程引用**
- [ ] **Step 2: 运行 `pnpm test -- --grep "BackendLauncher Test Suite"`（在 `hosts/vscode-plugin` 目录）确认新测试先失败**
- [ ] **Step 3: 修改 `hosts/vscode-plugin/src/backend/BackendLauncher.ts`，以局部变量保存进程并执行 graceful + force kill**
- [ ] **Step 4: 重新运行 `pnpm test -- --grep "BackendLauncher Test Suite"`，确认通过**

### Task 4: 提升前端 ideBridge request 健壮性

**Files:**

- Modify: `packages/opencode/webgui/src/lib/ideBridge.ts`
- Test: `packages/opencode/webgui/src/lib/ideBridge.test.ts`

- [ ] **Step 1: 在 `packages/opencode/webgui/src/lib/ideBridge.test.ts` 写失败测试，覆盖 `restartHost` 请求的 timeout 与 bridge 断开时 pending 会被 reject**
- [ ] **Step 2: 运行 `bun run --cwd packages/opencode/webgui test:run -- src/lib/ideBridge.test.ts`，确认新测试先失败**
- [ ] **Step 3: 修改 `packages/opencode/webgui/src/lib/ideBridge.ts`，仅为 `restartHost` 等高风险请求增加超时，并在断开时清空 pending**
- [ ] **Step 4: 重新运行 `bun run --cwd packages/opencode/webgui test:run -- src/lib/ideBridge.test.ts`，确认通过**

### Task 5: 最小回归验证

**Files:**

- No code changes expected

- [ ] **Step 1: 运行 `pnpm test -- --grep "IdeBridgeServer|BackendLauncher|Extension Test Suite"`（在 `hosts/vscode-plugin` 目录）**
- [ ] **Step 2: 运行 `bun run --cwd packages/opencode/webgui test:run -- src/lib/ideBridge.test.ts`**
- [ ] **Step 3: 运行 `bun run --cwd packages/opencode/webgui lint`**
- [ ] **Step 4: 如时间允许，补一次 `bun run --cwd packages/opencode/webgui test:run -- src/components/CompactHeader/index.test.tsx` 作为重启入口回归**
- [ ] **Step 5: 手工验证矩阵：分别从 Activity Bar 与 Panel 入口触发重启，确认无“重启失败” toast、无长期“正在停止扩展主机”，且 reload 后 webgui 能重连**
- [ ] **Step 6: 汇总结果与剩余风险**
