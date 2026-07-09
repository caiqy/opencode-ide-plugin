# Plugin Release Content Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `docs/release-content/README.shared.md` 与 `docs/release-content/description.shared.md` 改成“英文标题/首句 + 中文正文”的统一介绍页，并把图片生成工作流与生图配置要点升级为核心卖点。

**Architecture:** 本次只改共享发布内容源，不改生成器逻辑。先重写两份共享 Markdown，再运行现有 `release-content:sync` 生成 VSCode / JetBrains 产物，最后用同步校验和现有渲染测试确认发布链路仍然成立。

**Tech Stack:** Markdown、Bun、TypeScript、既有 `script/release-content.ts` 生成链路

---

## File Structure

- Modify: `docs/release-content/README.shared.md` — 双平台 README 的共享主体，保留英文标题与英文首句，正文改为中文并突出完整生图链路。
- Modify: `docs/release-content/description.shared.md` — JetBrains Marketplace 描述源，保留以 `OpenCode UI` 开头的英文首句，正文与 README 保持一致。
- Modify: `hosts/vscode-plugin/README.md` — 由共享 README 自动生成，需同步出新的中文正文与 VSCode 平台尾注。
- Modify: `hosts/jetbrains-plugin/README.md` — 由共享 README 自动生成，需同步出新的中文正文与 JetBrains 平台尾注。
- Modify: `hosts/jetbrains-plugin/description.html` — 由共享 description 自动生成，需保留英文首句并输出中文 HTML 小节。

### Task 1: 重写共享 Markdown 文案源

**Files:**

- Modify: `docs/release-content/README.shared.md`
- Modify: `docs/release-content/description.shared.md`

- [ ] **Step 1: 用完整目标文案重写 `docs/release-content/README.shared.md`**

```md
# OpenCode UI (unofficial)

OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, image generation, and bundled backend binaries.

## 概览

OpenCode UI (unofficial) 是一个将本地 OpenCode AI 工作流带入 IDE 的非官方插件。你可以直接在编辑器中处理聊天、上下文整理与图片生成任务，而不必在 IDE、终端和外部工具之间来回切换。

## 核心能力

- 在 IDE 中直接生成图片，把图片生成工作流放进日常编码环境
- 基于已有图片继续编辑，便于迭代 UI 草图、素材和设计方案
- 在聊天界面和插件预览中直接查看生成结果，减少来回切换
- 将生成结果保存到项目文件，便于继续引用、提交或协作
- 支持将文件拖拽到上下文中，快速补充任务背景
- 支持通过命令或快捷操作把当前文件、已打开文件和选中代码加入上下文
- 提供独立输入区，便于整理、修改和扩展提示词

## 生图配置要点

- 需要先在 OpenCode 中配置支持图片生成的 provider / model，相关能力才会在工作流中可用
- 图片生成功能是否可用，取决于当前 OpenCode 模型配置是否支持对应能力
- 如果要基于已有图片继续编辑，需要先提供现有图片作为输入
- 生成结果会进入当前工作流，并保存到项目中的 `.opencode/generated-images/`，便于后续继续引用

## 重要说明

这是非官方插件。请只安装一个 OpenCode IDE 变体，避免重复功能或行为冲突。

## 标准版说明

当前发布的是 standard variant。它会为受支持平台内置 OpenCode backend，并在本地运行时自动启动。

## 适用人群

这个插件面向已经在使用 OpenCode 的开发者，适合希望留在 IDE 内完成聊天、上下文管理、图片生成与本地 AI 编码工作的用户。
```

- [ ] **Step 2: 用与 README 一致的正文重写 `docs/release-content/description.shared.md`**

```md
OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, image generation, and bundled backend binaries.

## 概览

OpenCode UI (unofficial) 是一个将本地 OpenCode AI 工作流带入 IDE 的非官方插件。你可以直接在编辑器中处理聊天、上下文整理与图片生成任务，而不必在 IDE、终端和外部工具之间来回切换。

## 核心能力

- 在 IDE 中直接生成图片，把图片生成工作流放进日常编码环境
- 基于已有图片继续编辑，便于迭代 UI 草图、素材和设计方案
- 在聊天界面和插件预览中直接查看生成结果，减少来回切换
- 将生成结果保存到项目文件，便于继续引用、提交或协作
- 支持将文件拖拽到上下文中，快速补充任务背景
- 支持通过命令或快捷操作把当前文件、已打开文件和选中代码加入上下文
- 提供独立输入区，便于整理、修改和扩展提示词

## 生图配置要点

- 需要先在 OpenCode 中配置支持图片生成的 provider / model，相关能力才会在工作流中可用
- 图片生成功能是否可用，取决于当前 OpenCode 模型配置是否支持对应能力
- 如果要基于已有图片继续编辑，需要先提供现有图片作为输入
- 生成结果会进入当前工作流，并保存到项目中的 `.opencode/generated-images/`，便于后续继续引用

## 重要说明

这是非官方插件。请只安装一个 OpenCode IDE 变体，避免重复功能或行为冲突。

## 标准版说明

当前发布的是 standard variant。它会为受支持平台内置 OpenCode backend，并在本地运行时自动启动。

## 适用人群

这个插件面向已经在使用 OpenCode 的开发者，适合希望留在 IDE 内完成聊天、上下文管理、图片生成与本地 AI 编码工作的用户。
```

