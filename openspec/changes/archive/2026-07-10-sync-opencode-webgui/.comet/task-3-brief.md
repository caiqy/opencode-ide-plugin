## Task 3: WebGUI compatibility audit

你在 `D:\Caiqy\Projects\Github\opencode-ide-plugin` 工作。

### 目标

对 merge 后真实代码做 WebGUI compatibility audit。只审计和记录，不修源码，不提交 commit，不勾选 tasks。

### 必审范围

1. SDK/API calls：
   - `sdk.session.*`: list/create/update/delete/select/send prompt
   - `sdk.config.*`: config load/save/fallback
   - provider/model/agent/variant loading and persisted selection fallback
   - `sdk.project.*` and `sdk.path.*` startup context
   - permission/question reply and reject routes
2. SSE event handling：
   - `/event` authentication and connection lifecycle
   - `message.*` events to `MessagesContext`
   - `session.*` events to `SessionContext`
   - `permission.*` and `question.*` pending request updates
   - file/edit/tool-result path data for host reload
3. IDE bridge：
   - bridge token and URL initialization
   - `storageGet` / `storageSet` persistence path
   - write/edit/apply_patch 后 `reloadPath` message
   - server restart、bridge reconnect、host restart/update tolerance
   - WebGUI asset embedding and host packaging assumptions

### 重点文件

- `packages/opencode/webgui/**`
- `packages/opencode/src/server/routes/instance/httpapi/**`
- `packages/client/src/generated/**`
- `packages/sdk/js/src/v2/gen/**`
- `hosts/vscode-plugin/**`
- `hosts/jetbrains-plugin/**`
- 证据文件：`openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`

### 约束

- Language: zh-CN
- 只允许修改：
  - `openspec/changes/sync-opencode-webgui/.comet/task-3-report.md`
  - `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`
- 禁止修改源码、generated artifacts、plan、OpenSpec task checkbox、`.comet.yaml`
- 审计结果每项必须是 `pass` 或 `broken: <文件:原因>`
- 若发现真实 broken path，记录最小修复位置建议，但不要修
- 保留 Task 2 已知剩余风险：`packages/opencode` / `packages/tui` typecheck 仍红，需区分生产兼容问题与测试/support drift

### RED/GREEN / 检查要求

- RED/输入：记录 Task 2 report 中的剩余 typecheck/generator 风险。
- GREEN/输出：`task-3-report.md` 和 `merge-evidence.md` 包含完整 WebGUI compatibility audit：
  - SDK/API
  - SSE events
  - Provider/model/agent/variant and project/path
  - IDE bridge VSCode
  - IDE bridge JetBrains

### 报告契约

把完整报告写到 `openspec/changes/sync-opencode-webgui/.comet/task-3-report.md`。

最终回复只包含：
- `DONE` | `DONE_WITH_CONCERNS` | `BLOCKED` | `NEEDS_CONTEXT`
- 审计 summary
- broken items
- 建议的 Task 4 最小修复位置
- 运行过的只读命令摘要
