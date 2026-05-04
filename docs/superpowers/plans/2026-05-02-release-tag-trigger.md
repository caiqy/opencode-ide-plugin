# Release Tag Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `.github/workflows/release.yml` 在保留手动触发的同时，支持通过推送 `v*` tag 自动触发包含 VSCode 与 JetBrains/IDEA 插件在内的发版流程。

**Architecture:** 这是一次最小改动：只修改 `release.yml` 顶部的 `on` 触发配置，启用已预留的 `push.tags` 入口，并保持现有 `preflight`、`build-vscode`、`build-jetbrains`、`release` job 全部不变。由于这是 GitHub Actions YAML 配置变更，没有现成的仓库级单元测试入口，本计划采用“先写失败的结构断言命令，再做最小修改，再重跑断言”的方式验证目标行为。

**Tech Stack:** GitHub Actions YAML、Node.js 文件断言命令、现有 Bun/pnpm/Gradle release 流程

---

## 文件结构

- Modify: `.github/workflows/release.yml:3-18`
  - 打开 `push.tags: ["v*"]` 触发器
  - 保留 `workflow_dispatch`
  - 不改动后续 jobs、版本解析与 artifact 上传逻辑

---

### Task 1: 启用 release workflow 的 `v*` tag 触发器

**Files:**

- Modify: `.github/workflows/release.yml:3-18`

- [ ] **Step 1: 先写失败的结构断言，锁定“同时支持 tag 触发与手动触发”的目标**

在仓库根目录准备并执行下面这条断言命令；它会要求 `release.yml` 同时包含 `push.tags: ["v*"]`、`workflow_dispatch:` 和 tag 版本解析语句。当前文件因为还没有启用 `push.tags`，所以预期失败。

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if(!/^[\s\S]*on:\n  push:\n    tags:\n      - \"v\*\"/m.test(text)) throw new Error('missing v* push trigger'); if(!/workflow_dispatch:/m.test(text)) throw new Error('missing workflow_dispatch trigger'); if(!/echo \"version=\$\{GITHUB_REF#refs\/tags\/\}\" >> \$GITHUB_OUTPUT/m.test(text)) throw new Error('missing tag version parsing'); console.log('release workflow trigger shape ok')"
```

- [ ] **Step 2: 运行断言命令，确认当前确实失败**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if(!/^[\s\S]*on:\n  push:\n    tags:\n      - \"v\*\"/m.test(text)) throw new Error('missing v* push trigger'); if(!/workflow_dispatch:/m.test(text)) throw new Error('missing workflow_dispatch trigger'); if(!/echo \"version=\$\{GITHUB_REF#refs\/tags\/\}\" >> \$GITHUB_OUTPUT/m.test(text)) throw new Error('missing tag version parsing'); console.log('release workflow trigger shape ok')"
```

Expected:

```text
Error: missing v* push trigger
```

- [ ] **Step 3: 只做最小实现，启用 `push.tags` 并保留手动触发**

把 `.github/workflows/release.yml` 顶部 `on` 段改成下面这个目标形态：

```yml
name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs:
      version:
        description: "Release version (e.g., v1.0.0)"
        required: true
        type: string
      prerelease:
        description: "Mark as pre-release"
        required: false
        type: boolean
        default: false
```

要求：

- 删除顶部注释掉的 `push.tags` 示例，避免 workflow 里同时出现启用版与注释版
- 不改 `preflight` 里的 `EVENT_NAME` / `GITHUB_REF#refs/tags/` 分支逻辑
- 不改 `build-vscode`、`build-jetbrains`、`release`、`test-artifacts` 的任何步骤

- [ ] **Step 4: 重跑结构断言，确认 tag 触发入口与原有版本解析同时成立**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if(!/^[\s\S]*on:\n  push:\n    tags:\n      - \"v\*\"/m.test(text)) throw new Error('missing v* push trigger'); if(!/workflow_dispatch:/m.test(text)) throw new Error('missing workflow_dispatch trigger'); if(!/echo \"version=\$\{GITHUB_REF#refs\/tags\/\}\" >> \$GITHUB_OUTPUT/m.test(text)) throw new Error('missing tag version parsing'); console.log('release workflow trigger shape ok')"
```

Expected:

```text
release workflow trigger shape ok
```

- [ ] **Step 5: 做一次人工 smoke checklist，确认本次改动没有越界**

按下面 checklist 检查 `.github/workflows/release.yml`：

```text
1. on.push.tags 只匹配 "v*"
2. workflow_dispatch 仍保留 version / prerelease 两个输入
3. preflight 的 else 分支仍从 refs/tags 取版本
4. build-vscode job 仍存在
5. build-jetbrains job 仍存在
6. release job 仍以上述两个 build job 为 needs
```

Expected: 以上 6 项全部满足，且除了顶部 `on` 段外没有额外行为变更。

- [ ] **Step 6: 提交这一小步**

```bash
git add .github/workflows/release.yml
git commit -m "ci: trigger release workflow on version tags"
```

---

## 交付后验证

实现完成后，再补一轮最终验证：

1. 在 GitHub Actions UI 中确认 `Release` workflow 同时显示 `workflow_dispatch` 与 `push` 触发来源
2. 使用测试 tag 执行：

```bash
git tag v26.5.2-rc.1
git push origin v26.5.2-rc.1
```

3. 确认 workflow 自动启动并进入：
   - `preflight`
   - `build-vscode`
   - `build-jetbrains`
   - `release`
4. 确认 Release 页面出现：
   - VSCode `.vsix`
   - JetBrains/IDEA `.zip`
   - prerelease 标记

如果不希望在真实仓库创建测试版本，可跳过这一步，只保留前面的静态结构断言与人工 smoke checklist。
