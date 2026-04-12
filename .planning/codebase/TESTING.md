# Testing Patterns

**Analysis Date:** 2026-04-12

## Test Frameworks

This project uses **three different test runners** across different packages:

### 1. Vitest (WebGUI Frontend)

- **Package:** `packages/opencode/webgui/`
- **Version:** 4.0.13
- **Config:** `packages/opencode/webgui/vitest.config.ts`
- **Environment:** jsdom
- **Globals:** enabled (`globals: true`)
- **Setup:** `packages/opencode/webgui/src/test/setup.ts`
- **Coverage:** v8 provider with text/json/html reporters

### 2. Bun Test (Upstream opencode)

- **Package:** `packages/opencode/`
- **Import:** `import { describe, expect, test } from "bun:test"`
- **Timeout:** 30000ms default
- **No Jest/Vitest required** — uses native Bun test runner

### 3. Mocha + @vscode/test-electron (VSCode Plugin)

- **Package:** `hosts/vscode-plugin/`
- **Framework:** Mocha with TDD UI (`suite`/`test`/`setup`/`teardown`)
- **Test runner:** `@vscode/test-electron` for integration tests
- **Config:** `hosts/vscode-plugin/src/test/suite/index.ts` (Mocha runner setup)
- **Timeout:** 20000ms
- **Assertions:** Node.js built-in `assert` module
- **Some unit tests** use `node:test` directly (e.g., `kill.test.ts`, `loading.test.ts`)

## Test Commands

```bash
# CRITICAL: Tests cannot run from repo root!
# Root has a guard: "do not run tests from root"

# WebGUI (Vitest)
cd packages/opencode/webgui
bun run test           # Watch mode
bun run test:run       # Single run
bun run test:coverage  # Coverage report
bun run test:ui        # Vitest UI

# Upstream opencode (Bun test)
cd packages/opencode
bun test --timeout 30000

# VSCode Plugin (Mocha + @vscode/test-electron)
cd hosts/vscode-plugin
pnpm run pretest       # Compile + lint first
pnpm run test          # vscode-test runner (requires VS Code)
```

## Test File Organization

### Co-located Tests (WebGUI)

Test files live alongside their source files with `.test.ts` / `.test.tsx` suffix:

```
packages/opencode/webgui/src/
├── state/
│   ├── tabPolicy.ts
│   ├── tabPolicy.test.ts              # Unit test for pure logic
│   ├── SessionContext.tsx
│   ├── SessionContext.test.tsx         # Context test
│   ├── MessagesContext.tsx
│   ├── MessagesContext.questions.test.tsx      # Topic-scoped test
│   ├── MessagesContext.pagination.test.tsx     # Topic-scoped test
│   ├── MessagesContext.reasoning.test.tsx      # Topic-scoped test
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
    ├── setup.ts                       # Global test setup
    ├── test-utils.tsx                 # Custom render helper
    └── legacyStorageGate.test.ts
```

**Topic-scoped naming convention:** For files with many test concerns, use dot-separated topic names before `.test`: `MessagesContext.questions.test.tsx`, `sdkClient.migration.test.ts`

### Separate Test Directory (Upstream opencode)

```
packages/opencode/
├── src/
│   └── util/
│       └── lazy.ts
└── test/
    └── util/
        └── lazy.test.ts               # Mirrors src/ structure
```

### Separate Test Suite (VSCode Plugin)

```
hosts/vscode-plugin/src/
├── backend/
│   ├── BackendLauncher.ts
│   └── kill.test.ts                   # Co-located unit test (node:test)
├── ui/
│   └── loading.test.ts               # Co-located unit test (node:test)
└── test/
    ├── runTest.ts                     # @vscode/test-electron launcher
    └── suite/
        ├── index.ts                   # Mocha test runner config
        ├── extension.test.ts          # Integration test
        ├── backendLauncher.test.ts    # Integration test
        ├── ideBridgeServer.test.ts
        ├── settingsManager.test.ts
        └── ...
```

**VSCode plugin has two test approaches:**

- `node:test` for pure unit tests that don't need VS Code API (co-located with source)
- Mocha + `@vscode/test-electron` for tests requiring VS Code API (in `src/test/suite/`)

## Test Structure

### Vitest Pattern (WebGUI)

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

