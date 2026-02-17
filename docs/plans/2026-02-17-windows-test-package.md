# Windows Test Package Build Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按照 CLAUDE.md 的说明在 Windows 环境生成可安装的测试 VSIX 包。

**Architecture:** 使用仓库自带的 `hosts/scripts/build_vscode.bat` 一键构建链路（webgui → 二进制 → VSIX），再检查产物与二进制是否被打包进 VSIX。

**Tech Stack:** Bun, pnpm/npm, VSCE, Windows batch scripts

---

### Task 1: 环境准备与基线验证

**Files:**

- Modify: none
- Test: `packages/opencode/test/tool/read.test.ts`

**Step 1: 阅读 CLAUDE.md 确认 Windows 打包命令**

Run: `type CLAUDE.md`
Expected: 看到 8.3 节的 Windows 打包命令说明

**Step 2: 安装依赖**

Run: `bun install`
Expected: 依赖安装完成（若失败，记录错误并结束任务，附错误上下文）

**Step 3: 运行最小基线测试**

Run: `bun run --cwd packages/opencode test test/tool/read.test.ts`
Expected: PASS

**Step 4: 记录基线结果**

Run: `git status -s`
Expected: 无意外修改（如有变更，记录并说明原因）

---

### Task 2: Windows 测试包一键打包

**Files:**

- Modify: none

**Step 1: 运行 Windows 单平台打包命令**

Run: `cmd /c "hosts\\scripts\\build_vscode.bat --production --skip-tests --single"`
Expected: 输出包含 "Build completed successfully" 并生成 `hosts/vscode-plugin/opencode-vscode-*.vsix`

**Step 2: 确认 VSIX 产物存在**

Run: `dir hosts\\vscode-plugin\\opencode-vscode-*.vsix`
Expected: 至少一个 VSIX 文件

---

### Task 3: 校验 VSIX 是否包含二进制

**Files:**

- Modify: none

**Step 1: 列出 VSIX 内容**

Run: `npx -y @vscode/vsce ls --tree hosts\\vscode-plugin\\opencode-vscode-*.vsix`
Expected: 输出包含 `extension/resources/bin/windows/amd64/opencode.exe`

**Step 2: 汇报产物大小与路径**

Run: `dir hosts\\vscode-plugin\\opencode-vscode-*.vsix`
Expected: 显示文件大小与路径，便于后续安装测试
