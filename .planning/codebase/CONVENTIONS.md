# Coding Conventions

**Analysis Date:** 2026-04-12

## Style Guide

### Authoritative Source

The style guide is defined in `AGENTS.md` at the repo root. All rules below are enforced project-wide.

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible (e.g., `Bun.file()`)
- Rely on type inference; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops; use type guards on `filter` to maintain type inference downstream

### Formatting

- **Prettier** (configured in root `package.json`):
  - `semi: false` — no semicolons
  - `printWidth: 120` — line wrap at 120 characters
- **EditorConfig** (`.editorconfig`):
  - `charset: utf-8`
  - `end_of_line: lf`
  - `indent_style: space`
  - `indent_size: 2`
  - `insert_final_newline: true`
- **Husky** (`.husky/`) is configured for git hooks (via `prepare` script)

### Module System

- All packages use `"type": "module"` (ES modules)
- Use `import`/`export` syntax exclusively, never `require()`

### TypeScript Strictness

- WebGUI (`packages/opencode/webgui/tsconfig.app.json`): `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`
- VSCode plugin (`hosts/vscode-plugin/tsconfig.json`): standard TypeScript compilation
- Root extends `@tsconfig/bun/tsconfig.json`
- Type checking: always run `bun typecheck` from package directories, never `tsc` directly

## Naming Conventions

### MANDATORY Naming Enforcement (Agent-Written Code)

This rule is mandatory. Use single word names by default for new locals, params, and helper functions:

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

**Preferred short names:** `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`

**Avoid unless truly required:** `inputPID`, `existingClient`, `connectTimeout`, `workerPath`

### Files

- **WebGUI components:** PascalCase for React components (`MessageInput.tsx`, `CompactHeader/`, `SubtaskDrawer/`)
- **WebGUI hooks:** camelCase prefixed with `use` (`useDebounce.ts`, `useClickOutside.ts`)
- **WebGUI state:** PascalCase for Context files (`SessionContext.tsx`, `ThemeContext.tsx`), camelCase for stores (`tabStore.ts`, `scopedStorage.ts`)
- **WebGUI lib/utils:** camelCase (`ideBridge.ts`, `classNames.ts`, `formatting.ts`)
- **WebGUI repos (state/repo/):** camelCase suffixed with `Repo` (`draftRepo.ts`, `tabsRepo.ts`, `themeRepo.ts`)
- **VSCode plugin:** PascalCase for classes (`BackendLauncher.ts`, `WebviewManager.ts`, `ErrorHandler.ts`)
- **VSCode plugin commands:** PascalCase (`AddToContextCommand.ts`, `PastePathCommand.ts`)
- **Test files:** co-located, same name with `.test.ts` or `.test.tsx` suffix (`tabPolicy.test.ts`, `SessionContext.test.tsx`)
- **Test files (topic-scoped):** dot-separated topic suffix before `.test` (`MessagesContext.questions.test.tsx`, `MessagesContext.pagination.test.tsx`)
- **Upstream opencode schemas:** snake_case suffixed with `.sql.ts` (`session.sql.ts`, `project.sql.ts`)

### Variables and Functions

- Prefer single word names: `gate`, `draft`, `proc`, `conn`
- camelCase when multi-word is necessary: `handleNewSession`, `loadSessionMessages`
- React callback handlers: prefix with `handle` (`handleRetrySessionLoad`, `handleOpenPanel`)
- Boolean variables: use `is`/`has` prefix when needed (`isCreating`, `isRunning`, `disposed`)

### Types and Interfaces

- PascalCase for types and interfaces: `Message`, `StorageScope`, `ClassNameValue`
- Type-only imports: use `import type` when importing types only
- Branded schemas use `Schema.brand` for single-value types (upstream Effect code)

### Drizzle Schema (Database)

Use snake_case for field names so column names don't need to be redefined as strings:

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context:

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

**Exception observed:** React hooks return values are commonly destructured in the WebGUI codebase (e.g., `const { currentSession, sessions } = useSession()`). This is accepted for React hook patterns.

## Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment:

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

Reduce total variable count by inlining when a value is only used once:

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

## Control Flow

Avoid `else` statements. Prefer early returns:

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

## File Organization Patterns

### WebGUI (`packages/opencode/webgui/src/`)

```
src/
├── components/     # React components (PascalCase), may have subdirectories
├── hooks/          # Custom React hooks (useXxx.ts)
├── lib/            # Non-React logic, utilities, API clients
│   ├── api/        # API client, events, SDK wrappers
│   └── selection/  # Selection logic
├── state/          # React contexts and state management
│   └── repo/       # Data repositories (scoped storage wrappers)
├── config/         # Configuration constants
├── types/          # Shared type definitions
├── utils/          # Pure utility functions
├── test/           # Test setup, helpers, mocks
├── assets/         # Static assets
├── App.tsx         # Root application component
└── main.tsx        # Entry point (ReactDOM.createRoot)
```

### VSCode Plugin (`hosts/vscode-plugin/src/`)

```
src/
├── backend/        # Backend process management (launching opencode server)
├── commands/       # VSCode command implementations
├── settings/       # Settings management
├── ui/             # Webview and activity bar providers
├── utils/          # Error handling, file operations
├── types/          # Type definitions
├── test/           # Test suite (Mocha + @vscode/test-electron)
│   └── suite/      # Test files
├── extension.ts    # Entry point (activate/deactivate)
└── globals.ts      # Shared globals (logger)
```

