# Plugin Release Content Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套共享的插件发布内容源与自动同步脚本，让 VSCode 与 JetBrains 在保留发布标识、元数据完整度和版本处理差异的前提下，共用同一份名称主体、描述、README 与 changelog 内容，并在 release workflow 中强制校验同步状态。

**Architecture:** 以 `docs/release-content/` 作为唯一内容源，新增一个纯函数渲染模块和一个同步 CLI，把共享 Markdown / JSON 转成 VSCode 的 Markdown 产物与 `package.json` 文案字段，以及 JetBrains 的 README / HTML 产物。release workflow 只增加一个 `release-content:check` 校验步骤，不改动现有双平台打包与发布骨架。

**Tech Stack:** Bun TypeScript 脚本、Bun test、JSON、Markdown、GitHub Actions YAML

---

## 文件结构

- Create: `docs/release-content/manifest.json`
  - 统一名称主体、短描述、平台尾注

- Create: `docs/release-content/README.shared.md`
  - 双平台共用的 README 主体

- Create: `docs/release-content/description.shared.md`
  - Marketplace 长描述共用主体

- Create: `docs/release-content/CHANGELOG.md`
  - 双平台共用的版本化 changelog

- Create: `script/release-content.ts`
  - 纯函数渲染器 + 共享文件构建逻辑 + `syncReleaseContent()`

- Create: `script/release-content-sync.ts`
  - `bun run release-content:sync` / `bun run release-content:check` 的 CLI 入口

- Create: `script/release-content.test.ts`
  - 渲染器与同步逻辑测试

- Modify: `package.json`
  - 新增 `release-content:sync`、`release-content:check`

- Modify: `hosts/vscode-plugin/package.json`
  - 由同步脚本维护 `displayName` / `description`

- Modify: `hosts/vscode-plugin/README.md`
  - 变为生成产物

- Modify: `hosts/vscode-plugin/CHANGELOG.md`
  - 变为生成产物

- Modify: `hosts/jetbrains-plugin/README.md`
  - 变为生成产物

- Modify: `hosts/jetbrains-plugin/description.html`
  - 由共享 Markdown 生成

- Modify: `hosts/jetbrains-plugin/changelog.html`
  - 由共享 Markdown 生成，仅保留最近版本 HTML

- Modify: `.github/workflows/release.yml`
  - 在 `preflight` 中增加 `bun run release-content:check`

---

### Task 1: 建立共享内容源与纯函数渲染器

**Files:**

- Create: `docs/release-content/manifest.json`
- Create: `docs/release-content/README.shared.md`
- Create: `docs/release-content/description.shared.md`
- Create: `docs/release-content/CHANGELOG.md`
- Create: `script/release-content.ts`
- Test: `script/release-content.test.ts`

- [ ] **Step 1: 先写失败的渲染器测试，锁定统一文案输出格式**

创建 `script/release-content.test.ts`，写入下面的测试代码：

```ts
import { describe, expect, it } from "bun:test"
import {
  applyManifestToVscodePackage,
  extractLatestVersionMarkdown,
  renderJetBrainsChangelogHtml,
  renderJetBrainsDescriptionHtml,
  renderReadme,
  renderVscodeChangelog,
} from "./release-content"

const manifest = {
  title: "OpenCode UI (unofficial)",
  shortDescription:
    "OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, and bundled backend binaries.",
  vscodeReadmeNote:
    "This package is published as a VSCode extension and integrates OpenCode into the activity bar, Explorer context menu, and editor context menu.",
  jetbrainsReadmeNote:
    "This package is published as a JetBrains plugin and integrates OpenCode into the tool window, Project View, and editor popup actions.",
}

const readmeBody = `# OpenCode UI (unofficial)

OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, and bundled backend binaries.

## Core capabilities

- Drag and drop files into context
- Add all opened files to context via command or shortcut
- Add the current file to context via command or shortcut
- Add selected line ranges to context via command or shortcut
- Use a dedicated input area for easier prompt drafting and editing

## Important note

This is an unofficial plugin. Install only one OpenCode IDE variant to avoid duplicate features or conflicting behavior.

## Standard release

The current release track is the standard variant. It bundles the OpenCode backend for supported platforms and launches it locally at runtime.

## Who this is for

This plugin is designed for developers already using OpenCode who want to stay inside the IDE for chat, context management, and local AI coding workflows.
`

const descriptionBody = `OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, and bundled backend binaries.

