export const quick_phrase_preset = {
  version: 1,
  items: [
    {
      id: "preset:commit",
      title: "提交总结",
      body: "请总结本次改动，按变更点给出清单。",
    },
    {
      id: "preset:next",
      title: "下一步计划",
      body: "请给出下一步可执行计划，按优先级排序。",
    },
    {
      id: "preset:risk",
      title: "风险检查",
      body: "请列出当前方案风险与规避建议。",
    },
  ],
} as const
