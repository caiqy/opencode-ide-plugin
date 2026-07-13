---
change: restore-ui-user-agent
design-doc: docs/superpowers/specs/2026-07-13-restore-ui-user-agent-design.md
base-ref: 1f2cdf59fa1f59ff019d381827ba2ae1ef42ecd7
---

# 恢复 UI User-Agent 实施计划

> **供执行代理使用：** 必须逐项执行并使用复选框跟踪。实现前阅读设计文档 `docs/superpowers/specs/2026-07-13-restore-ui-user-agent-design.md`；其 OpenSpec delta spec 是行为验收的唯一事实源。

**目标：** 为 OpenCode 自己构造的出站 User-Agent 加回 `opencode-ui/<version>`，且不改变第三方、provider 或用户后置覆盖的 User-Agent。

**架构：** 在 Core 的 `installation/` 中放置无副作用的 `customizeUserAgent` 纯函数，作为所有 `opencode/...` 出站 UA 的最低层规则。OpenCode Installation 继续负责 channel/version/client、附加产品和系统 comment 的组合，再将结果交给 Core 定制；调用方仅选用 Core helper、`Installation.USER_AGENT` 或 `Installation.userAgent(options)`。

**技术栈：** TypeScript、Bun test、Effect HTTP、原生 Fetch `Headers`。

## 全局约束

- 仅处理首个空白分隔 token 以 `opencode/` 开头的完整 UA；空串、裸 `opencode`、第三方首 token 和已有 `opencode-ui/*` 的完整字符串必须原样返回。
- UI 版本取显式参数或调用时的 `OPENCODE_UI_VERSION.trim()`；缺失或纯空白时回退 `InstallationVersion`，不做额外校验或编码。
- UI token 必须位于所有产品 token 的末尾、首个 comment `(` 之前；不解析或重写 comment，也不添加 `(codex app)`。
- Core 不得依赖 `packages/opencode`；不新增运行时依赖、协议、数据库迁移或 SDK 变更。
- 默认 OpenCode UA 在默认 headers 阶段写入；model/provider/plugin/user headers 后合并，因此后置第三方 UA 必须获胜且不得被定制。
- 不迁移 `packages/console`、`packages/*/src/tool/webfetch.ts` 的裸 `opencode` 兼容性 UA，或 SDK/provider 后续合并产生的 UA。
- 测试不可在仓库根目录执行；类型检查必须分别在 `packages/core` 和 `packages/opencode` 中执行。

## 文件结构

- 新建 `packages/core/src/installation/user-agent.ts`：纯 UA 定制函数及 Core 自导出。
- 新建 `packages/core/test/installation/user-agent.test.ts`：表驱动 Core 契约回归测试。
- 修改 `packages/opencode/src/installation/index.ts`：保留 Installation 组合入口并调用 Core helper。
- 修改 `packages/opencode/test/installation/installation.test.ts`：验证 OpenCode 的 base/products/UI/comment 组合顺序。
- 修改 Core 出站构造点：`src/models-dev.ts`、`src/tool/websearch.ts`、`src/plugin/provider/{cloudflare-workers-ai,cloudflare-ai-gateway,gitlab,openai}.ts`。
- 修改 OpenCode 出站构造点：`src/provider/{models,provider}.ts`、`src/session/llm/request.ts`、`src/tool/websearch.ts`、`src/plugin/{xai,snowflake-cortex,digitalocean}.ts`、`src/plugin/openai/codex.ts`、`src/plugin/github-copilot/copilot.ts`。
- 修改回归测试：`packages/core/test/plugin/models-dev.test.ts`、`packages/opencode/test/plugin/{xai,snowflake-cortex,github-copilot-models}.test.ts`。

### Task 1: Core User-Agent 纯函数

**文件：**
- 新建：`packages/core/src/installation/user-agent.ts`
- 新建：`packages/core/test/installation/user-agent.test.ts`

