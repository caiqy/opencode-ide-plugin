# 测试模式

**分析日期：** 2026-04-12

## 测试框架

本项目在不同包中使用**三种不同的测试运行器**：

### 1. Vitest（WebGUI 前端）

- **包：** `packages/opencode/webgui/`
- **版本：** 4.0.13
- **配置：** `packages/opencode/webgui/vitest.config.ts`
- **环境：** jsdom
- **全局变量：** 已启用（`globals: true`）
- **设置：** `packages/opencode/webgui/src/test/setup.ts`
- **覆盖率：** v8 provider，text/json/html 报告器

### 2. Bun Test（上游 opencode）

- **包：** `packages/opencode/`
- **导入：** `import { describe, expect, test } from "bun:test"`
- **超时：** 默认 30000ms
- **不需要 Jest/Vitest** — 使用原生 Bun 测试运行器

### 3. Mocha + @vscode/test-electron（VSCode 插件）

- **包：** `hosts/vscode-plugin/`
- **框架：** Mocha，使用 TDD UI（`suite`/`test`/`setup`/`teardown`）
- **测试运行器：** `@vscode/test-electron` 用于集成测试
- **配置：** `hosts/vscode-plugin/src/test/suite/index.ts`（Mocha runner 设置）
- **超时：** 20000ms
- **断言：** Node.js 内置 `assert` 模块
- **部分单元测试**直接使用 `node:test`（例如 `kill.test.ts`、`loading.test.ts`）

## 测试命令

```bash
# 重要：测试不能从仓库根目录运行！
# 根目录有保护：「do not run tests from root」

# WebGUI（Vitest）
cd packages/opencode/webgui
bun run test           # 监听模式
bun run test:run       # 单次运行
bun run test:coverage  # 覆盖率报告
bun run test:ui        # Vitest UI

# 上游 opencode（Bun test）
cd packages/opencode
bun test --timeout 30000

# VSCode 插件（Mocha + @vscode/test-electron）
cd hosts/vscode-plugin
pnpm run pretest       # 先编译 + lint
pnpm run test          # vscode-test 运行器（需要 VS Code）
```

## 测试文件组织

### 并置测试（WebGUI）

测试文件与源文件并置，使用 `.test.ts` / `.test.tsx` 后缀：

```
packages/opencode/webgui/src/
├── state/
│   ├── tabPolicy.ts
│   ├── tabPolicy.test.ts              # 纯逻辑单元测试
│   ├── SessionContext.tsx
│   ├── SessionContext.test.tsx         # Context 测试
│   ├── MessagesContext.tsx
│   ├── MessagesContext.questions.test.tsx      # 主题范围测试
│   ├── MessagesContext.pagination.test.tsx     # 主题范围测试
│   ├── MessagesContext.reasoning.test.tsx      # 主题范围测试
│   └── repo/
│       ├── draftRepo.ts
│       └── draftRepo.test.ts
├── hooks/
│   ├── useDebounce.ts
│   └── useDebounce.test.ts
├── lib/
│   ├── ideBridge.ts
│   ├── ideBridge.test.ts
│   └── api/
│       ├── sdkClient.ts
│       └── sdkClient.test.ts
├── utils/
│   ├── validation.ts
│   └── validation.test.ts
├── components/
│   ├── Toast.tsx
│   └── Toast.test.tsx
└── test/
    ├── setup.ts                       # 全局测试设置
    ├── test-utils.tsx                 # 自定义 render 辅助函数
    └── legacyStorageGate.test.ts
```

**主题范围命名规范：** 对于有多个测试关注点的文件，在 `.test` 前使用点分隔的主题名称：`MessagesContext.questions.test.tsx`、`sdkClient.migration.test.ts`

### 独立测试目录（上游 opencode）

```
packages/opencode/
├── src/
│   └── util/
│       └── lazy.ts
└── test/
    └── util/
        └── lazy.test.ts               # 镜像 src/ 结构
```

### 独立测试套件（VSCode 插件）

```
hosts/vscode-plugin/src/
├── backend/
│   ├── BackendLauncher.ts
│   └── kill.test.ts                   # 并置单元测试（node:test）
├── ui/
│   └── loading.test.ts               # 并置单元测试（node:test）
└── test/
    ├── runTest.ts                     # @vscode/test-electron 启动器
    └── suite/
        ├── index.ts                   # Mocha 测试运行器配置
        ├── extension.test.ts          # 集成测试
        ├── backendLauncher.test.ts    # 集成测试
        ├── ideBridgeServer.test.ts
        ├── settingsManager.test.ts
        └── ...
```

**VSCode 插件有两种测试方式：**

- `node:test` 用于不需要 VS Code API 的纯单元测试（与源码并置）
- Mocha + `@vscode/test-electron` 用于需要 VS Code API 的测试（在 `src/test/suite/` 中）