### Upstream opencode (`packages/opencode/src/`)

- Feature modules organized by domain: `session/`, `project/`, `account/`, `share/`, etc.
- Each domain has schema in `*.sql.ts` files
- Effect-based architecture with services

## Common Patterns

### React Context Provider Pattern (WebGUI)

State management uses React Context with a Provider + hook pattern:

```tsx
// State definition in XxxContext.tsx
export function SessionProvider({ children }: { children: React.ReactNode }) {
  // ... state logic
  return <SessionContext.Provider value={...}>{children}</SessionContext.Provider>
}

export function useSession() {
  return useContext(SessionContext)
}
```

Providers are nested in `main.tsx` at the application root in a specific order.

### Testable Pure Functions Extracted from Components (WebGUI)

Complex logic is extracted as pure, exported functions that can be tested without React rendering:

```ts
// In App.tsx - extracted pure functions
export function chatState(input: { loading: boolean; loaded: boolean; error: boolean; ready: boolean }) {
  if (input.ready) return { loading: false, error: false, blocked: false }
  const loading = input.loading || (!input.loaded && !input.error)
  return { loading, error: !loading && input.error, blocked: loading || input.error }
}
```

### Scoped Storage / Repo Pattern (WebGUI)

Data repositories in `state/repo/` wrap scoped storage operations with business logic:

```ts
// draftRepo.ts pattern
export async function loadDrafts(): Promise<Record<string, string>> { ... }
export async function saveDrafts(drafts: Record<string, string>): Promise<void> { ... }
export function resetDraftRepoForTest(): void { ... }  // Test reset function
```

### VSCode Extension Class Pattern

The VSCode extension uses a class-based pattern with lifecycle management:

```ts
class OpenCodeExtension {
  private webviewManager?: WebviewManager
  // Initialize, register commands, coordinate components
  async initialize(context: vscode.ExtensionContext): Promise<void> { ... }
  dispose(): void { ... }
}

// Module-level singleton
let extensionInstance: OpenCodeExtension | undefined
export async function activate(context: vscode.ExtensionContext): Promise<void> { ... }
export function deactivate(): void { ... }
```

### IDE Bridge Communication

WebGUI communicates with the host IDE via HTTP-based SSE bridge (`lib/ideBridge.ts`):

- Uses EventSource for server-sent events
- Request/response via POST with correlation IDs
- Reconnection with exponential backoff
- Scoped storage (global/workspace/mem) for state persistence

### Typing Indicator Pattern

The `cn()` utility in `utils/classNames.ts` provides a custom className merging function (similar to `clsx`):

```ts
cn("foo", condition && "bar", { baz: true }) // => 'foo bar baz'
```

## Error Handling

### WebGUI

- Errors from SDK calls return `{ data, error }` tuples — check `error` field rather than using try/catch
- Toast notifications for user-facing errors via `useToast()` context
- `ErrorBoundary` component wraps the entire app for React rendering errors
- Console logging with `[Component]` prefixes for debug: `console.log("[App] Session created:", id)`

### VSCode Plugin

- Centralized `ErrorHandler` utility with categorized errors (`ErrorCategory`, `ErrorSeverity`)
- `errorHandler.handleError()` with structured error contexts
- Specialized handlers: `handleBackendLaunchError()`, `handleWebviewLoadError()`, `handleFileOperationError()`
- Safe disposal pattern: errors during dispose are caught and logged, cleanup continues:

```ts
const drop = (name: string, fn: () => void) => {
  try {
    fn()
  } catch (err) {
    logger.appendLine(`dispose ${name} failed: ${err}`)
  }
}
```

### Upstream opencode

- Effect-based error handling with `Schema.TaggedErrorClass` for typed errors
- `yield* new MyError(...)` for early failure in `Effect.gen` / `Effect.fn`
- Avoid `try`/`catch` as stated in AGENTS.md

## Import/Export Patterns

### WebGUI Import Order (Observed)

1. React imports (`react`, `react-dom`)
2. Testing library imports (in test files)
3. Internal lib/api imports (`./lib/api/events`, `./lib/api/sdkClient`)
4. Internal state imports (`./state/SessionContext`, `./state/ToastContext`)
5. Internal component imports (`./components/MessageInput`, etc.)
6. Internal hook imports (`./hooks/useKeyboardShortcuts`)
7. Internal util imports (`./utils/classNames`)

### WebGUI Re-exports

Test utilities use re-export pattern:

```ts
// test/test-utils.tsx
export * from "@testing-library/react"
export { customRender as render }
```

### VSCode Plugin Import Order

1. VSCode API (`import * as vscode from "vscode"`)
2. Internal module imports (relative paths)
3. Node.js built-ins when needed

### Path Aliases

- WebGUI uses `@/` alias mapped to `./src/` (configured in `vitest.config.ts`, but not consistently used — most imports use relative paths)

### Module Exports

- WebGUI: named exports preferred over default exports (exception: `App.tsx` default export)
- Upstream: barrel exports from `exports` field in `package.json`: `"./*": "./src/*.ts"`
- VSCode plugin: named class exports

## Language Notes

- Some test descriptions and UI strings are in Chinese (e.g., `"replyQuestion 遇到结构化 error 时不应移除本地问题"`, `"创建会话失败"`)
- This is intentional and part of the codebase conventions for this fork

---

_Convention analysis: 2026-04-12_