**接口：**
- 产出：`customizeUserAgent(userAgent: string, uiVersion?: string): string`
- 依赖：`InstallationVersion`，来自 `@opencode-ai/core/installation/version`。

- [x] **步骤 1：编写失败的表驱动测试**

```ts
import { describe, expect, test } from "bun:test"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { customizeUserAgent } from "@opencode-ai/core/installation/user-agent"

describe("customizeUserAgent", () => {
  test.each([
    ["", "9", ""],
    ["opencode", "9", "opencode"],
    ["third-party/1 opencode/2", "9", "third-party/1 opencode/2"],
    ["opencode/2", "9", "opencode/2 opencode-ui/9"],
    ["opencode/2 opencode-ui/old", "9", "opencode/2 opencode-ui/old"],
    ["opencode/2 provider/1 (linux x64)", " 9 ", "opencode/2 provider/1 opencode-ui/9 (linux x64)"],
    ["opencode/2", "   ", `opencode/2 opencode-ui/${InstallationVersion}`],
  ])("customizes %p", (input, version, expected) => {
    expect(customizeUserAgent(input, version)).toBe(expected)
  })
})
```

- [x] **步骤 2：运行测试确认 RED**

运行：在 `packages/core` 中执行 `bun test test/installation/user-agent.test.ts`

预期：FAIL，报错无法解析 `@opencode-ai/core/installation/user-agent` 或未导出 `customizeUserAgent`。

- [x] **步骤 3：实现最小纯函数**

在 `packages/core/src/installation/user-agent.ts` 添加以下实现；使用首 token 和产品 token 的空白分隔检查，不修改输入已有内容：

```ts
import { InstallationVersion } from "./version"

export function customizeUserAgent(userAgent: string, uiVersion = process.env.OPENCODE_UI_VERSION) {
  const [first] = userAgent.trimStart().split(/\s+/, 1)
  if (!first?.startsWith("opencode/")) return userAgent
  if (userAgent.split(/\s+/).some((token) => token.startsWith("opencode-ui/"))) return userAgent

  const version = uiVersion?.trim() || InstallationVersion
  const comment = userAgent.indexOf("(")
  if (comment === -1) return `${userAgent} opencode-ui/${version}`
  return `${userAgent.slice(0, comment).trimEnd()} opencode-ui/${version} ${userAgent.slice(comment)}`
}

export * as UserAgent from "./user-agent"
```

- [x] **步骤 4：运行测试确认 GREEN**

运行：在 `packages/core` 中执行 `bun test test/installation/user-agent.test.ts`

预期：PASS，7 个用例均通过，包含 comment 前插入和空白版本回退。

- [x] **步骤 5：提交**

```bash
git add packages/core/src/installation/user-agent.ts packages/core/test/installation/user-agent.test.ts
git commit -m "feat(core): customize opencode user agent"
```

### Task 2: OpenCode Installation 组合入口

**文件：**
- 修改：`packages/opencode/src/installation/index.ts:14,41-45`
- 修改：`packages/opencode/test/installation/installation.test.ts:1-13,70`

**接口：**
- 消费：`customizeUserAgent(userAgent: string, uiVersion?: string): string`。
- 产出：`userAgent(options?: { client?: string; products?: string[]; system?: string }): string` 和无参启动快照 `USER_AGENT`。

- [x] **步骤 1：编写失败的组合顺序测试**

在 `describe("installation")` 首部添加：

```ts
testEffect(Layer.empty).effect("combines client products UI token and system comment in order", () =>
  Effect.sync(() => {
    expect(Installation.userAgent({ client: "app", products: ["provider/1", "tool/2"], system: "linux x64" })).toBe(
      `opencode/${InstallationChannel}/${InstallationVersion}/app provider/1 tool/2 opencode-ui/${process.env.OPENCODE_UI_VERSION?.trim() || InstallationVersion} (linux x64)`,
    )
  }),
)
```