- [ ] **Step 3: 运行同步检查，确认生成产物已经过期**

Run: `bun run release-content:check`

Expected: FAIL，错误包含 `Generated release content is out of date`，并列出至少以下文件中的一部分：

```text
hosts/vscode-plugin/README.md
hosts/jetbrains-plugin/README.md
hosts/jetbrains-plugin/description.html
```

- [ ] **Step 4: 提交共享文案源修改**

```bash
git add docs/release-content/README.shared.md docs/release-content/description.shared.md
git commit -m "docs(release): refresh shared plugin copy for image workflows"
```

### Task 2: 同步并检查平台产物

**Files:**

- Modify: `hosts/vscode-plugin/README.md`
- Modify: `hosts/jetbrains-plugin/README.md`
- Modify: `hosts/jetbrains-plugin/description.html`

- [ ] **Step 1: 运行统一同步脚本生成平台文案产物**

Run: `bun run release-content:sync`

Expected: PASS，输出：

```text
updated 6 release content files
```

- [ ] **Step 2: 核对生成后的 VSCode README 是否包含中文小节和平台尾注**

需要在 `hosts/vscode-plugin/README.md` 中确认至少出现以下内容：

```md
## 生图配置要点

- 需要先在 OpenCode 中配置支持图片生成的 provider / model，相关能力才会在工作流中可用
```

以及自动追加的平台尾注：

```md
## Platform note

This package is published as a VSCode extension and integrates OpenCode into the activity bar, Explorer context menu, and editor context menu.
```

- [ ] **Step 3: 核对生成后的 JetBrains 描述是否保留英文首句并转换出中文 HTML 小节**

需要在 `hosts/jetbrains-plugin/description.html` 中确认至少出现以下内容：

```html
OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, image generation,
and bundled backend binaries.

<h2>生图配置要点</h2>
```

并确认包含生成目录说明：

```html
<code>.opencode/generated-images/</code>
```

- [ ] **Step 4: 再次运行同步检查，确认产物已经回到一致状态**

Run: `bun run release-content:check`

Expected: PASS，输出：

```text
release content is in sync
```

- [ ] **Step 5: 提交生成产物修改**

```bash
git add hosts/vscode-plugin/README.md hosts/jetbrains-plugin/README.md hosts/jetbrains-plugin/description.html
git commit -m "docs(release): sync generated marketplace content"
```

### Task 3: 回归验证发布内容链路

**Files:**

- Test: `script/release-content.test.ts`

- [ ] **Step 1: 运行发布内容渲染测试**

Run: `bun test script/release-content.test.ts`

Expected: PASS，并看到类似输出：

```text
pass
6 tests
```

- [ ] **Step 2: 人工确认 `description.shared.md` 第一行仍满足 JetBrains Marketplace 约束**

需要确认 `docs/release-content/description.shared.md` 的第一行仍然是：

```md
OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, image generation, and bundled backend binaries.
```

这一行必须保持以 `OpenCode UI` 开头，不要替换成中文首句。

- [ ] **Step 3: 查看工作区状态，确认只留下预期文案改动**

Run: `git status --short`

Expected: PASS，工作区应为空输出；如果还有未提交改动，只能是以下 5 个文案文件，不应出现额外源代码改动：

```text
docs/release-content/README.shared.md
docs/release-content/description.shared.md
hosts/vscode-plugin/README.md
hosts/jetbrains-plugin/README.md
hosts/jetbrains-plugin/description.html
```

- [ ] **Step 4: 核对最近两次提交是否覆盖源文案与生成产物**

Run: `git log --oneline -2`

Expected: PASS，最近两次提交应分别包含：

```text
docs(release): sync generated marketplace content
docs(release): refresh shared plugin copy for image workflows
```
