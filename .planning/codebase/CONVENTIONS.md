# 编码规范

**分析日期：** 2026-04-12

## 风格指南

### 权威来源

风格指南定义在仓库根目录的 `AGENTS.md` 中。以下所有规则在项目范围内强制执行。

### 通用原则

- 除非需要组合或复用，否则将逻辑保留在一个函数中
- 尽可能避免 `try`/`catch`
- 避免使用 `any` 类型
- 尽可能使用单词变量名
- 尽可能使用 Bun API（例如 `Bun.file()`）
- 依赖类型推断；除非为了导出或清晰性，否则避免显式类型注解或接口
- 优先使用函数式数组方法（`flatMap`、`filter`、`map`）而非 `for` 循环；在 `filter` 上使用类型守卫以维持下游的类型推断

### 格式化

- **Prettier**（在根 `package.json` 中配置）：
  - `semi: false` — 不使用分号
  - `printWidth: 120` — 120 字符处换行
- **EditorConfig**（`.editorconfig`）：
  - `charset: utf-8`
  - `end_of_line: lf`
  - `indent_style: space`
  - `indent_size: 2`
  - `insert_final_newline: true`
- **Husky**（`.husky/`）配置了 git hooks（通过 `prepare` 脚本）

### 模块系统

- 所有包使用 `"type": "module"`（ES 模块）
- 仅使用 `import`/`export` 语法，不使用 `require()`

### TypeScript 严格性

- WebGUI（`packages/opencode/webgui/tsconfig.app.json`）：`strict: true`、`noUnusedLocals: true`、`noUnusedParameters: true`、`noFallthroughCasesInSwitch: true`
- VSCode 插件（`hosts/vscode-plugin/tsconfig.json`）：标准 TypeScript 编译
- 根目录继承 `@tsconfig/bun/tsconfig.json`
- 类型检查：始终从包目录运行 `bun typecheck`，不直接使用 `tsc`

## 命名规范

### 强制命名规则（Agent 编写的代码）

此规则为强制性。新的局部变量、参数和辅助函数默认使用单词命名：

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

**推荐短名称：** `pid`、`cfg`、`err`、`opts`、`dir`、`root`、`child`、`state`、`timeout`

**除非确实需要否则避免：** `inputPID`、`existingClient`、`connectTimeout`、`workerPath`

### 文件

- **WebGUI 组件：** React 组件使用 PascalCase（`MessageInput.tsx`、`CompactHeader/`、`SubtaskDrawer/`）
- **WebGUI hooks：** camelCase 并以 `use` 为前缀（`useDebounce.ts`、`useClickOutside.ts`）
- **WebGUI 状态：** Context 文件使用 PascalCase（`SessionContext.tsx`、`ThemeContext.tsx`），store 使用 camelCase（`tabStore.ts`、`scopedStorage.ts`）
- **WebGUI lib/utils：** camelCase（`ideBridge.ts`、`classNames.ts`、`formatting.ts`）
- **WebGUI repos（state/repo/）：** camelCase 并以 `Repo` 为后缀（`draftRepo.ts`、`tabsRepo.ts`、`themeRepo.ts`）
- **VSCode 插件：** 类使用 PascalCase（`BackendLauncher.ts`、`WebviewManager.ts`、`ErrorHandler.ts`）
- **VSCode 插件命令：** PascalCase（`AddToContextCommand.ts`、`PastePathCommand.ts`）
- **测试文件：** 同名并置，添加 `.test.ts` 或 `.test.tsx` 后缀（`tabPolicy.test.ts`、`SessionContext.test.tsx`）
- **测试文件（主题范围）：** 在 `.test` 前使用点分隔的主题后缀（`MessagesContext.questions.test.tsx`、`MessagesContext.pagination.test.tsx`）
- **上游 opencode schema：** snake_case 并以 `.sql.ts` 为后缀（`session.sql.ts`、`project.sql.ts`）

### 变量和函数

- 优先使用单词名称：`gate`、`draft`、`proc`、`conn`
- 多词时使用 camelCase：`handleNewSession`、`loadSessionMessages`
- React 回调处理程序：以 `handle` 为前缀（`handleRetrySessionLoad`、`handleOpenPanel`）
- 布尔变量：需要时使用 `is`/`has` 前缀（`isCreating`、`isRunning`、`disposed`）