## 测试结构

### Vitest 模式（WebGUI）

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("featureName", () => {
  beforeEach(() => {
    vi.useFakeTimers() // 测试异步/定时器时
    vi.resetAllMocks() // 重置 mock 状态
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("describes expected behavior", () => {
    const result = functionUnderTest(input)
    expect(result).toBe(expected)
  })

  it("handles edge case", async () => {
    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe("updated")
  })
})
```

### Bun Test 模式（上游 opencode）

```typescript
import { describe, expect, test } from "bun:test"
import { lazy } from "../../src/util/lazy"

describe("util.lazy", () => {
  test("should call function only once", () => {
    let callCount = 0
    const getValue = () => {
      callCount++
      return "expensive value"
    }
    const lazyValue = lazy(getValue)

    expect(callCount).toBe(0)
    const result1 = lazyValue()
    expect(result1).toBe("expensive value")
    expect(callCount).toBe(1)
  })
})
```

### Mocha TDD 模式（VSCode 插件 - 集成）

```typescript
import * as assert from "assert"
import * as vscode from "vscode"
import { BackendLauncher } from "../../backend/BackendLauncher"

suite("BackendLauncher Test Suite", () => {
  let launcher: BackendLauncher

  setup(() => {
    launcher = new BackendLauncher()
  })

  teardown(() => {
    launcher.terminate()
  })

  test("should create BackendLauncher instance", () => {
    assert.ok(launcher instanceof BackendLauncher)
  })

  test("should not be running initially", () => {
    assert.strictEqual(launcher.isRunning(), false)
  })
})
```

### Node.js 内置测试模式（VSCode 插件 - 单元）

```typescript
import assert from "node:assert/strict"
import test from "node:test"
import { loading } from "./loading"

test("loading returns static shell page without iframe", () => {
  const html = loading("OpenCode", "Loading...")
  assert.match(html, /OpenCode/)
  assert.ok(!html.includes("<iframe"))
})
```

## Mock

### AGENTS.md 策略

> 尽可能避免 mock。测试实际实现，不要在测试中复制逻辑。

### Vitest Mock（需要时使用）

**使用 `vi.mock` 的模块 mock（hoisted）：**

```typescript
const mocks = vi.hoisted(() => ({
  setReasoning: vi.fn(),
  setSessionIdle: vi.fn(),
}))

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    session: { messages: vi.fn() },
    permissions: { respond: vi.fn() },
  },
}))

