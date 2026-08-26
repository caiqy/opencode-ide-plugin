# 工具执行队列配置

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

- `websearch` 可选，必须是正整数，控制 `websearch` 工具同时执行的最大数量。
- `subagent` 可选，必须是正整数，控制 `task` 工具同时执行的最大数量。
- 两个值彼此独立；配置一个不得改变另一个工具的执行上限。
- fork 的生成配置 Schema 应公开这两个字段及其含义。

## 默认行为

- 省略 `parallel_limit`、省略 `websearch` 或省略 `subagent` 时，对应工具的执行上限为 3。
- 超过执行上限的调用进入 FIFO 队列；已取消的排队调用不会启动。
- 默认值只用于执行调度，不写回用户配置。

## 工具执行调度

- 调度发生在工具执行边界，不依赖模型遵守说明文本。
- 同一次 LLM 请求中的 `websearch` 调用共享一个 FIFO 队列，AI SDK、native runtime 和 workflow tool executor 使用同一组包装后的工具执行函数。
- 同一运行实例中的 `task` 调用共享一个 FIFO 队列；后台 subagent 会持有许可直到对应 background job 完成、失败或取消。
- 原有工具描述逐字保留，不追加并行说明。
- 原有工具权限、参数和结果行为保持不变。

## 配置兼容性

- 该配置对象是 fork 专用扩展。
- 上游官方 OpenCode 使用忽略未知属性的运行时解码策略，因此应忽略整个 `parallel_limit` 对象并继续启动。
- 上游公开 JSON Schema 可能把该对象标记为未知；编辑器告警不改变运行时兼容要求。
- 本功能不修改或依赖 plugin options。

## 非目标

- 不增加跨请求的 `websearch` 全局并发策略。
- 不改变 web search provider 路由、subagent 深度、后台任务或权限行为。
