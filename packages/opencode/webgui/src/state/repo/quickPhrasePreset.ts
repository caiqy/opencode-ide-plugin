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
      body: "是的/确认/同意/可以",
    },
    {
      id: "preset:select-one",
      title: "选1/A",
      body: "选1/A",
    },
    {
      id: "preset:select-two",
      title: "选2/B",
      body: "选2/B",
    },
    {
      id: "preset:select-three",
      title: "选3/C",
      body: "选3/C",
    },
    {
      id: "preset:execute-directly",
      title: "直接执行",
      body: "本次任务不编写spec和plan文档，直接使用TDD流程执行",
    },
    {
      id: "preset:comprehensive-review",
      title: "综合评审",
      body: "使用[子任务]分别执行[规格评审]和[代码评审]",
    },
    {
      id: "preset:code-review",
      title: "代码评审",
      body: "使用[子任务]执行[代码评审]",
    },
    {
      id: "preset:commit",
      title: "提交代码",
      body: "根据历史提交惯例生成commit信息执行commit & push",
    },
  ],
} as const