## Overview

OpenCode UI (unofficial) is an unofficial IDE plugin that brings local OpenCode workflows into the editor. You can open a chat sidebar, refine prompts in place, and move project context into the conversation without bouncing between the IDE and a terminal.

## Core capabilities

- Drag and drop files into context
- Add all opened files to context via command or shortcut
- Add the current file to context via command or shortcut
- Add selected line ranges to context via command or shortcut
- Use a dedicated input area for easier prompt drafting and editing

## Important note

This is an unofficial plugin. Install only one OpenCode IDE variant to avoid duplicate features or conflicting behavior.

## Standard release

The current release track is the standard variant. It bundles the OpenCode backend for supported platforms and launches it locally at runtime.

## Who this is for

This plugin is designed for developers already using OpenCode who want to stay inside the IDE for chat, context management, and local AI coding workflows.
`

const changelogBody = `# Changelog

## v26.5.303

### 近期重点改进
- 补齐 JetBrains 宿主侧能力，持续向 VSCode 端体验对齐。
- 支持 host-aware 重启动作，在不同宿主环境下提供更准确的重启入口。
- 继续完善中文本地化，补齐模型、工具权限、错误提示等关键文案。

### 功能演进概览
- 支持文件拖拽加入上下文、当前文件加入上下文、已打开文件批量加入上下文，以及选中代码行范围加入上下文。
- 完成浏览器式标签体系建设，支持拖拽、重命名、右键菜单、自动滚动与数量限制。
- 引入快捷短语、子任务抽屉、任务进度头与更易编辑的输入区域，提升日常使用效率。
- 统一宿主侧状态持久化策略，改进主题、设置、会话与草稿状态恢复体验。

### 修复与体验优化
- 优化常用短语预设，提升 IDE 内提示词输入效率。
- 增强 WebView 滚动体验并支持 \`jcefScrollMultiplier\` 参数调节滚动灵敏度。
- 改进流式输出、会话恢复、标签状态持久化与长会话稳定性。
- 移除旧的仅界面变体说明，统一标准版单路线发布文案与打包认知。

## v26.4.2903

### 近期重点改进
- 旧版本样本，用于验证 JetBrains changelog 只取最新版本。
`

describe("release content renderers", () => {
  it("renders readme with a generated banner and platform note", () => {
    const output = renderReadme(readmeBody, manifest.vscodeReadmeNote)

    expect(output.startsWith("<!-- Generated by bun run release-content:sync. Do not edit directly. -->")).toBeTrue()
    expect(output).toContain("## Platform note")
    expect(output).toContain(manifest.vscodeReadmeNote)
    expect(output).not.toContain("GUI only")
  })

  it("renders a JetBrains description that starts with the plain short description", () => {
    const output = renderJetBrainsDescriptionHtml(descriptionBody)

    expect(output.startsWith(manifest.shortDescription)).toBeTrue()
    expect(output).toContain("<h2>Overview</h2>")
    expect(output).toContain("<li>Drag and drop files into context</li>")
  })

  it("extracts the latest changelog section and converts it to JetBrains HTML", () => {
    expect(extractLatestVersionMarkdown(changelogBody)).toContain("## v26.5.303")

    const output = renderJetBrainsChangelogHtml(changelogBody)
    expect(output).toContain("<h2>更新内容</h2>")
    expect(output).toContain("<h3>v26.5.303</h3>")
    expect(output).not.toContain("v26.4.2903")
  })

  it("updates only the shared VSCode package metadata fields", () => {
    const output = applyManifestToVscodePackage(
      JSON.stringify({
        name: "opencode-ui",
        publisher: "caiqy",
        version: "26.5.100",
        displayName: "Old",
        description: "Old",
      }),
      manifest,
    )

    const pkg = JSON.parse(output)
    expect(pkg.name).toBe("opencode-ui")
    expect(pkg.publisher).toBe("caiqy")
    expect(pkg.displayName).toBe(manifest.title)
    expect(pkg.description).toBe(manifest.shortDescription)
  })

  it("renders the shared changelog for VSCode as markdown with a generated banner", () => {
    const output = renderVscodeChangelog(changelogBody)

    expect(output.startsWith("<!-- Generated by bun run release-content:sync. Do not edit directly. -->")).toBeTrue()
    expect(output).toContain("## v26.5.303")
    expect(output).toContain("### 修复与体验优化")
  })
})
```

- [ ] **Step 2: 运行测试，确认当前因缺少实现而失败**

Run（仓库根目录）:

```bash
bun test script/release-content.test.ts
```

Expected:

```text
error: Cannot find module './release-content'
```

- [ ] **Step 3: 写入共享内容源与纯函数渲染器的最小实现**

创建 `docs/release-content/manifest.json`：

```json
{
  "title": "OpenCode UI (unofficial)",
  "shortDescription": "OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, and bundled backend binaries.",
  "vscodeReadmeNote": "This package is published as a VSCode extension and integrates OpenCode into the activity bar, Explorer context menu, and editor context menu.",
  "jetbrainsReadmeNote": "This package is published as a JetBrains plugin and integrates OpenCode into the tool window, Project View, and editor popup actions."
}
```

创建 `docs/release-content/README.shared.md`：

```md
# OpenCode UI (unofficial)

OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, and bundled backend binaries.

## Core capabilities

- Drag and drop files into context
- Add all opened files to context via command or shortcut
- Add the current file to context via command or shortcut
- Add selected line ranges to context via command or shortcut
- Use a dedicated input area for easier prompt drafting and editing

## Important note

This is an unofficial plugin. Install only one OpenCode IDE variant to avoid duplicate features or conflicting behavior.

## Standard release

The current release track is the standard variant. It bundles the OpenCode backend for supported platforms and launches it locally at runtime.

## Who this is for

This plugin is designed for developers already using OpenCode who want to stay inside the IDE for chat, context management, and local AI coding workflows.
```

创建 `docs/release-content/description.shared.md`：

```md
OpenCode UI (unofficial) brings local OpenCode AI workflows into IDEs with chat, context management, and bundled backend binaries.

## Overview

OpenCode UI (unofficial) is an unofficial IDE plugin that brings local OpenCode workflows into the editor. You can open a chat sidebar, refine prompts in place, and move project context into the conversation without bouncing between the IDE and a terminal.

## Core capabilities

- Drag and drop files into context
- Add all opened files to context via command or shortcut
- Add the current file to context via command or shortcut
- Add selected line ranges to context via command or shortcut
- Use a dedicated input area for easier prompt drafting and editing

## Important note

This is an unofficial plugin. Install only one OpenCode IDE variant to avoid duplicate features or conflicting behavior.

## Standard release

The current release track is the standard variant. It bundles the OpenCode backend for supported platforms and launches it locally at runtime.

## Who this is for

This plugin is designed for developers already using OpenCode who want to stay inside the IDE for chat, context management, and local AI coding workflows.
```

创建 `docs/release-content/CHANGELOG.md`：

```md
# Changelog

## v26.5.303

### 近期重点改进

- 补齐 JetBrains 宿主侧能力，持续向 VSCode 端体验对齐。
- 支持 host-aware 重启动作，在不同宿主环境下提供更准确的重启入口。
- 继续完善中文本地化，补齐模型、工具权限、错误提示等关键文案。

### 功能演进概览

- 支持文件拖拽加入上下文、当前文件加入上下文、已打开文件批量加入上下文，以及选中代码行范围加入上下文。
- 完成浏览器式标签体系建设，支持拖拽、重命名、右键菜单、自动滚动与数量限制。
- 引入快捷短语、子任务抽屉、任务进度头与更易编辑的输入区域，提升日常使用效率。
- 统一宿主侧状态持久化策略，改进主题、设置、会话与草稿状态恢复体验。

### 修复与体验优化

- 优化常用短语预设，提升 IDE 内提示词输入效率。
- 增强 WebView 滚动体验并支持 `jcefScrollMultiplier` 参数调节滚动灵敏度。
- 改进流式输出、会话恢复、标签状态持久化与长会话稳定性。
- 移除旧的仅界面变体说明，统一标准版单路线发布文案与打包认知。
```

创建 `script/release-content.ts`：

```ts
import { readFile } from "node:fs/promises"
import path from "node:path"

export type ReleaseContentManifest = {
  title: string
  shortDescription: string
  vscodeReadmeNote: string
  jetbrainsReadmeNote: string
}

export const generatedBanner = "<!-- Generated by bun run release-content:sync. Do not edit directly. -->"

const normalize = (text: string) => text.trim().replace(/\r\n/g, "\n")

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const renderInline = (text: string) =>
  escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => `<code>${escapeHtml(code)}</code>`)