- [x] **步骤 2：运行测试确认 RED**

运行：在 `packages/opencode` 中执行 `bun test test/installation/installation.test.ts`

预期：FAIL，`userAgent` 当前只接受字符串 client，且未组合 products/system/UI token。

- [x] **步骤 3：实现 options 组合并委托 Core**

将 `index.ts` 的版本导入扩展为 `customizeUserAgent`，并替换 helper：

```ts
export function userAgent(options: { client?: string; products?: string[]; system?: string } = {}) {
  const value = [
    `opencode/${InstallationChannel}/${InstallationVersion}/${options.client ?? "cli"}`,
    ...(options.products ?? []),
    ...(options.system ? [`(${options.system})`] : []),
  ].join(" ")
  return customizeUserAgent(value)
}

export const USER_AGENT = userAgent()
```

- [x] **步骤 4：运行测试确认 GREEN**

运行：在 `packages/opencode` 中执行 `bun test test/installation/installation.test.ts`

预期：PASS，新增断言确认顺序为 base、products、UI token、system comment；原 Installation 服务测试也全部通过。

- [x] **步骤 5：提交**

```bash
git add packages/opencode/src/installation/index.ts packages/opencode/test/installation/installation.test.ts
git commit -m "feat(opencode): compose UI user agent"
```

### Task 3: 迁移 Core 出站构造点并覆盖 models.dev

**文件：**
- 修改：`packages/core/src/models-dev.ts:10,18,153-160`
- 修改：`packages/core/src/tool/websearch.ts:9,239-242`
- 修改：`packages/core/src/plugin/provider/cloudflare-workers-ai.ts:67`
- 修改：`packages/core/src/plugin/provider/cloudflare-ai-gateway.ts:74`
- 修改：`packages/core/src/plugin/provider/gitlab.ts:22`
- 修改：`packages/core/src/plugin/provider/openai.ts:192`
- 修改：`packages/core/test/plugin/models-dev.test.ts:1-27`

**接口：**
- 消费：`customizeUserAgent`；Core 调用点仍自行构造其既有 `opencode/...`、provider 产品和系统 comment。
- 产出：所有 Core 自建 `opencode/...` header 都含 UI token，且不改变既有产品/comment 内容。

- [x] **步骤 1：在 models.dev 测试中编写失败的最终请求 header 断言**

在 `models-dev.test.ts` 增加一个使用本地 `Bun.serve` 的 `it.live` 用例：设置 `Flag.OPENCODE_MODELS_URL = server.url`、禁用本地 models 路径和自动抓取，调用 `ModelsDev.Service.get()`，并在服务端保存请求 headers。

```ts
expect(captured[0].get("user-agent")).toBe(
  `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT} opencode-ui/${process.env.OPENCODE_UI_VERSION?.trim() || InstallationVersion}`,
)
```

在 `Effect.acquireUseRelease` 中保存并恢复每个被改动的 `Flag`，保证测试不污染其他 models-dev 测试。

- [x] **步骤 2：运行测试确认 RED**

运行：在 `packages/core` 中执行 `bun test test/plugin/models-dev.test.ts`

预期：FAIL，捕获的 `models.dev/api.json` 请求 header 缺少 `opencode-ui/`。

- [x] **步骤 3：迁移 Core 构造表达式**

将 `models-dev.ts` 的模块常量替换为启动快照形式：

```ts
const USER_AGENT = customizeUserAgent(`opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`)
```

在 `websearch.ts` 和四个 provider plugin 文件中保留原有字符串模板，只用 `customizeUserAgent(...)` 包裹其完整 UA 值。provider 产品和 `(${os.platform()} ${os.release()}; ${os.arch()})` comment 必须仍在 UI token 两侧保持原顺序。

- [x] **步骤 4：运行测试确认 GREEN**