### 类型和接口

- 类型和接口使用 PascalCase：`Message`、`StorageScope`、`ClassNameValue`
- 仅类型导入：仅导入类型时使用 `import type`
- 品牌 schema 使用 `Schema.brand` 用于单值类型（上游 Effect 代码）

### Drizzle Schema（数据库）

字段名使用 snake_case，这样列名不需要重新定义为字符串：

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

## 解构

避免不必要的解构。使用点号表示法以保留上下文：

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

**观察到的例外：** WebGUI 代码库中 React hooks 的返回值通常会解构（例如 `const { currentSession, sessions } = useSession()`）。这对于 React hook 模式是可接受的。

## 变量

优先使用 `const` 而非 `let`。使用三元运算符或提前返回代替重赋值：

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

当值只使用一次时，通过内联减少变量总数：

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

## 控制流

避免 `else` 语句。优先使用提前返回：

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

## 文件组织模式

### WebGUI (`packages/opencode/webgui/src/`)

```
src/
├── components/     # React 组件（PascalCase），可含子目录
├── hooks/          # 自定义 React hooks（useXxx.ts）
├── lib/            # 非 React 逻辑、工具、API 客户端
│   ├── api/        # API 客户端、事件、SDK 包装器
│   └── selection/  # 选择逻辑
├── state/          # React Context 和状态管理
│   └── repo/       # 数据仓库（scoped storage 包装器）
├── config/         # 配置常量
├── types/          # 共享类型定义
├── utils/          # 纯工具函数
├── test/           # 测试设置、辅助函数、mock
├── assets/         # 静态资源
├── App.tsx         # 根应用组件
└── main.tsx        # 入口点（ReactDOM.createRoot）
```

### VSCode 插件 (`hosts/vscode-plugin/src/`)

```
src/
├── backend/        # 后端进程管理（启动 opencode 服务器）
├── commands/       # VSCode 命令实现
├── settings/       # 设置管理
├── ui/             # Webview 和活动栏提供者
├── utils/          # 错误处理、文件操作
├── types/          # 类型定义
├── test/           # 测试套件（Mocha + @vscode/test-electron）
│   └── suite/      # 测试文件
├── extension.ts    # 入口点（activate/deactivate）
└── globals.ts      # 共享全局变量（logger）
```

### 上游 opencode (`packages/opencode/src/`)

- 按领域组织的功能模块：`session/`、`project/`、`account/`、`share/` 等
- 每个领域在 `*.sql.ts` 文件中有 schema
- 基于 Effect 的架构和服务

## 常用模式

### React Context Provider 模式（WebGUI）

状态管理使用 React Context 的 Provider + hook 模式：

```tsx
// XxxContext.tsx 中的状态定义
export function SessionProvider({ children }: { children: React.ReactNode }) {
  // ... 状态逻辑
  return <SessionContext.Provider value={...}>{children}</SessionContext.Provider>
}

export function useSession() {
  return useContext(SessionContext)
}
```

Provider 在 `main.tsx` 的应用根部按特定顺序嵌套。

### 从组件中提取可测试的纯函数（WebGUI）

复杂逻辑被提取为导出的纯函数，可在不渲染 React 的情况下测试：

```ts
// 在 App.tsx 中 - 提取的纯函数
export function chatState(input: { loading: boolean; loaded: boolean; error: boolean; ready: boolean }) {
  if (input.ready) return { loading: false, error: false, blocked: false }
  const loading = input.loading || (!input.loaded && !input.error)
  return { loading, error: !loading && input.error, blocked: loading || input.error }
}
```

### Scoped Storage / Repo 模式（WebGUI）

`state/repo/` 中的数据仓库用业务逻辑包装 scoped storage 操作：

```ts
// draftRepo.ts 模式
export async function loadDrafts(): Promise<Record<string, string>> { ... }
export async function saveDrafts(drafts: Record<string, string>): Promise<void> { ... }
export function resetDraftRepoForTest(): void { ... }  // 测试重置函数
```

