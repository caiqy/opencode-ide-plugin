## Task 1: 上游 fetch 与热点分析

你在 `D:\Caiqy\Projects\Github\opencode-ide-plugin` 工作。

### 目标

完成计划中的 Task 1，只做 merge 前准备与证据记录，不做 merge，不改源码，不勾选 plan 或 OpenSpec tasks。

### 必做步骤

1. 运行并记录当前工作区状态：
   - `git status --short`
   - `git rev-parse HEAD`
2. 确认 merge target：
   - `git remote -v`
   - `git symbolic-ref refs/remotes/opencode/HEAD`
3. fetch 上游：
   - `git fetch opencode --prune`
4. 生成差异热点：
   - `git diff --name-status HEAD..opencode/dev -- packages/opencode packages/opencode/webgui hosts/vscode-plugin hosts/jetbrains-plugin`
   - `git log --oneline --left-right --cherry-pick HEAD...opencode/dev -- packages/opencode packages/opencode/webgui hosts/vscode-plugin hosts/jetbrains-plugin`
5. 创建或更新 `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`，写入：
   - Local baseline: `c6924271f49262720161cc273c5a24bf70dc0027`
   - Actual baseline: 本次 `git rev-parse HEAD` 输出
   - Merge target: `opencode/dev`
   - Pre-merge hotspots：分别总结 `packages/opencode`、`packages/opencode/webgui`、`hosts/vscode-plugin`、`hosts/jetbrains-plugin`

### 约束

- Language: zh-CN
- 只允许修改：`openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`
- 禁止修改源码、plan、OpenSpec task checkboxes、`.comet.yaml`
- 若 `git rev-parse HEAD` 不是 `c6924271f49262720161cc273c5a24bf70dc0027`，或 merge target 不是 `opencode/dev`，返回 `BLOCKED`
- 若 `git fetch` 因认证/网络失败，返回 `BLOCKED`
- 若发现任何必须在 merge 前由用户拍板的取舍，不要自行决定，返回 `BLOCKED`

### 报告契约

完成后只回报：

- `DONE` | `DONE_WITH_CONCERNS` | `BLOCKED` | `NEEDS_CONTEXT`
- 变更文件列表
- 运行过的命令与结果摘要
- 是否命中风险信号（逐条列出或写 `none`）
- 如有顾虑，简短说明