const markdownToHtml = (markdown: string) => {
  const html: string[] = []
  const lines = normalize(markdown).split("\n")
  const paragraph: string[] = []
  const list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`)
    paragraph.length = 0
  }

  const flushList = () => {
    if (list.length === 0) return
    html.push(`<ul>\n${list.map((item) => `  <li>${renderInline(item)}</li>`).join("\n")}\n</ul>`)
    list.length = 0
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.startsWith("- ")) {
      flushParagraph()
      list.push(line.slice(2))
      continue
    }

    flushList()

    if (line.startsWith("### ")) {
      flushParagraph()
      html.push(`<h3>${renderInline(line.slice(4))}</h3>`)
      continue
    }

    if (line.startsWith("## ")) {
      flushParagraph()
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`)
      continue
    }

    if (line.startsWith("# ")) {
      flushParagraph()
      html.push(`<h1>${renderInline(line.slice(2))}</h1>`)
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  flushList()

  return `${html.join("\n\n")}\n`
}

export const renderReadme = (body: string, platformNote: string) =>
  `${generatedBanner}\n\n${normalize(body)}\n\n## Platform note\n\n${platformNote.trim()}\n`

export const renderVscodeChangelog = (markdown: string) => `${generatedBanner}\n\n${normalize(markdown)}\n`

