## Conventions

### 通用原则

- 除非需要组合或复用，否则将逻辑保留在一个函数中
- 尽可能避免 `try`/`catch`
- 避免使用 `any` 类型
- 尽可能使用单词变量名
- 尽可能使用 Bun API（例如 `Bun.file()`）
- 依赖类型推断；除非为了导出或清晰性，否则避免显式类型注解或接口
- 优先使用函数式数组方法（`flatMap`、`filter`、`map`）而非 `for` 循环；在 `filter` 上使用类型守卫以维持下游的类型推断
- 在 `src/config` 中新增配置模块时，遵循文件顶部已有的 self-export 模式

### 模块系统

- 所有包使用 `"type": "module"`（ES 模块）
- 仅使用 `import`/`export` 语法，不使用 `require()`
- 仅导入类型时使用 `import type`

### TypeScript 严格性

- WebGUI：`strict: true`、`noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`
- 根目录继承 `@tsconfig/bun/tsconfig.json`
- 类型检查：始终从包目录运行 `bun typecheck`，不直接使用 `tsc`

### 格式化

- Prettier（semi: false, printWidth: 120）
- EditorConfig（`.editorconfig`）
- Husky git hooks

---

## 命名规范

### 文件

| 区域             | 规则                                | 示例                                      |
| ---------------- | ----------------------------------- | ----------------------------------------- |
| WebGUI 组件      | PascalCase                          | `MessageInput.tsx`、`SubtaskDrawer/`      |
| WebGUI hooks     | camelCase + `use` 前缀              | `useDebounce.ts`                          |
| WebGUI 状态      | Context=PascalCase, store=camelCase | `SessionContext.tsx`、`tabStore.ts`       |
| WebGUI lib/utils | camelCase                           | `ideBridge.ts`、`formatting.ts`           |
| WebGUI repos     | camelCase + `Repo` 后缀             | `draftRepo.ts`、`tabsRepo.ts`             |
| VSCode 插件类    | PascalCase                          | `BackendLauncher.ts`、`WebviewManager.ts` |
| VSCode 命令      | PascalCase                          | `AddToContextCommand.ts`                  |
| 测试文件         | 同名 + `.test.ts(x)`                | `tabPolicy.test.ts`                       |
| 测试（主题范围） | 点分隔主题                          | `MessagesContext.questions.test.tsx`      |
| 上游 schema      | snake_case + `.sql.ts`              | `session.sql.ts`                          |

### 变量和函数

- 优先单词名称：`gate`、`draft`、`proc`、`conn`
- 多词 camelCase：`handleNewSession`、`loadSessionMessages`
- React 回调：`handle` 前缀
- 布尔：`is`/`has` 前缀（`isCreating`、`isRunning`）

### 类型和接口

- PascalCase：`Message`、`StorageScope`
- 品牌 schema 使用 `Schema.brand`（上游 Effect 代码）

---

## 常用模式

### Complex Logic

主函数读作 happy path，支撑细节放到下方小 helper：

```ts
export function loadThing(input: unknown) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input: unknown) { ... }
```

- helper 紧跟使用处，不过度抽象
- 同步逻辑不返回 `Effect`
- 优先用 `Schema.UnknownFromJsonString` / `Schema.decodeUnknownOption` 而非手动 `JSON.parse`
- 注释只写非显而易见的约束和意外行为

### IDE 桥接通信

- EventSource 接收服务端推送
- POST + 关联 ID 实现请求/响应
- 指数退避重连
- Scoped storage（global/workspace/mem）持久化

### 错误处理

| 层            | 策略                                                                         |
| ------------- | ---------------------------------------------------------------------------- |
| WebGUI        | SDK 返回 `{ data, error }` 元组；`useToast()` 显示错误；`ErrorBoundary` 兜底 |
| VSCode        | 集中式 `ErrorHandler`，分类错误（`ErrorCategory`、`ErrorSeverity`）          |
| 上游 opencode | Effect `Schema.TaggedErrorClass`；`yield* new MyError(...)` 提前失败         |

### 导入/导出

- WebGUI：命名导出优先（例外：`App.tsx` 默认导出）
- 上游：`package.json` exports 桶导出 `"./*": "./src/*.ts"`
- VSCode 插件：命名类导出
- `@/` 别名映射到 `./src/`（vitest 配置，但大多数用相对路径）

### 语言说明

- 部分测试描述和 UI 字符串使用中文，这是有意为之的代码库规范
