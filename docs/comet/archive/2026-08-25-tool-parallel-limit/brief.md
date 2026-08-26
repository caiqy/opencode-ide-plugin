# Outcome

> 历史范围：本归档记录仅覆盖最初的“模型可见描述建议”实现。后续运行时队列实现不属于本归档验收，当前行为以 `docs/comet/specs/tool-parallel-limit/spec.md` 为准。

为模型可见的 `websearch` 与 `task` 工具描述分别加入建议的并行调用数量，并允许用户独立配置；未配置时均显示 3。

# Scope

- 增加两个相互独立的可选正整数配置项。
- `websearch` 工具描述使用配置值生成并行调用说明。
- `task` 工具描述使用自己的配置值生成并行 subagent 调用说明。
- 新增配置必须允许同一份配置文件继续被上游官方 `opencode.exe` 正常读取。
- 更新对应配置 Schema 与工具描述测试。

## Source coverage

| 来源单元                                                                                                   | 读取状态 | 保留语义                                                                                          | Spec 位置                  | 验收 ID    | 覆盖状态   | 理由                                           |
| ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------- | -------------------------- | ---------- | ---------- | ---------------------------------------------- |
| 用户请求：`websearch` 与 subagent 调用支持并行，但当前没有并行数量说明                                     | complete | 两个工具的模型可见描述都应包含并行数量                                                            | 工具并行数量描述           | A1、A2     | covered    | 两个工具分别读取对应值                         |
| 用户请求：增加配置项控制描述中的并行数量                                                                   | complete | 使用 `parallel_limit.websearch` 与 `parallel_limit.subagent` 两个独立正整数值，仅影响各自描述文本 | 配置契约、工具并行数量描述 | A1、A2、A4 | covered    | 用户确认统一配置对象布局                       |
| 用户请求：未配置时默认为 3                                                                                 | complete | 两个工具描述均独立回退到 3                                                                        | 默认行为                   | A3         | covered    | 默认值已明确                                   |
| 用户补充：配置项需兼容上游官方 `opencode.exe`                                                              | complete | 同一配置文件不得导致官方程序配置解析或启动失败；官方可忽略 fork 专用字段                          | 配置兼容性                 | A5         | covered    | 已由上游源码和本机运行行为确认未知字段会被忽略 |
| 用户截图：官方 Desktop 1.18.22 可正常启动                                                                  | complete | 作为实际兼容现象，需要解释其配置加载路径                                                          | 配置兼容性                 | A5         | covered    | Desktop sidecar 正常启动，未知字段不阻断加载   |
| `C:/Users/caiqy/.config/opencode/opencode.jsonc`：`$schema`、`websearch` 及其他顶层配置                    | complete | 该文件是现有全局配置实例；新增 `parallel_limit` 顶层对象并受 fork Schema 校验                     | 配置契约                   | A4、A5     | covered    | 未改写无关配置                                 |
| `C:/Users/caiqy/.config/opencode/opencode.jsonc`：agent、permission、mcp、provider、shell、plugin 的既有值 | complete | 作为现状背景保留，不属于本次行为变更                                                              | 不适用                     | 不适用     | background | 与并行数量描述无关，且可能包含敏感配置         |

# Non-goals

- 不实现运行时并发调度、信号量或硬性并行上限。
- 不修改用户配置文件中的现有 provider、agent、MCP 或凭据。
- 不改变工具执行结果、权限、subagent 深度或后台任务行为。

# Acceptance examples

- A1：`parallel_limit.websearch` 为 5 时，模型收到的 `websearch` 描述明确建议单次并行调用最多 5 个；`task` 描述不受影响。
- A2：`parallel_limit.subagent` 为 5 时，模型收到的 `task` 描述明确建议同时启动最多 5 个 subagent；`websearch` 描述不受影响。
- A3：省略配置项时，两个工具描述均显示默认数量 3。
- A4：配置 Schema 接受正整数并拒绝 0、负数和非整数。
- A5：包含新增配置的同一份 `opencode.jsonc` 可被上游官方 OpenCode 正常加载；官方忽略 fork 专用字段，本 fork 读取并应用字段。

# Constraints and invariants

- 配置只改变模型可见描述，不承诺也不强制真实运行时并发上限。
- 使用现有 `PositiveInt` Schema，避免额外校验逻辑。
- 保持现有工具描述内容和条件化 background subagent 描述不变，仅追加并行数量说明。
- 不改写、删减或重新措辞现有描述；并行限制必须作为新增句子追加。
- 上游 2026-08-25 的公开 JSON Schema 在顶层和 `experimental` 中均设置 `additionalProperties: false`，编辑器会把未知字段标为无效。
- 上游实际运行时使用 `onExcessProperty: "ignore"` 解码配置，未知字段会被静默丢弃而不阻止启动；运行时行为是本需求的兼容依据。
- 用户当前配置中的既有 `websearch` 区块在官方版本中被忽略，在本 fork 中由扩展 Schema 读取并生效。

# Decisions

- 两类工具分别配置，互不影响。
- 默认值为 3。
- 配置布局为顶层 `parallel_limit` 对象，其中包含可选的 `websearch` 与 `subagent` 正整数。
- 采用普通 fork 配置字段；不再使用 plugin options，因为上游运行时已能安全忽略未知字段。
- 原有描述逐字保留，仅追加配置化并行限制。
- 本 change 保持单一 Native change；配置 Schema 与两个描述改动紧耦合，没有拆分收益。

# Open questions

无。

# Verification expectations

- 在 `packages/opencode` 运行针对 `websearch`、`task` 的定向测试。
- 在 `packages/opencode` 运行 `bun typecheck`。
- 通过上游同版本配置解码行为或官方运行时对包含新增字段的配置执行无交互加载检查。
