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
      id: "preset:code-review",
      title: "代码评审",
      body: "针对本次任务变动执行独立评审",
    },
    {
      id: "preset:commit",
      title: "提交代码",
      body: "根据历史提交惯例生成commit信息执行commit & push",
    },
    {
      id: "preset:handoff",
      title: "工作交接",
      body: "编写工作交接文档到临时文件夹，然后给我可复制的简短交接说明（需附上交接文档），如果刚刚的对话有提问未做决定，请附带到简短交接说明里末尾让AI重新提问",
    },
  ],
} as const
