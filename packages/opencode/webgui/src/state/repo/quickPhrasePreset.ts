export const quick_phrase_preset = {
  version: 1,
  items: [
    {
      id: "preset:continue",
      title: "继续",
      body: "继续",
    },
    {
      id: "preset:confirm",
      title: "确认",
      body: "确认/同意/可以",
    },
    {
      id: "preset:no-worktree",
      title: "不用WorkTree",
      body: "不使用worktree在当前会话执行任务",
    },
    {
      id: "preset:design-review",
      title: "设计评审",
      body: "从架构设计的视角使用[子任务]评审设计文档",
    },
    {
      id: "preset:comprehensive-review",
      title: "综合评审",
      body: "使用[子任务]分别执行[任务评审]和[代码评审]",
    },
    {
      id: "preset:code-review",
      title: "代码评审",
      body: "使用[子任务]执行[代码评审]",
    },
    {
      id: "preset:reasonable-fix",
      title: "合理修复",
      body: "从架构设计和项目质量的视角设计合理的修复方案，执行前先让我确认修复方案",
    },
  ],
} as const
