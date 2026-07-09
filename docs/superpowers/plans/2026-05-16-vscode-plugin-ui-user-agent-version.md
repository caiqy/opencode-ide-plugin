# VSCode Plugin UI User-Agent Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 VSCode 插件启动的 opencode 后端在 `User-Agent` 中使用插件版本作为 `opencode-ui/<版本>`，同时保持 `opencode/<版本>` 仍为核心后端版本。

**Architecture:** VSCode 插件从 `context.extension.packageJSON.version` 读取真实插件版本，并在 `BackendLauncher` 启动后端进程时通过 `OPENCODE_UI_VERSION` 环境变量注入。opencode 后端的 `Installation.userAgent()` 集中读取该环境变量，仅用于生成 `opencode-ui` product；未注入时回退到 `InstallationVersion`。
`Installation.USER_AGENT` 是后端模块加载时求值的常量，因此 VSCode 插件必须在启动后端子进程前完成 env 注入；空白插件版本时还要显式移除继承的 `OPENCODE_UI_VERSION`，避免父进程环境污染。

**Tech Stack:** TypeScript、Bun test、VSCode Extension API、Mocha/VSCode 插件测试、Node `child_process.spawn` 环境变量。

---

## 文件结构与职责

- Modify: `packages/opencode/src/installation/index.ts`
  - 负责集中生成 opencode 相关 `User-Agent` 字符串。
  - 新增 `OPENCODE_UI_VERSION` 读取逻辑，只影响 `opencode-ui/<版本>`。

- Modify: `packages/opencode/test/installation/installation.test.ts`
  - 负责验证后端 UA 默认 fallback、环境变量覆盖、product 顺序和 system comment 不回归。

