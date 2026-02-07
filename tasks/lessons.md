# 经验教训

## 1. 仓库架构：「插件」≠「App」

**犯错场景**：用户说「插件」时，错误地修改了 `packages/app/`。

**正确理解**：

| 用户说的                      | 实际指的                       | 代码位置                    | 技术栈      |
| ----------------------------- | ------------------------------ | --------------------------- | ----------- |
| 插件 / VSCode 插件 / IDE 插件 | VSCode webview 内嵌的前端      | `packages/opencode/webgui/` | **React**   |
| App / Web / Desktop           | OpenCode 官方 Web/Desktop 前端 | `packages/app/`             | **SolidJS** |

**关键区分点**：

- `packages/opencode/webgui/` — React，用 `useRef` / `useEffect` / `useState`
- `packages/app/` — SolidJS，用 `createSignal` / `createEffect` / `createStore`

**规则**：除非用户明确提到 `packages/app` 或 SolidJS 前端，否则「插件」一律指 `packages/opencode/webgui/`。动手前先确认目标目录。
