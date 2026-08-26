# 工具并行数量配置

> 历史规格：本文件描述已归档的“模型可见描述建议”版本，不包含之后增加的运行时调度。当前规格见 `docs/comet/specs/tool-parallel-limit/spec.md`。

## 配置契约

配置可包含顶层 `parallel_limit` 对象：

```jsonc
{
  "parallel_limit": {
    "websearch": 5,
    "subagent": 3,
  },
}
```

- `websearch` 可选，必须是正整数，控制 `websearch` 工具描述中建议的最大并行调用数。
- `subagent` 可选，必须是正整数，控制 `task` 工具描述中建议的最大并行 subagent 数。
- 两个值彼此独立；配置一个不得改变另一个工具的描述值。
- fork 的生成配置 Schema 应公开这两个字段及其含义。

## 默认行为

- 省略 `parallel_limit`、省略 `websearch` 或省略 `subagent` 时，对应工具的描述值为 3。
- 默认值只用于生成工具描述，不写回用户配置。

## 工具并行数量描述

- `websearch` 的模型可见描述必须在原文后追加一句：并行调用时，一次不得超过 `parallel_limit.websearch` 指定的数量。
- `task` 的模型可见描述必须在原文后追加一句：并行启动 subagent 时，一次不得超过 `parallel_limit.subagent` 指定的数量。
- 原有描述逐字保留，不删除、不替换、不重新措辞。
- 原有工具说明、权限、参数和执行行为保持不变。

## 配置兼容性

- 该配置对象是 fork 专用扩展。
- 上游官方 OpenCode 使用忽略未知属性的运行时解码策略，因此应忽略整个 `parallel_limit` 对象并继续启动。
- 上游公开 JSON Schema 可能把该对象标记为未知；编辑器告警不改变运行时兼容要求。
- 本功能不修改或依赖 plugin options。

## 非目标

- 不增加信号量、队列或其他运行时并发限制。
- 不保证模型一定遵守描述中的建议数量。
- 不改变 web search provider 路由、subagent 深度、后台任务或权限行为。
