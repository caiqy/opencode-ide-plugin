# 文件写入工具的实时流式预览

> webgui 在 write / edit / apply_patch 三件套执行期间实时显示已接收的内容与行数。

## 背景

当前 webgui 渲染 `write` / `edit` / `apply_patch` 三个工具时，必须等到 `state.status === "completed"` 才会一次性显示内容（`packages/opencode/webgui/src/components/parts/ToolPart/index.tsx:155-161`）。大文件场景下，模型流式生成 `content` / `newString` / `patchText` 这一段时间——通常占整个工具调用耗时的 90%——webgui 上呈现为一个空 pending 卡片。

调研发现整条流式管线已经存在：

- LLM 协议层：所有 provider（OpenAI / Anthropic / Gemini / Bedrock）都按 token 增量发送 `tool-input-delta` 事件，schema 定义在 `packages/llm/src/schema/events.ts:135`。
- Session 处理层：`packages/opencode/src/session/processor.ts:377-380` 明确丢弃了这些 delta，注释写着 "no current consumer"。Schema 上 `ToolStatePending.raw: Schema.String`（`message-v2.ts:259`）就是为这个场景预留的字段。
- TUI v2：`sync-v2.tsx:346-350` 已经累积 delta 到 `state.input`。
- webgui：完全不读 partial，三件套子组件 `WriteTool.tsx` / `EditTool.tsx` 仅在完成态渲染。
- 依赖：`packages/opencode/package.json:157` 已声明 `partial-json@0.1.7`，目前仓库无任何 import。

所以这次优化是**接通既有但被截断的那一段**，不是从零搭建流式系统。

## 目标

`pending` 状态下的 `write` / `edit` / `apply_patch` 工具卡片：

1. Header 实时显示 `已接收 N 行`。
2. 卡片自动展开，展开区按 partial JSON 解析后的字段渲染：
   - `write` → 流入的 `content`，沿用 `WriteTool` 子组件
   - `edit` → 流入的 `newString` 当作增量预览，沿用 `WriteTool` 子组件
   - `apply_patch` → 流入的 `patchText`，沿用 `WriteTool` 子组件
3. completed 后切回原渲染（`WriteTool` 完整内容 / `EditTool` 真实 diff）。
4. 大文件下不能造成滚动卡顿、UI 失响应。

非目标：

- 不优化其他工具（`shell` 已经实时输出；`todo` / `task` / `read` args 较短，不构成痛点）。
- 不引入新的 schema 字段或 v2 事件，复用现有 `state.raw` 与 part 快照通道。
- 不动 TUI v1/v2 的渲染。

## 架构

整条数据流：

```
LM provider
    │  tool-input-delta { id, name, text }
    ▼
processor.ts handleEvent（修改点 1）
    │  写 state.raw 累积；只对三件套生效
    ▼
session.updatePart        （已有）
    │  广播 part 快照
    ▼
webgui MessagesContext    （已有）
    │  part.updated
    ▼
ToolPart/index.tsx        （修改点 2-4）
    │  pending 时 partial 解析 + 行数 + 自动展开
    ▼
WriteTool / EditTool      （0 改动）
```

### 数据通道选型

- **走 part 快照**：复用现有 `session.updatePart` → `part.updated` SE 通道，与 `text-delta` 同一条路径。webgui 已订阅，只需扩展类型与读取逻辑。
- 不走 v2 事件流（`session.next.tool.input.delta`）：webgui 当前不订阅 v2 事件，且需要 `flags.experimentalEventSystem` 才发送，改动面会扩到 webgui 状态机。
- 不走轮询：与 SSE 架构不一致，且实时感取决于轮询频率。

### 累积存储位置

- **写 `state.raw`**：schema 已存在（`message-v2.ts:259`），语义最干净，processor 改动最小（只去掉 376-380 的丢弃分支）。
- 不写 `state.input`：partial JSON 不是合法 JSON，塞进 `Schema.Record(String, Any)` 会污染下游消费。
- 不在后端做增量 JSON 解析：每次 delta 都重复解析 N-1 次前缀，CPU 浪费。

### partial JSON 解析

- **复用 `partial-json@0.1.7`**：仓库已声明该依赖但无任何 import，依赖体积已付费。该库专门为 LLM 输出流设计，行为可控（`Allow.STR | Allow.OBJ | Allow.ARR`）。
- 不自写 `extractStringField` 正则：转义、嵌套对象（`replaceAll: false` 等非字符串字段）会让正则越来越复杂。

### 频率调控

- **前端 `useDeferredValue`**：React 18 内置，零运行时成本，自动把高频 part.updated 折叠进低优先级渲染队列。滚动 / 输入交互永远抢占。
- 不在后端聚合 delta：未来 TUI 若需要更高频更新会受限；前端节流的责任更内聚。
- 不放任不节流：实测一个 5KB 文件可能产生 ~200 次 part.updated，未节流会引发明显卡顿。