- Modify: `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
  - 负责 VSCode 插件后端进程启动。
  - 新增可选 `extensionVersion`，并通过 `buildEnvironment()` 注入 `OPENCODE_UI_VERSION`。

- Modify: `hosts/vscode-plugin/src/extension.ts`
  - 负责创建 `BackendLauncher`。
  - 将插件安装路径和插件版本一起传给 `BackendLauncher`。

- Modify: `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`
  - 负责验证 `BackendLauncher` 会把插件版本写入后端进程环境变量，并且空版本不会强行注入。

## 注意事项

- 严格按 TDD：每个生产代码改动前先写 failing test，并运行确认失败。
- 不要改 `opencode/<版本>`。
- 不要新增 CLI 参数。
- 不要让后端读取 VSCode 插件 `package.json`。
- 本仓库要求：不要创建 git commit，除非用户明确要求。

---

### Task 1: 后端 `Installation.userAgent()` 支持 `OPENCODE_UI_VERSION`

**Files:**

- Modify: `packages/opencode/test/installation/installation.test.ts`
- Modify: `packages/opencode/src/installation/index.ts`

- [ ] **Step 1: 写 failing test，证明注入版本应覆盖 `opencode-ui` product**

在 `packages/opencode/test/installation/installation.test.ts` 的 `const encoder = new TextEncoder()` 下方添加 helper：

```ts
function withUiVersion<T>(version: string | undefined, run: () => T): T {
  const previous = process.env.OPENCODE_UI_VERSION
  if (version === undefined) {
    delete process.env.OPENCODE_UI_VERSION
  } else {
    process.env.OPENCODE_UI_VERSION = version
  }

  try {
    return run()
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_UI_VERSION
    } else {
      process.env.OPENCODE_UI_VERSION = previous
    }
  }
}
```

在 `describe("userAgent", () => {` 内、现有第一个测试之后添加：

```ts
test("uses injected UI version for the default opencode UI user agent", () => {
  withUiVersion("26.5.1602", () => {
    expect(Installation.userAgent()).toBe(`opencode/${InstallationVersion} opencode-ui/26.5.1602 (codex app)`)
  })
})

test("falls back to installation version when injected UI version is blank", () => {
  withUiVersion("   ", () => {
    expect(Installation.userAgent()).toBe(
      `opencode/${InstallationVersion} opencode-ui/${InstallationVersion} (codex app)`,
    )
  })
})
```

- [ ] **Step 2: 运行后端目标测试，确认失败原因正确**

Run from `packages/opencode`:

```powershell
bun test test/installation/installation.test.ts --timeout 30000
```

Expected: 至少第一个新测试失败，实际输出仍包含 `opencode-ui/${InstallationVersion}`，而不是 `opencode-ui/26.5.1602`。

- [ ] **Step 3: 实现最小后端逻辑**

在 `packages/opencode/src/installation/index.ts` 中删除固定常量：

```ts
const UI_USER_AGENT_PRODUCT = `opencode-ui/${InstallationVersion}`
```

替换为函数：

```ts
function uiUserAgentProduct() {
  const version = process.env.OPENCODE_UI_VERSION?.trim() || InstallationVersion
  return `opencode-ui/${version}`
}
```

将 `userAgent()` 中的 products 构造从：

```ts
const products = [base, ...(options?.products ?? []), UI_USER_AGENT_PRODUCT]
```

改为：

```ts
const products = [base, ...(options?.products ?? []), uiUserAgentProduct()]
```

- [ ] **Step 4: 运行后端目标测试，确认通过**

Run from `packages/opencode`:

```powershell
bun test test/installation/installation.test.ts --timeout 30000
```

Expected: `installation.test.ts` 全部通过。

- [ ] **Step 5: 补充 installation-scoped 和 product 顺序覆盖**

在 `packages/opencode/test/installation/installation.test.ts` 的 `describe("userAgent", () => {` 中继续添加：

```ts
test("uses injected UI version for installation-scoped user agent", () => {
  withUiVersion("26.5.1602", () => {
    expect(Installation.userAgent({ base: "installation" })).toBe(
      `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT} opencode-ui/26.5.1602 (codex app)`,
    )
  })
})

test("keeps provider products before injected UI product", () => {
  withUiVersion("26.5.1602", () => {
    expect(Installation.userAgent({ products: ["gitlab-ai-provider/1.2.3"] })).toBe(
      `opencode/${InstallationVersion} gitlab-ai-provider/1.2.3 opencode-ui/26.5.1602 (codex app)`,
    )
  })
})
```

- [ ] **Step 6: 运行后端目标测试，确认通过**

Run from `packages/opencode`:

```powershell
bun test test/installation/installation.test.ts --timeout 30000
```

Expected: `installation.test.ts` 全部通过。

---

### Task 2: VSCode `BackendLauncher` 注入插件版本环境变量

**Files:**

- Modify: `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`
- Modify: `hosts/vscode-plugin/src/backend/BackendLauncher.ts`

- [ ] **Step 1: 写 failing test，证明 `BackendLauncher` 需要暴露构造参数并构造后端环境变量**

在 `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts` 的 `suite("BackendLauncher Test Suite", () => {` 内、第一个测试之后添加：

```ts
test("should inject extension version into backend environment", () => {
  const scoped = new BackendLauncher({ extensionVersion: "26.5.1602" })
  const env = (scoped as unknown as { buildEnvironment(): NodeJS.ProcessEnv }).buildEnvironment()

  assert.strictEqual(env.OPENCODE_UI_VERSION, "26.5.1602")
})

test("should not inject blank extension version into backend environment", () => {
  const previous = process.env.OPENCODE_UI_VERSION
  delete process.env.OPENCODE_UI_VERSION

  try {
    const scoped = new BackendLauncher({ extensionVersion: "   " })
    const env = (scoped as unknown as { buildEnvironment(): NodeJS.ProcessEnv }).buildEnvironment()

    assert.strictEqual(Object.prototype.hasOwnProperty.call(env, "OPENCODE_UI_VERSION"), false)
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_UI_VERSION
    } else {
      process.env.OPENCODE_UI_VERSION = previous
    }
  }
})

test("should remove inherited UI version when extension version is blank", () => {
  const previous = process.env.OPENCODE_UI_VERSION
  process.env.OPENCODE_UI_VERSION = "stale"

  try {
    const scoped = new BackendLauncher({ extensionVersion: "   " })
    const env = (scoped as unknown as { buildEnvironment(): NodeJS.ProcessEnv }).buildEnvironment()

    assert.strictEqual(Object.prototype.hasOwnProperty.call(env, "OPENCODE_UI_VERSION"), false)
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_UI_VERSION
    } else {
      process.env.OPENCODE_UI_VERSION = previous
    }
  }
})
```

- [ ] **Step 2: 运行 VSCode 编译，确认失败原因正确**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
```

Expected: TypeScript 编译失败，提示 `BackendLauncher` 构造函数当前不接受 `{ extensionVersion: string }`，或测试访问的 `buildEnvironment()` 尚未实现。

- [ ] **Step 3: 实现 `BackendLauncherOptions`、构造参数和环境变量构造函数**

在 `hosts/vscode-plugin/src/backend/BackendLauncher.ts` 的 `BackendConnection` interface 后添加：

```ts
export interface BackendLauncherOptions {
  extensionPath?: string
  extensionVersion?: string
}
```

将 class 字段和构造函数从：

```ts
  private extensionPath?: string

  constructor(extensionPath?: string) {
    this.extensionPath = extensionPath
  }
```

改为：

```ts
  private extensionPath?: string
  private extensionVersion?: string

  constructor(options?: string | BackendLauncherOptions) {
    if (typeof options === "string") {
      this.extensionPath = options
      return
    }

    this.extensionPath = options?.extensionPath
    const version = options?.extensionVersion?.trim()
    this.extensionVersion = version || undefined
  }
```

在 `spawnBackend()` 之前添加方法：

```ts
  private buildEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env }
    if (this.extensionVersion) {
      env.OPENCODE_UI_VERSION = this.extensionVersion
    } else {
      delete env.OPENCODE_UI_VERSION
    }
    return env
  }
```

将 `spawnBackend()` 中的 env 从：

```ts
      env: { ...process.env },
```

改为：

```ts
      env: this.buildEnvironment(),
```

- [ ] **Step 4: 运行 VSCode 编译，确认通过**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
```

Expected: TypeScript 编译通过。

- [ ] **Step 5: 运行 VSCode 测试套件中的 BackendLauncher 测试**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run test -- --grep "BackendLauncher"
```

Expected: `BackendLauncher Test Suite` 通过。如果当前 `vscode-test` 不支持 `--grep` 或会启动 Electron 环境失败，则记录失败原因，并至少保留 `pnpm run compile` 作为类型与测试编译验证。

---

### Task 3: VSCode 扩展入口传入真实插件版本

**Files:**

- Modify: `hosts/vscode-plugin/src/extension.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`

- [ ] **Step 1: 写兼容性测试，证明旧 string 构造仍可用**

在 `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts` 的 `should create BackendLauncher instance` 测试之后添加：

```ts
test("should keep string extension path constructor compatibility", () => {
  const scoped = new BackendLauncher("/tmp/opencode-extension")

  assert.ok(scoped instanceof BackendLauncher)
})
```

- [ ] **Step 2: 运行 VSCode 编译，确认通过**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
```

Expected: 编译通过。这个测试用于锁定兼容性，避免后续入口更新影响旧调用方式。

- [ ] **Step 3: 更新扩展入口传参**

在 `hosts/vscode-plugin/src/extension.ts` 中将：

```ts
this.backendLauncher = new BackendLauncher(this.context!.extensionUri.fsPath)

const currentVersion = this.context!.extension.packageJSON.version
```

改为：

```ts
const currentVersion = this.context!.extension.packageJSON.version
this.backendLauncher = new BackendLauncher({
  extensionPath: this.context!.extensionUri.fsPath,
  extensionVersion: currentVersion,
})
```

这样 `currentVersion` 同时服务于后端 UA 注入和现有更新检查。

- [ ] **Step 4: 运行 VSCode 编译，确认通过**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
```

Expected: TypeScript 编译通过。

---

### Task 4: 最终验证

**Files:**

- Verify only; no code changes expected.

- [ ] **Step 1: 运行后端目标测试**

Run from `packages/opencode`:

```powershell
bun test test/installation/installation.test.ts --timeout 30000
```

Expected: 全部通过。

- [ ] **Step 2: 运行后端 typecheck**

Run from `packages/opencode`:

```powershell
bun typecheck
```

Expected: 通过，无 TypeScript 错误。

- [ ] **Step 3: 运行 VSCode 插件编译**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
```

Expected: 通过，包含 `tsc -p ./` 和 `tsc -p ./tsconfig.test.json`。

- [ ] **Step 4: 尝试运行 VSCode BackendLauncher 相关测试**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run test -- --grep "BackendLauncher"
```

Expected: `BackendLauncher Test Suite` 通过；如果 VSCode Electron 测试环境无法在当前环境启动，保留错误输出，并以 Step 3 的测试编译通过作为最低验证。

- [ ] **Step 5: 检查工作树 diff**

Run from repo root:

```powershell
git diff -- packages/opencode/src/installation/index.ts packages/opencode/test/installation/installation.test.ts hosts/vscode-plugin/src/backend/BackendLauncher.ts hosts/vscode-plugin/src/extension.ts hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts
```

Expected: diff 只包含 `OPENCODE_UI_VERSION` 注入、UA product 版本选择、测试，以及 `BackendLauncher` 构造参数更新；没有无关重构。

---

## 自检记录

- Spec coverage: 覆盖 VSCode 注入、后端 fallback、`opencode/<版本>` 不变、非 VSCode 入口 fallback、测试验证。
- Placeholder scan: 没有 `TBD`、`TODO` 或“稍后实现”占位。
- Type consistency: 计划中统一使用 `BackendLauncherOptions`、`extensionPath`、`extensionVersion`、`buildEnvironment()`、`OPENCODE_UI_VERSION`。
- 仓库约束: 计划未要求创建 commit；如需提交，必须由用户明确要求。