### VSCode 扩展类模式

VSCode 扩展使用基于类的模式，带有生命周期管理：

```ts
class OpenCodeExtension {
  private webviewManager?: WebviewManager
  // 初始化、注册命令、协调组件
  async initialize(context: vscode.ExtensionContext): Promise<void> { ... }
  dispose(): void { ... }
}

// 模块级单例
let extensionInstance: OpenCodeExtension | undefined
export async function activate(context: vscode.ExtensionContext): Promise<void> { ... }
export function deactivate(): void { ... }
```

### IDE 桥接通信

WebGUI 通过基于 HTTP 的 SSE 桥接与宿主 IDE 通信（`lib/ideBridge.ts`）：

- 使用 EventSource 接收服务端推送事件
- 通过 POST 请求配合关联 ID 实现请求/响应
- 指数退避重连
- Scoped storage（global/workspace/mem）用于状态持久化

### 输入指示器模式

`utils/classNames.ts` 中的 `cn()` 工具提供自定义的 className 合并函数（类似 `clsx`）：

```ts
cn("foo", condition && "bar", { baz: true }) // => 'foo bar baz'
```

## 错误处理

### WebGUI

- SDK 调用的错误返回 `{ data, error }` 元组——检查 `error` 字段而非使用 try/catch
- 通过 `useToast()` context 以 Toast 通知显示面向用户的错误
- `ErrorBoundary` 组件包裹整个应用以捕获 React 渲染错误
- 使用 `[Component]` 前缀的 console 日志用于调试：`console.log("[App] Session created:", id)`

### VSCode 插件

- 集中式 `ErrorHandler` 工具，带分类错误（`ErrorCategory`、`ErrorSeverity`）
- `errorHandler.handleError()` 带结构化错误上下文
- 特化处理程序：`handleBackendLaunchError()`、`handleWebviewLoadError()`、`handleFileOperationError()`
- 安全释放模式：释放期间的错误被捕获和记录，清理继续：

```ts
const drop = (name: string, fn: () => void) => {
  try {
    fn()
  } catch (err) {
    logger.appendLine(`dispose ${name} failed: ${err}`)
  }
}
```

### 上游 opencode

- 基于 Effect 的错误处理，使用 `Schema.TaggedErrorClass` 实现类型化错误
- `yield* new MyError(...)` 用于在 `Effect.gen` / `Effect.fn` 中提前失败
- 如 AGENTS.md 所述，避免 `try`/`catch`

## 导入/导出模式

### WebGUI 导入顺序（观察到的）

1. React 导入（`react`、`react-dom`）
2. 测试库导入（测试文件中）
3. 内部 lib/api 导入（`./lib/api/events`、`./lib/api/sdkClient`）
4. 内部 state 导入（`./state/SessionContext`、`./state/ToastContext`）
5. 内部 component 导入（`./components/MessageInput` 等）
6. 内部 hook 导入（`./hooks/useKeyboardShortcuts`）
7. 内部 util 导入（`./utils/classNames`）

### WebGUI 重导出

测试工具使用重导出模式：

```ts
// test/test-utils.tsx
export * from "@testing-library/react"
export { customRender as render }
```

### VSCode 插件导入顺序

1. VSCode API（`import * as vscode from "vscode"`）
2. 内部模块导入（相对路径）
3. 需要时导入 Node.js 内置模块

### 路径别名

- WebGUI 使用 `@/` 别名映射到 `./src/`（在 `vitest.config.ts` 中配置，但未一致使用——大多数导入使用相对路径）

### 模块导出

- WebGUI：优先使用命名导出而非默认导出（例外：`App.tsx` 的默认导出）
- 上游：通过 `package.json` 的 `exports` 字段进行桶导出：`"./*": "./src/*.ts"`
- VSCode 插件：命名类导出

## 语言说明

- 部分测试描述和 UI 字符串使用中文（例如 `"replyQuestion 遇到结构化 error 时不应移除本地问题"`、`"创建会话失败"`）
- 这是有意为之，属于本分叉的代码库规范

---

_规范分析：2026-04-12_
