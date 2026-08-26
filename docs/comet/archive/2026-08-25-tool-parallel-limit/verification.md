---
generated_from_state_version: 7
---

# Verification

> 本报告只验证归档时的描述建议版本，不能作为当前运行时队列、取消 fencing 或资源清理实现的验收依据。

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 1
- Verifier attempt: 1
- Completed: 2026-08-25T07:17:12.239Z
- Summary: 配置、最终模型可见描述、默认值、Schema 生成链路及上游兼容性论据均满足 A1-A20；Runtime 定向测试与 typecheck 已通过。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：`parallel_limit.websearch` 为 5 时，模型收到的 `websearch` 描述明确建议单次并行调用最多 5 个；`task` 描述不受影响。 | websearch 独立读取 parallel_limit.websearch，最终描述正确追加配置值。 |
| A2 | passed | brief.md | A2：`parallel_limit.subagent` 为 5 时，模型收到的 `task` 描述明确建议同时启动最多 5 个 subagent；`websearch` 描述不受影响。 | task 独立读取 parallel_limit.subagent，最终描述正确追加配置值。 |
| A3 | passed | brief.md | A3：省略配置项时，两个工具描述均显示默认数量 3。 | 两字段各自使用默认值 3，定向测试覆盖默认描述。 |
| A4 | passed | brief.md | A4：配置 Schema 接受正整数并拒绝 0、负数和非整数。 | 两字段均使用 PositiveInt；测试拒绝 0、负数、小数和字符串。 |
| A5 | passed | brief.md | A5：包含新增配置的同一份 `opencode.jsonc` 可被上游官方 OpenCode 正常加载；官方忽略 fork 专用字段，本 fork 读取并应用字段。 | fork 解码并应用字段；上游当前 ConfigParse 忽略 excess property，未知扩展不会阻断加载。 |
| A6 | passed | specs/tool-parallel-limit/spec.md | 配置可包含顶层 `parallel_limit` 对象： | ConfigV1.Info 定义了顶层可选 parallel_limit 对象。 |
| A7 | passed | specs/tool-parallel-limit/spec.md | `websearch` 可选，必须是正整数，控制 `websearch` 工具描述中建议的最大并行调用数。 | websearch 为可选 PositiveInt，且仅影响 websearch 描述。 |
| A8 | passed | specs/tool-parallel-limit/spec.md | `subagent` 可选，必须是正整数，控制 `task` 工具描述中建议的最大并行 subagent 数。 | subagent 为可选 PositiveInt，且仅影响 task 描述。 |
| A9 | passed | specs/tool-parallel-limit/spec.md | 两个值彼此独立；配置一个不得改变另一个工具的描述值。 | 两个描述分别访问不同字段，没有共享或交叉回退。 |
| A10 | passed | specs/tool-parallel-limit/spec.md | fork 的生成配置 Schema 应公开这两个字段及其含义。 | Schema 脚本直接从 ConfigV1.Info 生成，字段及注释自然纳入。 |
| A11 | passed | specs/tool-parallel-limit/spec.md | 省略 `parallel_limit`、省略 `websearch` 或省略 `subagent` 时，对应工具的描述值为 3。 | 缺少对象或任一字段时，对应描述独立回退为 3。 |
| A12 | passed | specs/tool-parallel-limit/spec.md | 默认值只用于生成工具描述，不写回用户配置。 | 默认值只在 description 插值时计算，未修改或写回配置。 |
| A13 | passed | specs/tool-parallel-limit/spec.md | `websearch` 的模型可见描述必须在原文后追加一句：并行调用时，一次不得超过 `parallel_limit.websearch` 指定的数量。 | registry 在原 websearch description 后追加正确的并行调用句。 |
| A14 | passed | specs/tool-parallel-limit/spec.md | `task` 的模型可见描述必须在原文后追加一句：并行启动 subagent 时，一次不得超过 `parallel_limit.subagent` 指定的数量。 | registry 在原 task description 后追加正确的 subagent 并行句。 |
| A15 | passed | specs/tool-parallel-limit/spec.md | 原有描述逐字保留，不删除、不替换、不重新措辞。 | 两个 .txt 原始描述仍原样导入，registry 仅追加内容。 |
| A16 | passed | specs/tool-parallel-limit/spec.md | 原有工具说明、权限、参数和执行行为保持不变。 | 新字段仅在 ToolRegistry 的描述组装处使用，未进入权限、参数或执行路径。 |
| A17 | passed | specs/tool-parallel-limit/spec.md | 该配置对象是 fork 专用扩展。 | parallel_limit 是 fork 顶层配置扩展，未添加到 plugin options。 |
| A18 | passed | specs/tool-parallel-limit/spec.md | 上游官方 OpenCode 使用忽略未知属性的运行时解码策略，因此应忽略整个 `parallel_limit` 对象并继续启动。 | 上游当前 excess-property ignore 行为会丢弃该未知对象并继续运行。 |
| A19 | passed | specs/tool-parallel-limit/spec.md | 上游公开 JSON Schema 可能把该对象标记为未知；编辑器告警不改变运行时兼容要求。 | 上游公开 JSON Schema 的未知字段告警不影响其运行时忽略行为。 |
| A20 | passed | specs/tool-parallel-limit/spec.md | 本功能不修改或依赖 plugin options。 | 新功能直接使用 Config 服务，无 plugin options 依赖。 |

## Checks

| Check | Command | Working directory | Status | Exit | Duration |
| --- | --- | --- | --- | ---: | ---: |
| tool parallel limit tests | test test/tool/websearch.test.ts test/tool/task.test.ts | packages/opencode | passed | 0 | 10649 ms |
| opencode typecheck | typecheck | packages/opencode | passed | 0 | 13465 ms |

## Blockers

_None._

## Risks and skipped work

- 上游公开 JSON Schema 仍可能提示 parallel_limit 为未知字段。
- 该限制仅为模型可见建议，不会强制实际并发数。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | pass | — | 配置、最终模型可见描述、默认值、Schema 生成链路及上游兼容性论据均满足 A1-A20；Runtime 定向测试与 typecheck 已通过。 | 2026-08-25T07:17:12.239Z |

## Conclusion

配置、最终模型可见描述、默认值、Schema 生成链路及上游兼容性论据均满足 A1-A20；Runtime 定向测试与 typecheck 已通过。