describe("featureName", () => {
  beforeEach(() => {
    vi.useFakeTimers() // When testing async/timers
    vi.resetAllMocks() // Reset mock state
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

### Bun Test Pattern (Upstream opencode)

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

### Mocha TDD Pattern (VSCode Plugin - Integration)

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

### Node.js Built-in Test Pattern (VSCode Plugin - Unit)

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

## Mocking

### AGENTS.md Policy

> Avoid mocks as much as possible. Test actual implementation, do not duplicate logic into tests.

### Vitest Mocking (When Needed)

**Module mocking with `vi.mock` (hoisted):**

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

**Spy on global APIs:**

```typescript
const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
  new Response(JSON.stringify({ tools: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
)
```

**Fake timers:**

```typescript
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// In test
await act(async () => {
  vi.advanceTimersByTime(500)
})
```

### VSCode Plugin Mocking (Mocha)

Uses direct prototype patching and function replacement (no Sinon — despite being a devDependency, tests prefer manual mocks):

```typescript
// Prototype patching
const original = WebviewManager.prototype.dispose
WebviewManager.prototype.dispose = function () {
  calls.push("webview")
}
try {
  // test logic
} finally {
  WebviewManager.prototype.dispose = original // Always restore in finally
}

// Direct property injection for internal testing
;(launcher as unknown as { currentProcess?: typeof proc }).currentProcess = proc
```

### Manual Stub Pattern (VSCode Plugin)

For dependency injection in tests:

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

## Test Helpers and Fixtures

### WebGUI Test Setup (`packages/opencode/webgui/src/test/setup.ts`)

Global setup runs before all tests:

- Imports `@testing-library/jest-dom` for DOM matchers
- Runs `cleanup()` after each test
- Mocks `window.matchMedia`, `IntersectionObserver`, `ResizeObserver`

### WebGUI Custom Render (`packages/opencode/webgui/src/test/test-utils.tsx`)

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

### WebGUI Context Test Pattern (Capture Hook)

Common pattern for testing React context/hooks:

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

// Test accesses `api` directly
expect(api?.getQuestionsBySession("s1").map((q) => q.id)).toEqual(["q1"])
```

### Test Reset Functions

Modules that maintain internal state expose reset functions for testing:

```typescript
// In source file
export function resetDraftRepoForTest(): void {
  /* clear internal caches */
}
export function resetScopedStateForTest(): void {
  /* clear caches */
}

// In test
beforeEach(() => {
  vi.resetAllMocks()
  resetDraftRepoForTest()
})
```

### Upstream opencode Test Fixtures

The upstream `packages/opencode/test/` has a fixture system (documented in `packages/opencode/test/AGENTS.md`):

```typescript
import { tmpdir } from "./fixture/fixture"

test("example", async () => {
  await using tmp = await tmpdir()
  // tmp.path is the temp directory
  // automatically cleaned up via Symbol.asyncDispose
})

// With git repo
await using tmp = await tmpdir({ git: true })

// With config
await using tmp = await tmpdir({
  config: { model: "test/model", username: "testuser" },
})
```

## Testing Libraries

### WebGUI (`packages/opencode/webgui/`)

| Library                       | Version | Purpose                     |
| ----------------------------- | ------- | --------------------------- |
| `vitest`                      | 4.0.13  | Test runner                 |
| `@vitest/ui`                  | 4.0.13  | Visual test UI              |
| `@testing-library/react`      | 16.3.0  | React component testing     |
| `@testing-library/jest-dom`   | 6.9.1   | DOM assertion matchers      |
| `@testing-library/user-event` | 14.6.1  | User interaction simulation |
| `jsdom`                       | 27.2.0  | DOM environment             |
| `happy-dom`                   | 20.0.10 | Alternative DOM (available) |

### VSCode Plugin (`hosts/vscode-plugin/`)

| Library                 | Version | Purpose                         |
| ----------------------- | ------- | ------------------------------- |
| `mocha`                 | ^10.2.0 | Test framework (TDD style)      |
| `@vscode/test-electron` | ^2.3.8  | VS Code integration test runner |
| `@vscode/test-cli`      | ^0.0.4  | Test CLI                        |
| `sinon`                 | ^17.0.1 | Available but not actively used |

### Upstream opencode (`packages/opencode/`)

| Library    | Version  | Purpose                |
| ---------- | -------- | ---------------------- |
| `bun:test` | built-in | Native Bun test runner |

## Coverage

### WebGUI Coverage Configuration

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

**Run coverage:**

```bash
cd packages/opencode/webgui
bun run test:coverage    # vitest run --coverage
```

### Other Packages

No explicit coverage configuration detected for VSCode plugin or upstream opencode.

## E2E Tests

### Playwright E2E (packages/app/)

The `packages/app/` (desktop app, not WebGUI) has extensive Playwright E2E tests:

- **Location:** `packages/app/e2e/`
- **Framework:** `@playwright/test` (version 1.51.0)
- **Config:** `packages/app/e2e/tsconfig.json`
- **~50+ spec files** covering terminal, sidebar, settings, session, prompt, projects, models, files, commands, app flows
- **Not applicable** to the WebGUI or VSCode plugin development areas

## Test Types Summary

| Area                                     | Unit         | Integration                  | E2E        |
| ---------------------------------------- | ------------ | ---------------------------- | ---------- |
| WebGUI (`packages/opencode/webgui/`)     | Vitest + RTL | Vitest (context tests)       | None       |
| VSCode Plugin (`hosts/vscode-plugin/`)   | `node:test`  | Mocha + vscode-test-electron | None       |
| Upstream opencode (`packages/opencode/`) | `bun:test`   | `bun:test` with fixtures     | None       |
| Desktop app (`packages/app/`)            | Vitest       | —                            | Playwright |

## Key Testing Rules

1. **Never run tests from repo root** — there is a guard: `echo 'do not run tests from root' && exit 1`
2. **Avoid mocks as much as possible** — test actual implementation
3. **Do not duplicate logic into tests** — test the real code, not reimplementations
4. **Run from package directories:**
   - `packages/opencode/webgui/` for WebGUI tests
   - `packages/opencode/` for upstream backend tests
   - `hosts/vscode-plugin/` for VSCode plugin tests

---

_Testing analysis: 2026-04-12_
