# User-Agent UI Suffix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 opencode 发起 provider/API 请求时，将现有 `User-Agent` 扩展为包含 `opencode-ui/<version> (codex app)` 的格式。

**Architecture:** 在 `packages/opencode/src/installation/index.ts` 中集中新增 `userAgent()` helper，负责拼接基础 opencode 产品标识、可选 provider 集成标识、UI 标识与注释。调用点只使用 helper，不再各自硬编码 `opencode/${InstallationVersion}`。

**Tech Stack:** TypeScript、Bun test、现有 opencode provider/plugin/session 代码。

---

## File Structure

- Modify: `packages/opencode/src/installation/index.ts`
  - 新增 `UI_USER_AGENT_PRODUCT`、`USER_AGENT_COMMENT` 与 `userAgent()`。
  - 将现有 `USER_AGENT` 改为基于 helper 生成，保留 channel/client 信息。
- Modify: `packages/opencode/test/installation/installation.test.ts`
  - 为 helper 增加确定性断言，覆盖默认、installation base、integration 与 system comment。
- Modify: `packages/opencode/src/session/llm.ts`
  - 普通聊天请求的 `User-Agent` 使用 `Installation.userAgent()`。
- Modify: `packages/opencode/src/plugin/codex.ts`
  - Codex auth 与 chat header 使用 `Installation.userAgent()`；chat header 使用 `system: true`。
- Modify: `packages/opencode/src/plugin/github-copilot/copilot.ts`
  - GitHub Copilot auth/model/chat 请求使用 `Installation.userAgent()`。
- Modify: `packages/opencode/src/provider/provider.ts`
  - GitLab、Cloudflare Workers AI、Cloudflare AI Gateway 的 provider-specific `User-Agent` 使用 helper 的 `products` 和 `system: true`，保留原有 provider 标识。

## Target Formats

- 默认聊天/API 请求：

```txt
opencode/26.5.700 opencode-ui/26.5.700 (codex app)
```

- installation/model-list 风格请求：

```txt
opencode/latest/26.5.700/vscode opencode-ui/26.5.700 (codex app)
```

- 带 provider 集成与系统信息的请求：

```txt
opencode/26.5.700 gitlab-ai-provider/<version> opencode-ui/26.5.700 (codex app; win32 <release>; x64)
```

### Task 1: Add centralized User-Agent builder

**Files:**

- Modify: `packages/opencode/src/installation/index.ts:1-60`
- Test: `packages/opencode/test/installation/installation.test.ts`

- [ ] **Step 1: Write the failing tests**

Add `os` and `Flag` imports near the top of `packages/opencode/test/installation/installation.test.ts`:

```ts
import os from "os"
import { Flag } from "@opencode-ai/core/flag/flag"
```

Add these tests before the existing `describe("latest", ...)` block inside `describe("installation", () => {`:

```ts
describe("userAgent", () => {
  test("builds the default opencode UI user agent", () => {
    expect(Installation.userAgent()).toBe(
      `opencode/${InstallationVersion} opencode-ui/${InstallationVersion} (codex app)`,
    )
  })

  test("builds the installation-scoped user agent", () => {
    expect(Installation.USER_AGENT).toBe(
      `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT} opencode-ui/${InstallationVersion} (codex app)`,
    )
  })

  test("keeps provider integration products before the UI product", () => {
    expect(Installation.userAgent({ products: ["gitlab-ai-provider/1.2.3"] })).toBe(
      `opencode/${InstallationVersion} gitlab-ai-provider/1.2.3 opencode-ui/${InstallationVersion} (codex app)`,
    )
  })

  test("adds system details to the comment", () => {
    expect(Installation.userAgent({ system: true })).toBe(
      `opencode/${InstallationVersion} opencode-ui/${InstallationVersion} (codex app; ${os.platform()} ${os.release()}; ${os.arch()})`,
    )
  })
})
```

Also add this import to the existing version import line:

```ts
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
```

- [ ] **Step 2: Run the focused test to verify failure**

Run from `packages/opencode`:

```bash
bun test test/installation/installation.test.ts
```

Expected: FAIL because `Installation.userAgent` is not defined and `Installation.USER_AGENT` still lacks `opencode-ui/...`.

- [ ] **Step 3: Implement the helper**

In `packages/opencode/src/installation/index.ts`, add `os` import after the existing imports:

```ts
import os from "os"
```

Replace the existing `USER_AGENT` constant with this block:

```ts
const OPENCODE_USER_AGENT_PRODUCT = `opencode/${InstallationVersion}`
const INSTALLATION_USER_AGENT_PRODUCT = `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`
const UI_USER_AGENT_PRODUCT = `opencode-ui/${InstallationVersion}`
const USER_AGENT_COMMENT = "codex app"

export function userAgent(options?: { base?: "default" | "installation"; products?: string[]; system?: boolean }) {
  const base = options?.base === "installation" ? INSTALLATION_USER_AGENT_PRODUCT : OPENCODE_USER_AGENT_PRODUCT
  const products = [base, ...(options?.products ?? []), UI_USER_AGENT_PRODUCT]
  const comments = [USER_AGENT_COMMENT, ...(options?.system ? [`${os.platform()} ${os.release()}`, os.arch()] : [])]

  return `${products.join(" ")} (${comments.join("; ")})`
}

export const USER_AGENT = userAgent({ base: "installation" })
```