## 改动清单

### 1. 后端：`packages/opencode/src/session/processor.ts`

替换 `tool-input-delta` 分支：

```ts
const STREAMABLE_TOOLS = new Set(["write", "edit", "apply_patch"])

case "tool-input-delta": {
  if (!STREAMABLE_TOOLS.has(value.name)) return
  yield* ensureToolCall(value)
  yield* updateToolCall(value.id, (match) => {
    if (match.state.status !== "pending") return match
    return { ...match, state: { ...match.state, raw: match.state.raw + value.text } }
  })
  return
}
```

`ensureToolCall` 已存在（`processor.ts:248-300`），保证 part 已创建；`updateToolCall` 通过 `session.updatePart` 广播。

不限定工具白名单的话，会对所有工具的 args 都做累积写入，造成无意义的 IO（`todo` / `task` 的 args 在 webgui 上完全用不到 partial 渲染）。

### 2. 新文件：`packages/opencode/webgui/src/lib/partial-tool-input.ts`

```ts
import { parse, Allow } from "partial-json"

const ALLOWED = Allow.STR | Allow.OBJ | Allow.ARR

export function parsePartialInput(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = parse(raw, ALLOWED)
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function countLines(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0
  let count = 1
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) count++
  return count
}
```

### 3. 新文件：`packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts`

```ts
import { useDeferredValue, useMemo } from "react"
import { parsePartialInput } from "../../../lib/partial-tool-input"

const STREAMABLE = new Set(["write", "edit", "apply_patch"])

export function usePartialToolInput(tool: string, status: string, raw: string | undefined) {
  const deferredRaw = useDeferredValue(raw ?? "")
  return useMemo(() => {
    if (status !== "pending") return null
    if (!STREAMABLE.has(tool)) return null
    if (!deferredRaw) return null
    return parsePartialInput(deferredRaw)
  }, [status, tool, deferredRaw])
}
```

### 4. 改 `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`

- 内联类型补 `state.raw?: string`（schema 早就有）。
- 顶部加 `partialInput` / `displayInput`。
- 现有 `filePath`、`showWriteContent`、`showApplyPatchContent` 全部读 `displayInput`。
- 新增 `showEditPartial`：`edit` 工具在 pending 期间用 `newString` 走 `WriteTool` 子组件预览。
- 新增 `streamingLineCount`，注入到 `ToolHeader.lineRange` 槽位（pending 三件套 vs read 完成态不会同时出现，安全复用）。
- pending + 三件套时调用 `open.setOpen(part.id, true)`（`PartOpenContext` 已暴露 `setOpen(id, boolean)`，幂等且无需扩展）。

## 测试

- `packages/opencode/test/session/processor.test.ts`（或同目录新增）：
  - `tool-input-start` → 多次 `tool-input-delta` → `state.raw` 等于累积文本
  - 非三件套工具（如 `shell`）的 delta 不写入 `state.raw`
- `packages/opencode/webgui/src/lib/partial-tool-input.test.ts`：
  - 空 raw → `{}`
  - 字段名打到一半（`{"fil`） → `{}`
  - 字符串未闭合（`{"filePath":"D:\\foo.ts","content":"li`）→ 取得 `filePath` 与 partial `content`
  - 完整 JSON → 完整对象
  - `countLines("a\nb\n") === 3`，空串 → `0`
- `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`：
  - pending + write + raw 含部分 content → Header 显示 `已接收 N 行`，展开区有 `WriteTool`
  - pending → completed 切换后，行数文本消失，渲染恢复正常
  - pending + 非三件套（read）→ 不显示行数、不自动展开
  - 大文件 200 次 part.updated 不抛错（用 `act` + 计时验证不会爆栈）

## 风险与回退

- **provider 不发 delta**：若某个 provider 走非流式路径，`state.raw` 始终为空，pending 卡片表现等同改动前。无回归。
- **partial JSON 解析失败**：`parsePartialInput` catch 后返回 `{}`，等同未识别字段，pending 卡片表现等同改动前。
- **频率调控失效**：`useDeferredValue` 在低性能设备上若仍卡顿，可在第二阶段加 `requestAnimationFrame` 合批；当前不预先优化。
- **STREAMABLE_TOOLS 漏配**：当后续新增写入类工具，需要同时在后端白名单与前端 `STREAMABLE` 加项；spec 完工后建议把这两处常量提到一个共享文件，避免漂移。

## 验证

- `bun test packages/opencode/test/session/processor.test.ts` 通过。
- `bun test packages/opencode/webgui` 通过。
- 手动：用一个流式快的模型（如 Claude Sonnet）让它写一个 200 行的文件，观察 webgui 卡片在生成期间逐步出现行数与内容。