运行：在 `packages/core` 中执行 `bun test test/installation/user-agent.test.ts test/plugin/models-dev.test.ts test/plugin/provider-gitlab.test.ts test/plugin/provider-cloudflare-workers-ai.test.ts test/plugin/provider-cloudflare-ai-gateway.test.ts`

预期：PASS，models.dev 请求含 UI token，既有 provider header 行为不回归。

- [x] **步骤 5：提交**

```bash
git add packages/core/src/models-dev.ts packages/core/src/tool/websearch.ts packages/core/src/plugin/provider packages/core/test/plugin/models-dev.test.ts
git commit -m "refactor(core): reuse UI user agent helper"
```

### Task 4: 迁移 OpenCode 默认构造点

**文件：**
- 修改：`packages/opencode/src/provider/models.ts:118`
- 修改：`packages/opencode/src/provider/provider.ts:612,745,813`
- 修改：`packages/opencode/src/session/llm/request.ts:194,200`
- 修改：`packages/opencode/src/tool/websearch.ts:55`
- 修改：`packages/opencode/src/plugin/digitalocean.ts:174`
- 修改：`packages/opencode/src/plugin/openai/codex.ts:459,483,543`

**接口：**
- 消费：`Installation.USER_AGENT` 用于无附加内容路径；`Installation.userAgent({ products, system })` 用于 provider 产品或系统 comment 路径。
- 产出：OpenCode 构造的默认 UA 含 UI token，后续 header 合并顺序不变。

- [x] **步骤 1：编写失败的 Installation helper 调用断言**

在 `packages/opencode/test/installation/installation.test.ts` 添加以下精确组合用例，作为迁移调用点所依赖的 provider/system 契约：

```ts
expect(Installation.userAgent({ products: ["gitlab-ai-provider/1"], system: "linux 1.0; x64" })).toBe(
  `opencode/${InstallationChannel}/${InstallationVersion}/cli gitlab-ai-provider/1 opencode-ui/${process.env.OPENCODE_UI_VERSION?.trim() || InstallationVersion} (linux 1.0; x64)`,
)
```

- [x] **步骤 2：运行测试确认 RED**

运行：在 `packages/opencode` 中执行 `bun test test/installation/installation.test.ts`

预期：FAIL，当前 `userAgent` 尚未接受 options 或不会插入 UI token。

- [x] **步骤 3：替换 OpenCode 自建 UA**

按下列规则替换，不改变 headers 对象展开位置：

```ts
// 无额外产品/comment 的默认值
"User-Agent": Installation.USER_AGENT

// 既有 provider 产品和系统信息
"User-Agent": Installation.userAgent({
  products: ["gitlab-ai-provider/" + GITLAB_PROVIDER_VERSION],
  system: `${os.platform()} ${os.release()}; ${os.arch()}`,
})
```

对 `provider/models.ts`、LLM request、DigitalOcean、Codex 的纯默认 UA 直接使用 `Installation.USER_AGENT`。对 `provider/provider.ts` 三条 provider UA 使用 `Installation.userAgent` 并传入各自既有 provider product/system；对 `tool/websearch.ts` 使用 `Installation.USER_AGENT`。保留 `tool/webfetch.ts` 的裸 `opencode` 兼容性 header，不作修改。

- [x] **步骤 4：运行测试确认 GREEN**

运行：在 `packages/opencode` 中执行 `bun test test/installation/installation.test.ts`

预期：PASS，默认、provider product 和 system comment 的组合均为正确顺序。

- [x] **步骤 5：提交**

```bash
git add packages/opencode/src/provider/models.ts packages/opencode/src/provider/provider.ts packages/opencode/src/session/llm/request.ts packages/opencode/src/tool/websearch.ts packages/opencode/src/plugin/digitalocean.ts packages/opencode/src/plugin/openai/codex.ts packages/opencode/test/installation/installation.test.ts
git commit -m "refactor(opencode): reuse installation user agent"
```