- [ ] **Step 4: Run the focused test to verify pass**

Run from `packages/opencode`:

```bash
bun test test/installation/installation.test.ts
```

Expected: PASS.

### Task 2: Use helper in chat/session and plugins

**Files:**

- Modify: `packages/opencode/src/session/llm.ts:22-23,370-383`
- Modify: `packages/opencode/src/plugin/codex.ts:3-6,522-551,607-611`
- Modify: `packages/opencode/src/plugin/github-copilot/copilot.ts:3-4,69-74,150-154,224-230,254-260`

- [ ] **Step 1: Replace session LLM headers**

In `packages/opencode/src/session/llm.ts`, remove this import:

```ts
import { InstallationVersion } from "@opencode-ai/core/installation/version"
```

Replace both existing session `User-Agent` values:

```ts
"User-Agent": `opencode/${InstallationVersion}`,
```

with:

```ts
"User-Agent": Installation.userAgent(),
```

- [ ] **Step 2: Replace Codex headers**

In `packages/opencode/src/plugin/codex.ts`, remove these imports:

```ts
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import os from "os"
```

Replace both auth flow values:

```ts
"User-Agent": `opencode/${InstallationVersion}`,
```

with:

```ts
"User-Agent": Installation.userAgent(),
```

Replace the chat hook value:

```ts
output.headers["User-Agent"] = `opencode/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`
```

with:

```ts
output.headers["User-Agent"] = Installation.userAgent({ system: true })
```

- [ ] **Step 3: Replace GitHub Copilot headers**

In `packages/opencode/src/plugin/github-copilot/copilot.ts`, replace this import:

```ts
import { InstallationVersion } from "@opencode-ai/core/installation/version"
```

with:

```ts
import { Installation } from "@/installation"
```

Replace every value:

```ts
"User-Agent": `opencode/${InstallationVersion}`,
```

with:

```ts
"User-Agent": Installation.userAgent(),
```

- [ ] **Step 4: Run typecheck for compile errors**

Run from `packages/opencode`:

```bash
bun typecheck
```

Expected: PASS. If it fails with unused imports, remove the reported import and rerun the command.

### Task 3: Use helper in provider-specific headers

**Files:**

- Modify: `packages/opencode/src/provider/provider.ts:1-15,623-625,772-778,841-849`
- Test: existing typecheck coverage

- [ ] **Step 1: Replace provider-specific strings**

In `packages/opencode/src/provider/provider.ts`, add this import near other local imports:

```ts
import { Installation } from "@/installation"
```

Remove these imports if no longer used:

```ts
import os from "os"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
```

Replace GitLab `aiGatewayHeaders` value:

```ts
"User-Agent": `opencode/${InstallationVersion} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
```

with:

```ts
"User-Agent": Installation.userAgent({ products: [`gitlab-ai-provider/${GITLAB_PROVIDER_VERSION}`], system: true }),
```

Replace Cloudflare Workers AI value:

```ts
"User-Agent": `opencode/${InstallationVersion} cloudflare-workers-ai (${os.platform()} ${os.release()}; ${os.arch()})`,
```

with:

```ts
"User-Agent": Installation.userAgent({ products: ["cloudflare-workers-ai"], system: true }),
```

Replace Cloudflare AI Gateway value:

```ts
"User-Agent": `opencode/${InstallationVersion} cloudflare-ai-gateway (${os.platform()} ${os.release()}; ${os.arch()})`,
```

with:

```ts
"User-Agent": Installation.userAgent({ products: ["cloudflare-ai-gateway"], system: true }),
```

- [ ] **Step 2: Run typecheck**

Run from `packages/opencode`:

```bash
bun typecheck
```

Expected: PASS.

### Task 4: Verify focused tests and final status

**Files:**

- Verify only; no new files.

- [ ] **Step 1: Run focused installation tests**

Run from `packages/opencode`:

```bash
bun test test/installation/installation.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package typecheck**

Run from `packages/opencode`:

```bash
bun typecheck
```

Expected: PASS.

- [ ] **Step 3: Review diff**

Run from repository root:

```bash
git diff -- packages/opencode/src/installation/index.ts packages/opencode/test/installation/installation.test.ts packages/opencode/src/session/llm.ts packages/opencode/src/plugin/codex.ts packages/opencode/src/plugin/github-copilot/copilot.ts packages/opencode/src/provider/provider.ts
```

Expected: diff only centralizes `User-Agent` construction and replaces existing opencode API `User-Agent` strings with `Installation.userAgent(...)`.

## Self-Review

- Spec coverage: covers confirmed target format `opencode-ui/26.5.700 (codex app)` and preserves current opencode/provider-specific identifiers.
- Placeholder scan: no TBD/TODO/“similar to” placeholders remain.
- Type consistency: helper name is consistently `Installation.userAgent`, options are consistently `base`, `products`, and `system`.
- Scope: excludes `webfetch` browser UA because that tool intentionally uses a browser-like UA for site compatibility and is not the LLM/provider API path.

## Execution Note

Do not create a git commit during execution unless the user explicitly requests it.
