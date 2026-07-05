## Memory

`AGENTS.md` 是本仓库 agent 协作的主入口。长期记忆按轻量结构放在 `memory/` 目录中；常用术语需从 `memory/glossary.md` 同步到本节，便于 agent 启动时快速解码。

- `memory/glossary.md`：术语、缩写、别名、项目代号的总索引
- `memory/people/`：人员资料，文件名建议使用 lowercase kebab-case
- `memory/projects/`：项目、功能线、长期任务资料
- `memory/context/`：团队、流程、工具、协作背景等上下文资料

### Working Style

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops; use type guards on `filter` to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

### Terms

| Term | Meaning | Context |
|------|---------|---------|
| build-vsix | Windows 版 VSCode 插件 `.vsix` 快速打包流程 | 见 `memory/context/vscode-packaging.md` |
| 打包下一个版本 | 按 `.opencode/command/build-vsix.md` 的两步流程执行 Windows VSIX 打包：先按版本规则更新并校验版本号（非空、两个 package 一致、日期段等于今天），再构建与打包；不要使用 `node -e` one-liner，也不能沿用旧 package 版本继续打包 | 不重新探索仓库流程；见 `memory/context/vscode-packaging.md` |
| 执行 gradlew.bat 命令 | Windows/PowerShell 中所有 `gradlew.bat` 命令默认追加 `--no-daemon --console=plain`，包括编译、测试、验证、打包；如遇 daemon 卡住或文件锁，先 `./gradlew.bat --stop`；`-P...=...` 参数要加引号 | 见 `memory/context/gradle.md` |
| 打包最新版 Windows IDEA 插件 | 按版本规则用当前日期计算版本号，并通过 `./gradlew.bat buildPlugin "-Pplugin.version=<版本号>" --no-daemon --console=plain` 打包 JetBrains/IDEA Windows 测试包；不要使用 `build.gradle.kts` 里可能过期的 fallback 版本；同时遵守通用 `gradlew.bat` 命令规则 | 见 `memory/context/versioning.md` 与 `memory/context/gradle.md` |
| 发布下一个版本 | 直接执行基于 tag 的正式发版流程：提交本次实现、推送分支、按版本规则创建并推送下一个 `v` 标签、跟进 `release.yml` 结果 | 见 `memory/context/release-publishing.md` |
| 版本规则 | `YY.M.DDNN`：`YY`=年份后两位，`M`=月份不补零，`DDNN`=日期×100 + 当天序号；跨天后日期部分必须更新，当天序号重置为 `00` | 仓库通用版本规则，见 `memory/context/versioning.md` |
| 启动长驻服务命令 | 不要用可能卡住当前工具终端的方式启动长驻服务；需要验证本地服务时优先复用已运行进程，或使用仓库既有后台/tmux/明确可停止的方式，并先说明与记录 PID/停止方式 | 用户明确指出该类启动方式会卡住终端 |

后续新增、修改或删除记忆时，必须持续维护 `memory/glossary.md`；其中高频或会影响日常解码的 Term 也要同步更新到 `AGENTS.md` 的 `Terms` 表。

## 渐进式加载

按需读取以下文件获取详情，无需全部预加载：

| 文件 | 何时读取 |
|------|----------|
| `PROJECT.md` | 需要了解项目定位、核心价值、约束时 |
| `codebase/STACK.md` | 需要技术栈、依赖版本、配置文件细节时 |
| `CONVENTIONS.md` | 编写代码前确认命名、模式、错误处理规范时 |
| `ARCHITECTURE.md` | 需要系统架构、组件关系、数据流、入口点时 |
| `docs/knowledge-base/README.md` | 需要 Diátaxis 知识库全貌、能力速查、repowiki 分工时 |
| `docs/knowledge-base/reference/capabilities-index.md` | 需要穷举本 fork 所有能力、定位某项能力的代码入口或文档时 |
## CodeGraph

本项目已配置 CodeGraph MCP 服务器（`codegraph_*` 工具）。CodeGraph 是基于 tree-sitter 解析的知识图谱，包含每个符号、边和文件。读取速度在毫秒级，返回 grep 无法获取的结构化信息。

### 何时优先使用 codegraph

使用 codegraph 回答**结构性问题**——谁调用了谁、改了什么会坏、X 定义在哪、X 的签名是什么。仅在**纯文本搜索**（字符串内容、注释、日志信息）或已打开特定文件时，才使用原生 grep/read。

| 问题 | 工具 |
|------|------|
| "X 定义在哪？" / "查找名为 X 的符号" | `codegraph_search` |
| "谁调用了 Y 函数？" | `codegraph_callers` |
| "Y 调用了谁？" | `codegraph_callees` |
| "X 如何到达/变成 Y？/ 跟踪 X 到 Y 的调用流" | `codegraph_trace`（一次调用返回完整路径，包括回调/React/JSX 动态跳转） |
| "改 Z 会破坏什么？" | `codegraph_impact` |
| "显示 Y 的签名/源码/文档" | `codegraph_node` |
| "为某个任务/区域提供上下文" | `codegraph_context` |
| "一次查看多个相关符号的源码" | `codegraph_explore` |
| "path/ 下有哪些文件" | `codegraph_files` |
| "索引健康吗？" | `codegraph_status` |

### 使用原则

- **直接回答，不要委托给探索子 agent。** 对于"X 如何工作"/架构类问题，用 2-3 个 codegraph 调用即可解决：先 `codegraph_context`，再一次 `codegraph_explore` 获取暴露符号的源码。对于**调用流**（"X 如何到达 Y"），先 `codegraph_trace` from→to 获取完整路径（包含动态跳转），然后一次 `codegraph_explore` 获取函数体；不要用 `codegraph_search` + `codegraph_callers` 重建路径。Codegraph 本身就是预建索引，启动文件读取子任务——或运行 grep + read 循环——会重复 codegraph 已完成的工作，花费更多得到相同结果。
- **信任 codegraph 结果。** 它们来自完整的 AST 解析。不要用 grep 重新验证——那更慢、更不准确、浪费上下文。
- **查找符号名称时不要先用 grep。** `codegraph_search` 更快，且一次返回种类 + 位置 + 签名。
- **只需上下文时不要链式调用 `codegraph_search` + `codegraph_node`**——`codegraph_context` 一次调用即可。
- **不要对多个符号循环调用 `codegraph_node`**——一次 `codegraph_explore` 调用可在一个限定的调用中返回多个符号的源码，而每次单独的 node/Read 调用都会重新读取整个上下文，成本更高。
- **索引延迟**：文件监听器在写入后约 500ms 去抖；同一轮中编辑文件后不要立即重新查询。
<!-- CODEGRAPH_END -->