### Task 5: 修正 xAI、Snowflake 和 Copilot 的后置 User-Agent 覆盖

**文件：**
- 修改：`packages/opencode/src/plugin/xai.ts:91,544`
- 修改：`packages/opencode/src/plugin/snowflake-cortex.ts:3,79-85,369-397`
- 修改：`packages/opencode/src/plugin/github-copilot/copilot.ts:3,70-79,102-179,234-276`
- 修改：`packages/opencode/test/plugin/xai.test.ts:119-213`
- 修改：`packages/opencode/test/plugin/snowflake-cortex.test.ts:47-79`
- 修改：`packages/opencode/test/plugin/github-copilot-models.test.ts:1-9`

**接口：**
- 消费：`Installation.USER_AGENT` 和原生 `Headers`。
- 产出：xAI/Snowflake 先设 OpenCode 默认 UA、后合并调用 headers；Copilot 合并 Request headers 后合并 init headers，只有无 UA 时设默认值。

- [x] **步骤 1：编写三个失败的最终请求测试**

在 xAI 的本地 `Bun.serve` 测试中传入小写 UA，断言服务端看到该值：

```ts
await opts.fetch!(new URL("/chat/completions", server.url), {
  headers: { Authorization: `Bearer ${OAUTH_DUMMY_KEY}`, "user-agent": "third-party/1" },
})
expect(captured[0].get("user-agent")).toBe("third-party/1")
```

在 Snowflake 现有 loader 测试中传入 `"user-agent": "third-party/1"`，断言 `captured[0].get("user-agent")` 为 `third-party/1`，同时继续断言 bearer 和 `x-keep`。

在 `github-copilot-models.test.ts` 新增 loader-fetch 测试：以 OAuth auth 调用 `CopilotAuthPlugin`，将 `new Request(url, { headers: { "User-Agent": "request/1" } })` 作为 input，并传入 `headers: new Headers({ "user-agent": "init/2" })`；mock fetch 捕获 `init.headers`，断言最终 UA 为 `init/2`。再以无 UA 的 Request/init 调用一次，断言最终 UA 等于 `Installation.USER_AGENT`。

- [x] **步骤 2：运行测试确认 RED**

运行：在 `packages/opencode` 中执行 `bun test test/plugin/xai.test.ts test/plugin/snowflake-cortex.test.ts test/plugin/github-copilot-models.test.ts`

预期：FAIL，xAI、Snowflake 与 Copilot wrapper 目前会在调用者 headers 之后强制设置 `opencode/...`。

- [x] **步骤 3：以原生 Headers 保持 fetch 优先级**

将 xAI 和 Snowflake 的 wrapper 改成先在 `Headers` 上设置 `Installation.USER_AGENT`，再以现有调用者 headers 逐个 `set` 覆盖；不得在合并之后再写 User-Agent。

将 Copilot wrapper 的 headers 构造替换为：

```ts
const headers = new Headers(request instanceof Request ? request.headers : undefined)
if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
if (!headers.has("user-agent")) headers.set("User-Agent", Installation.USER_AGENT)
headers.set("x-initiator", isAgent ? "agent" : "user")
headers.set("Authorization", `Bearer ${info.refresh}`)
headers.set("Openai-Intent", "conversation-edits")
```

继续删除 `x-api-key`/`authorization` 后使用这个 `headers` 调用 fetch。Copilot 的 models discovery、device-code 和 polling requests 改用 `Installation.USER_AGENT`，但不改变它们自己的认证/协议 headers。

- [x] **步骤 4：运行测试确认 GREEN**

运行：在 `packages/opencode` 中执行 `bun test test/plugin/xai.test.ts test/plugin/snowflake-cortex.test.ts test/plugin/github-copilot-models.test.ts`

预期：PASS，三条最终请求均保留大小写不同的第三方 UA；Copilot 证明 Request headers 与 `Headers` 类型 init headers 都受原生合并规则处理，且无调用者 UA 时才补 OpenCode 默认值。