export const extractLatestVersionMarkdown = (markdown: string) => {
  const normalized = normalize(markdown)
  const matches = [...normalized.matchAll(/^##\s+v[^\n]+$/gm)]
  if (matches.length === 0) throw new Error("Shared changelog is missing a version heading")
  const start = matches[0]?.index ?? 0
  const end = matches[1]?.index ?? normalized.length
  return normalized.slice(start, end).trim()
}

export const renderJetBrainsDescriptionHtml = (markdown: string) => {
  const lines = normalize(markdown).split("\n")
  const lead = lines.shift()?.trim() ?? ""
  const rest = lines.join("\n").trim()
  return rest ? `${lead}\n\n${markdownToHtml(rest)}` : `${lead}\n`
}

export const renderJetBrainsChangelogHtml = (markdown: string) => {
  const latest = extractLatestVersionMarkdown(markdown).replace(/^##\s+/m, "### ")
  return `<h2>更新内容</h2>\n\n${markdownToHtml(latest)}`
}

export const applyManifestToVscodePackage = (packageText: string, manifest: ReleaseContentManifest) => {
  const pkg = JSON.parse(packageText)
  pkg.displayName = manifest.title
  pkg.description = manifest.shortDescription
  return `${JSON.stringify(pkg, null, 2)}\n`
}

export const loadSharedReleaseContent = async (root: string) => {
  const read = (filePath: string) => readFile(path.join(root, filePath), "utf8")
  const manifest = JSON.parse(await read("docs/release-content/manifest.json")) as ReleaseContentManifest

  return {
    manifest,
    readme: await read("docs/release-content/README.shared.md"),
    description: await read("docs/release-content/description.shared.md"),
    changelog: await read("docs/release-content/CHANGELOG.md"),
  }
}
```

- [ ] **Step 4: 重跑测试，确认渲染器和共享源最小实现通过**

Run（仓库根目录）:

```bash
bun test script/release-content.test.ts
```

Expected:

```text
5 pass
```

- [ ] **Step 5: 提交共享内容源与渲染器基础实现**

```bash
git add docs/release-content script/release-content.ts script/release-content.test.ts
git commit -m "feat: add shared plugin release content sources"
```

---

### Task 2: 实现同步 CLI，并生成双平台产物

**Files:**

- Modify: `script/release-content.ts`
- Create: `script/release-content-sync.ts`
- Modify: `script/release-content.test.ts`
- Modify: `package.json`
- Modify: `hosts/vscode-plugin/package.json`
- Modify: `hosts/vscode-plugin/README.md`
- Modify: `hosts/vscode-plugin/CHANGELOG.md`
- Modify: `hosts/jetbrains-plugin/README.md`
- Modify: `hosts/jetbrains-plugin/description.html`
- Modify: `hosts/jetbrains-plugin/changelog.html`

- [ ] **Step 1: 扩展失败的集成测试，锁定 sync / check 行为和产物路径**

先把 `script/release-content.test.ts` 顶部的 import 改成下面这样，再把后续的 `beforeEach` / `afterEach` / `describe("syncReleaseContent", ...)` 测试块追加到文件末尾：

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  applyManifestToVscodePackage,
  extractLatestVersionMarkdown,
  renderJetBrainsChangelogHtml,
  renderJetBrainsDescriptionHtml,
  renderReadme,
  renderVscodeChangelog,
  syncReleaseContent,
} from "./release-content"
```

然后把下面这段测试块追加到 `script/release-content.test.ts` 末尾：

```ts
let tempRoot = ""

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "release-content-"))

  await mkdir(path.join(tempRoot, "docs/release-content"), { recursive: true })
  await mkdir(path.join(tempRoot, "hosts/vscode-plugin"), { recursive: true })
  await mkdir(path.join(tempRoot, "hosts/jetbrains-plugin"), { recursive: true })

  await writeFile(path.join(tempRoot, "docs/release-content/manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  await writeFile(path.join(tempRoot, "docs/release-content/README.shared.md"), readmeBody + "\n")
  await writeFile(path.join(tempRoot, "docs/release-content/description.shared.md"), descriptionBody + "\n")
  await writeFile(path.join(tempRoot, "docs/release-content/CHANGELOG.md"), changelogBody + "\n")
  await writeFile(
    path.join(tempRoot, "hosts/vscode-plugin/package.json"),
    JSON.stringify(
      {
        name: "opencode-ui",
        publisher: "caiqy",
        version: "26.5.100",
        displayName: "stale",
        description: "stale",
      },
      null,
      2,
    ) + "\n",
  )
  await writeFile(path.join(tempRoot, "hosts/vscode-plugin/README.md"), "stale\n")
  await writeFile(path.join(tempRoot, "hosts/vscode-plugin/CHANGELOG.md"), "stale\n")
  await writeFile(path.join(tempRoot, "hosts/jetbrains-plugin/README.md"), "stale\n")
  await writeFile(path.join(tempRoot, "hosts/jetbrains-plugin/description.html"), "stale\n")
  await writeFile(path.join(tempRoot, "hosts/jetbrains-plugin/changelog.html"), "stale\n")
})

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
})

describe("syncReleaseContent", () => {
  it("writes generated files for both platforms", async () => {
    await syncReleaseContent(tempRoot)

    const vscodeReadme = await readFile(path.join(tempRoot, "hosts/vscode-plugin/README.md"), "utf8")
    const vscodePackage = JSON.parse(await readFile(path.join(tempRoot, "hosts/vscode-plugin/package.json"), "utf8"))
    const jetbrainsDescription = await readFile(path.join(tempRoot, "hosts/jetbrains-plugin/description.html"), "utf8")
    const jetbrainsChangelog = await readFile(path.join(tempRoot, "hosts/jetbrains-plugin/changelog.html"), "utf8")

    expect(vscodeReadme).toContain("## Platform note")
    expect(vscodeReadme).not.toContain("GUI only")
    expect(vscodePackage.displayName).toBe(manifest.title)
    expect(vscodePackage.description).toBe(manifest.shortDescription)
    expect(jetbrainsDescription.startsWith(manifest.shortDescription)).toBeTrue()
    expect(jetbrainsChangelog).toContain("<h2>更新内容</h2>")
    expect(jetbrainsChangelog).not.toContain("v26.4.2903")
  })

  it("fails check mode when generated outputs are stale", async () => {
    await expect(syncReleaseContent(tempRoot, { check: true })).rejects.toThrow(
      "Generated release content is out of date",
    )
  })
})
```

- [ ] **Step 2: 运行测试，确认当前因缺少 sync 实现而失败**

Run（仓库根目录）:

```bash
bun test script/release-content.test.ts
```

Expected:

```text
TypeError: syncReleaseContent is not a function
```

- [ ] **Step 3: 扩展渲染模块，补齐同步逻辑、CLI 与根脚本入口**

把 `script/release-content.ts` 替换为下面这个完整版本：

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

export type ReleaseContentManifest = {
  title: string
  shortDescription: string
  vscodeReadmeNote: string
  jetbrainsReadmeNote: string
}

export type SyncOptions = {
  check?: boolean
}

export const generatedBanner = "<!-- Generated by bun run release-content:sync. Do not edit directly. -->"

const normalize = (text: string) => text.trim().replace(/\r\n/g, "\n")

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const renderInline = (text: string) =>
  escapeHtml(text).replace(/`([^`]+)`/g, (_match, code) => `<code>${escapeHtml(code)}</code>`)

const markdownToHtml = (markdown: string) => {
  const html: string[] = []
  const lines = normalize(markdown).split("\n")
  const paragraph: string[] = []
  const list: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`)
    paragraph.length = 0
  }

  const flushList = () => {
    if (list.length === 0) return
    html.push(`<ul>\n${list.map((item) => `  <li>${renderInline(item)}</li>`).join("\n")}\n</ul>`)
    list.length = 0
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }

    if (line.startsWith("- ")) {
      flushParagraph()
      list.push(line.slice(2))
      continue
    }

    flushList()

    if (line.startsWith("### ")) {
      flushParagraph()
      html.push(`<h3>${renderInline(line.slice(4))}</h3>`)
      continue
    }

    if (line.startsWith("## ")) {
      flushParagraph()
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`)
      continue
    }

    if (line.startsWith("# ")) {
      flushParagraph()
      html.push(`<h1>${renderInline(line.slice(2))}</h1>`)
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  flushList()

  return `${html.join("\n\n")}\n`
}

export const renderReadme = (body: string, platformNote: string) =>
  `${generatedBanner}\n\n${normalize(body)}\n\n## Platform note\n\n${platformNote.trim()}\n`

export const renderVscodeChangelog = (markdown: string) => `${generatedBanner}\n\n${normalize(markdown)}\n`

export const extractLatestVersionMarkdown = (markdown: string) => {
  const normalized = normalize(markdown)
  const matches = [...normalized.matchAll(/^##\s+v[^\n]+$/gm)]
  if (matches.length === 0) throw new Error("Shared changelog is missing a version heading")
  const start = matches[0]?.index ?? 0
  const end = matches[1]?.index ?? normalized.length
  return normalized.slice(start, end).trim()
}

export const renderJetBrainsDescriptionHtml = (markdown: string) => {
  const lines = normalize(markdown).split("\n")
  const lead = lines.shift()?.trim() ?? ""
  const rest = lines.join("\n").trim()
  return rest ? `${lead}\n\n${markdownToHtml(rest)}` : `${lead}\n`
}

export const renderJetBrainsChangelogHtml = (markdown: string) => {
  const latest = extractLatestVersionMarkdown(markdown).replace(/^##\s+/m, "### ")
  return `<h2>更新内容</h2>\n\n${markdownToHtml(latest)}`
}

export const applyManifestToVscodePackage = (packageText: string, manifest: ReleaseContentManifest) => {
  const pkg = JSON.parse(packageText)
  pkg.displayName = manifest.title
  pkg.description = manifest.shortDescription
  return `${JSON.stringify(pkg, null, 2)}\n`
}

const loadSharedReleaseContent = async (root: string) => {
  const read = (filePath: string) => readFile(path.join(root, filePath), "utf8")
  const manifest = JSON.parse(await read("docs/release-content/manifest.json")) as ReleaseContentManifest

  return {
    manifest,
    readme: await read("docs/release-content/README.shared.md"),
    description: await read("docs/release-content/description.shared.md"),
    changelog: await read("docs/release-content/CHANGELOG.md"),
    vscodePackage: await read("hosts/vscode-plugin/package.json"),
  }
}

export const buildReleaseContentFiles = async (root: string) => {
  const { manifest, readme, description, changelog, vscodePackage } = await loadSharedReleaseContent(root)

  return new Map<string, string>([
    [path.join(root, "hosts/vscode-plugin/README.md"), renderReadme(readme, manifest.vscodeReadmeNote)],
    [path.join(root, "hosts/vscode-plugin/CHANGELOG.md"), renderVscodeChangelog(changelog)],
    [path.join(root, "hosts/vscode-plugin/package.json"), applyManifestToVscodePackage(vscodePackage, manifest)],
    [path.join(root, "hosts/jetbrains-plugin/README.md"), renderReadme(readme, manifest.jetbrainsReadmeNote)],
    [path.join(root, "hosts/jetbrains-plugin/description.html"), renderJetBrainsDescriptionHtml(description)],
    [path.join(root, "hosts/jetbrains-plugin/changelog.html"), renderJetBrainsChangelogHtml(changelog)],
  ])
}

export const syncReleaseContent = async (root: string, options: SyncOptions = {}) => {
  const files = await buildReleaseContentFiles(root)
  const stale: string[] = []

  for (const [filePath, expected] of files) {
    let current = ""
    try {
      current = await readFile(filePath, "utf8")
    } catch {
      current = ""
    }

    if (current === expected) continue

    if (options.check) {
      stale.push(path.relative(root, filePath))
      continue
    }

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, expected)
  }

  if (stale.length > 0) {
    throw new Error(`Generated release content is out of date:\n${stale.join("\n")}`)
  }

  if (options.check) {
    console.log("release content is in sync")
    return
  }

  console.log(`updated ${files.size} release content files`)
}
```

创建 `script/release-content-sync.ts`：

```ts
#!/usr/bin/env bun

import { syncReleaseContent } from "./release-content"

const check = Bun.argv.includes("--check")

await syncReleaseContent(process.cwd(), { check })
```

把根 `package.json` 的 `scripts` 段在 `"prepare": "husky"` 与 `"random": "echo 'Random script'"` 之间调整为下面这样：

```json
{
  "scripts": {
    "dev": "bun run --cwd packages/opencode --conditions=browser src/index.ts",
    "dev:desktop": "bun --cwd packages/desktop-electron dev",
    "dev:web": "bun --cwd packages/app dev",
    "dev:console": "ulimit -n 10240 2>/dev/null; bun run --cwd packages/console/app dev",
    "dev:storybook": "bun --cwd packages/storybook storybook",
    "lint": "oxlint",
    "typecheck": "bun turbo typecheck",
    "postinstall": "bun run --cwd packages/opencode fix-node-pty",
    "prepare": "husky",
    "release-content:sync": "bun script/release-content-sync.ts",
    "release-content:check": "bun script/release-content-sync.ts --check",
    "random": "echo 'Random script'",
    "hello": "echo 'Hello World!'",
    "test": "echo 'do not run tests from root' && exit 1"
  }
}
```

- [ ] **Step 4: 运行测试，确认 sync / check 都按预期工作**

Run（仓库根目录）:

```bash
bun test script/release-content.test.ts
```

Expected:

```text
7 pass
```

- [ ] **Step 5: 运行同步脚本，生成仓库内的双平台产物**

Run（仓库根目录）:

```bash
bun run release-content:sync
```

Expected:

```text
updated 6 release content files
```

- [ ] **Step 6: 用一次结构断言检查实际产物，确认旧文案已被移除且两端内容已对齐**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const read=(p)=>fs.readFileSync(p,'utf8'); const files=['hosts/vscode-plugin/README.md','hosts/vscode-plugin/CHANGELOG.md','hosts/jetbrains-plugin/README.md','hosts/jetbrains-plugin/description.html','hosts/jetbrains-plugin/changelog.html']; for (const file of files) { if (!fs.existsSync(file)) throw new Error('missing '+file) } const vscodeReadme=read('hosts/vscode-plugin/README.md'); const jetbrainsReadme=read('hosts/jetbrains-plugin/README.md'); const vscodePkg=JSON.parse(read('hosts/vscode-plugin/package.json')); const jetbrainsDescription=read('hosts/jetbrains-plugin/description.html'); const jetbrainsChangelog=read('hosts/jetbrains-plugin/changelog.html'); if (/GUI only/i.test(vscodeReadme) || /GUI only/i.test(jetbrainsReadme)) throw new Error('stale gui-only copy remains'); if (!vscodeReadme.includes('## Platform note')) throw new Error('missing vscode platform note'); if (!jetbrainsReadme.includes('## Platform note')) throw new Error('missing jetbrains platform note'); if (vscodePkg.displayName !== 'OpenCode UI (unofficial)') throw new Error('unexpected vscode displayName'); if (!jetbrainsDescription.startsWith('OpenCode UI (unofficial)')) throw new Error('unexpected jetbrains description lead'); if (!jetbrainsChangelog.includes('<h2>更新内容</h2>')) throw new Error('unexpected jetbrains changelog heading'); console.log('release content sync outputs ok')"
```

Expected:

```text
release content sync outputs ok
```

- [ ] **Step 7: 提交同步 CLI、根脚本与生成产物**

```bash
git add package.json script/release-content.ts script/release-content-sync.ts script/release-content.test.ts hosts/vscode-plugin/package.json hosts/vscode-plugin/README.md hosts/vscode-plugin/CHANGELOG.md hosts/jetbrains-plugin/README.md hosts/jetbrains-plugin/description.html hosts/jetbrains-plugin/changelog.html
git commit -m "build: sync plugin release content from shared sources"
```

---

### Task 3: 在 release workflow 中强制校验发布内容已同步

**Files:**

- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 先写失败的 workflow 结构断言，锁定 preflight 必须执行 release-content:check**

在仓库根目录准备并执行下面这条断言命令；它要求 `preflight` job 在 `Set up Bun` 之后包含 `Verify release content sync` 步骤，并调用 `bun run release-content:check`。当前 workflow 还没有这个步骤，预期失败。

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if(!/preflight:[\s\S]*Set up Bun[\s\S]*Verify release content sync[\s\S]*bun run release-content:check/m.test(text)) throw new Error('missing release content check step'); console.log('release workflow sync gate ok')"
```

- [ ] **Step 2: 运行断言命令，确认当前确实失败**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if(!/preflight:[\s\S]*Set up Bun[\s\S]*Verify release content sync[\s\S]*bun run release-content:check/m.test(text)) throw new Error('missing release content check step'); console.log('release workflow sync gate ok')"
```

Expected:

```text
Error: missing release content check step
```

- [ ] **Step 3: 在 preflight 中增加同步校验步骤，不改动现有构建 / 发布主链路**

把 `.github/workflows/release.yml` 的 `preflight` job 在 `Set up Bun` 与 `Replay gate before release` 之间调整为下面这样：

```yml
preflight:
  runs-on: ubuntu-latest
  outputs:
    version: ${{ steps.version.outputs.version }}
    version_number: ${{ steps.version.outputs.version_number }}
    vscode_version: ${{ steps.version.outputs.vscode_version }}
    prerelease: ${{ steps.version.outputs.prerelease }}
  steps:
    - name: Checkout
      uses: actions/checkout@v4

    - name: Set up Bun
      uses: ./.github/actions/setup-bun

    - name: Verify release content sync
      run: bun run release-content:check

    - name: Replay gate before release
      run: bun --cwd packages/opencode run test:anthropic:replay
```

- [ ] **Step 4: 先重跑 workflow 结构断言，再运行本地 check 命令，确认同步校验可独立通过**

Run（仓库根目录）:

```bash
node -e "const fs=require('fs'); const text=fs.readFileSync('.github/workflows/release.yml','utf8'); if(!/preflight:[\s\S]*Set up Bun[\s\S]*Verify release content sync[\s\S]*bun run release-content:check/m.test(text)) throw new Error('missing release content check step'); console.log('release workflow sync gate ok')"
bun run release-content:check
```

Expected:

```text
release workflow sync gate ok
release content is in sync
```

- [ ] **Step 5: 提交 release workflow 的同步校验闸门**

```bash
git add .github/workflows/release.yml
git commit -m "ci: verify shared plugin release content in preflight"
```

---

### Task 4: 做最终验证，确保计划覆盖的行为全部落地

**Files:**

- Modify: `docs/release-content/*`
- Modify: `script/release-content.ts`
- Modify: `script/release-content-sync.ts`
- Modify: `script/release-content.test.ts`
- Modify: `package.json`
- Modify: `hosts/vscode-plugin/*`
- Modify: `hosts/jetbrains-plugin/*`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 运行渲染器测试，确认共享源、渲染器、sync/check 一起工作**

Run（仓库根目录）:

```bash
bun test script/release-content.test.ts
```

Expected:

```text
7 pass
```

- [ ] **Step 2: 运行同步检查，确认仓库当前产物无漂移**

Run（仓库根目录）:

```bash
bun run release-content:check
```

Expected:

```text
release content is in sync
```

- [ ] **Step 3: 用 git status 确认除计划内文件外没有额外脏改动**

Run（仓库根目录）:

```bash
git status --short
```

Expected:

```text
只出现 docs/release-content、script/release-content*、package.json、hosts/vscode-plugin、hosts/jetbrains-plugin、.github/workflows/release.yml 等计划内文件变更
```

- [ ] **Step 4: 提交最终收尾检查点**

```bash
git add docs/release-content script/release-content.ts script/release-content-sync.ts script/release-content.test.ts package.json hosts/vscode-plugin/package.json hosts/vscode-plugin/README.md hosts/vscode-plugin/CHANGELOG.md hosts/jetbrains-plugin/README.md hosts/jetbrains-plugin/description.html hosts/jetbrains-plugin/changelog.html .github/workflows/release.yml
git commit -m "feat: unify plugin release content workflow"
```