vi.mock("./SessionContext", () => ({
  useSession: () => ({
    setReasoning: mocks.setReasoning,
    setSessionIdle: mocks.setSessionIdle,
  }),
}))
```

**Spy 全局 API：**

```typescript
const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
  new Response(JSON.stringify({ tools: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
)
```

**伪造定时器：**

```typescript
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// 在测试中
await act(async () => {
  vi.advanceTimersByTime(500)
})
```

### VSCode 插件 Mock（Mocha）

使用直接原型修补和函数替换（没有使用 Sinon——尽管它是 devDependency，测试更倾向于手动 mock）：

```typescript
// 原型修补
const original = WebviewManager.prototype.dispose
WebviewManager.prototype.dispose = function () {
  calls.push("webview")
}
try {
  // 测试逻辑
} finally {
  WebviewManager.prototype.dispose = original // 始终在 finally 中恢复
}

// 直接属性注入用于内部测试
;(launcher as unknown as { currentProcess?: typeof proc }).currentProcess = proc
```

### 手动 Stub 模式（VSCode 插件）

用于测试中的依赖注入：

```typescript
await killTree(proc, {
  platform: "win32",
  spawn(cmd, list) {
    args.push([cmd, ...list])
    const child = new EventEmitter()
    queueMicrotask(() => child.emit("exit", 0))
    return child as EventEmitter & { once: EventEmitter["once"] }
  },
  sleep: async () => {},
})
```

## 测试辅助函数和夹具

### WebGUI 测试设置 (`packages/opencode/webgui/src/test/setup.ts`)

全局设置在所有测试前运行：

- 导入 `@testing-library/jest-dom` 获取 DOM 匹配器
- 每个测试后运行 `cleanup()`
- Mock `window.matchMedia`、`IntersectionObserver`、`ResizeObserver`

### WebGUI 自定义 Render (`packages/opencode/webgui/src/test/test-utils.tsx`)

```typescript
import { render, type RenderOptions } from "@testing-library/react"

const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>
}

const customRender = (ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) =>
  render(ui, { wrapper: AllTheProviders, ...options })

export * from "@testing-library/react"
export { customRender as render }
```

### WebGUI Context 测试模式（捕获 Hook）

测试 React context/hooks 的常用模式：

```typescript
let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

function mount(emitter: EventEmitter) {
  render(
    <MessagesProvider emitter={emitter}>
      <Capture />
    </MessagesProvider>,
  )
}

// 测试直接访问 `api`
expect(api?.getQuestionsBySession("s1").map((q) => q.id)).toEqual(["q1"])
```

### 测试重置函数

维护内部状态的模块暴露重置函数用于测试：

```typescript
// 在源文件中
export function resetDraftRepoForTest(): void {
  /* 清除内部缓存 */
}
export function resetScopedStateForTest(): void {
  /* 清除缓存 */
}

// 在测试中
beforeEach(() => {
  vi.resetAllMocks()
  resetDraftRepoForTest()
})
```

### 上游 opencode 测试夹具

上游 `packages/opencode/test/` 有夹具系统（文档在 `packages/opencode/test/AGENTS.md`）：

```typescript
import { tmpdir } from "./fixture/fixture"

test("example", async () => {
  await using tmp = await tmpdir()
  // tmp.path 是临时目录
  // 通过 Symbol.asyncDispose 自动清理
})

// 带 git 仓库
await using tmp = await tmpdir({ git: true })

// 带配置
await using tmp = await tmpdir({
  config: { model: "test/model", username: "testuser" },
})
```

## 测试库

### WebGUI (`packages/opencode/webgui/`)

| 库                            | 版本    | 用途                  |
| ----------------------------- | ------- | --------------------- |
| `vitest`                      | 4.0.13  | 测试运行器            |
| `@vitest/ui`                  | 4.0.13  | 可视化测试 UI         |
| `@testing-library/react`      | 16.3.0  | React 组件测试        |
| `@testing-library/jest-dom`   | 6.9.1   | DOM 断言匹配器        |
| `@testing-library/user-event` | 14.6.1  | 用户交互模拟          |
| `jsdom`                       | 27.2.0  | DOM 环境              |
| `happy-dom`                   | 20.0.10 | 备选 DOM 环境（可用） |

### VSCode 插件 (`hosts/vscode-plugin/`)

| 库                      | 版本    | 用途                   |
| ----------------------- | ------- | ---------------------- |
| `mocha`                 | ^10.2.0 | 测试框架（TDD 风格）   |
| `@vscode/test-electron` | ^2.3.8  | VS Code 集成测试运行器 |
| `@vscode/test-cli`      | ^0.0.4  | 测试 CLI               |
| `sinon`                 | ^17.0.1 | 可用但未积极使用       |

### 上游 opencode (`packages/opencode/`)

| 库         | 版本 | 用途                |
| ---------- | ---- | ------------------- |
| `bun:test` | 内置 | 原生 Bun 测试运行器 |

## 覆盖率

### WebGUI 覆盖率配置

```typescript
// vitest.config.ts
coverage: {
  provider: "v8",
  reporter: ["text", "json", "html"],
  exclude: [
    "node_modules/",
    "src/test/",
    "**/*.d.ts",
    "**/*.config.*",
    "**/mockData",
    "**/*.test.{ts,tsx}",
  ],
}
```

**运行覆盖率：**

```bash
cd packages/opencode/webgui
bun run test:coverage    # vitest run --coverage
```

### 其他包

VSCode 插件和上游 opencode 未检测到显式覆盖率配置。

## E2E 测试

### Playwright E2E (packages/app/)

`packages/app/`（桌面应用，非 WebGUI）有完善的 Playwright E2E 测试：

- **位置：** `packages/app/e2e/`
- **框架：** `@playwright/test`（版本 1.51.0）
- **配置：** `packages/app/e2e/tsconfig.json`
- **约 50+ 个 spec 文件**，覆盖终端、侧边栏、设置、会话、提示、项目、模型、文件、命令、应用流程
- **不适用于** WebGUI 或 VSCode 插件开发领域

## 测试类型总结

| 领域                                 | 单元测试     | 集成测试                     | E2E 测试   |
| ------------------------------------ | ------------ | ---------------------------- | ---------- |
| WebGUI (`packages/opencode/webgui/`) | Vitest + RTL | Vitest（Context 测试）       | 无         |
| VSCode 插件 (`hosts/vscode-plugin/`) | `node:test`  | Mocha + vscode-test-electron | 无         |
| 上游 opencode (`packages/opencode/`) | `bun:test`   | `bun:test` 配合夹具          | 无         |
| 桌面应用 (`packages/app/`)           | Vitest       | —                            | Playwright |

## 关键测试规则

1. **不要从仓库根目录运行测试** — 有保护机制：`echo 'do not run tests from root' && exit 1`
2. **尽可能避免 mock** — 测试实际实现
3. **不要在测试中复制逻辑** — 测试真实代码，而非重新实现
4. **从包目录运行：**
   - `packages/opencode/webgui/` 用于 WebGUI 测试
   - `packages/opencode/` 用于上游后端测试
   - `hosts/vscode-plugin/` 用于 VSCode 插件测试

---

_测试分析：2026-04-12_