- [x] **步骤 5：提交**

```bash
git add packages/opencode/src/plugin/xai.ts packages/opencode/src/plugin/snowflake-cortex.ts packages/opencode/src/plugin/github-copilot/copilot.ts packages/opencode/test/plugin/xai.test.ts packages/opencode/test/plugin/snowflake-cortex.test.ts packages/opencode/test/plugin/github-copilot-models.test.ts
git commit -m "fix(opencode): preserve provider user agent overrides"
```

### Task 6: 全量聚焦验证、类型检查与残留审查

**文件：**
- 仅审查：本计划“文件结构”中所有文件，以及 `packages/{core,opencode}/src/tool/webfetch.ts` 和 `packages/console/**`。

**接口：**
- 验收：所有自建 `opencode/...` UA 走 Core helper 或 Installation 入口；明确排除项保留且均有分类理由。

- [x] **步骤 1：运行 Core 聚焦测试**

运行：在 `packages/core` 中执行：

```bash
bun test test/installation/user-agent.test.ts test/plugin/models-dev.test.ts test/plugin/provider-gitlab.test.ts test/plugin/provider-cloudflare-workers-ai.test.ts test/plugin/provider-cloudflare-ai-gateway.test.ts
```

预期：PASS，纯函数、models-dev 请求与 Core provider headers 均通过。

- [x] **步骤 2：运行 OpenCode 聚焦测试**

运行：在 `packages/opencode` 中执行：

```bash
bun test test/installation/installation.test.ts test/plugin/xai.test.ts test/plugin/snowflake-cortex.test.ts test/plugin/github-copilot-models.test.ts
```

预期：PASS，Installation 组合与三个 provider 覆盖路径均通过。

- [x] **步骤 3：分别执行类型检查**

运行：在 `packages/core` 中执行 `bun typecheck`；在 `packages/opencode` 中执行 `bun typecheck`。

预期：两条命令均以退出码 0 完成；不得在仓库根目录运行测试或 typecheck。

- [x] **步骤 4：扫描并逐项分类残留**

运行：在仓库根目录执行：

```bash
rg -n 'User-Agent|opencode/' packages/core/src packages/opencode/src packages/console
```

预期：Core/OpenCode 的自建完整 `opencode/...` header 不再绕过 helper/Installation；允许残留仅为 `packages/console` 独立产品 UA、两处 webfetch 裸 `opencode` 兼容路径，以及 provider/SDK 后续合并的第三方 UA。检查每条匹配的上下文，确认没有把第三方 UA 传给定制函数。

- [x] **步骤 5：审查最终差异并提交**

运行：`git diff --check 1f2cdf59fa1f59ff019d381827ba2ae1ef42ecd7 -- packages/core packages/opencode`，再审阅 `git diff 1f2cdf59fa1f59ff019d381827ba2ae1ef42ecd7 -- packages/core packages/opencode`。

预期：无空白错误；不存在数据库、协议、依赖或第三方 UA 行为变更。

```bash
git add packages/core packages/opencode
git commit -m "test: cover UI user agent restoration"
```

## 覆盖核对

- 设计文档的首 token、幂等、trim/fallback、comment 前插入规则由 Task 1 覆盖。
- OpenCode `userAgent(options)` 组合次序和模块启动快照由 Task 2 覆盖。
- Core models-dev 集成请求、Core provider/tool 迁移由 Task 3 覆盖。
- OpenCode 模型目录、LLM、provider、工具、Codex 和 DigitalOcean 构造点由 Task 4 覆盖。
- xAI、Snowflake、Copilot 的第三方后置 header 覆盖及 Copilot HeadersInit/Request 形态由 Task 5 覆盖。
- 聚焦测试、包内 typecheck、残留扫描和无 schema/protocol/dependency 变更审查由 Task 6 覆盖。
