## Task 5: 尽量全量验证

你在 `D:\Caiqy\Projects\Github\opencode-ide-plugin` 工作。

### 目标

运行尽量全量验证，覆盖 opencode、WebGUI、VSCode、JetBrains，并把命令、结果、失败原因、替代命令和剩余风险写入证据。不要提交 commit，不勾选 tasks。

### 必做验证面

1. 发现 merge 后可用脚本：
   - 根目录：`bun pm pkg get scripts`
   - 相关 package：按实际 `package.json` / Gradle task 选择最近等价命令
2. opencode package：
   - typecheck
   - tests
   - build
3. WebGUI flows：
   - WebGUI typecheck/test/build 或最近等价
   - session workflow
   - streamed message handling
   - provider/model/agent/variant selection
   - permission/question handling
   - IDE bridge storage/reloadPath/reconnect path
4. VSCode host：
   - compile/package 或最近 bridge/package check
5. JetBrains host：
   - Gradle checks，Windows 下必须追加 `--no-daemon --console=plain`

### 允许修改

- `openspec/changes/sync-opencode-webgui/.comet/task-5-report.md`
- `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`
- 只有当某个验证失败确认是当前 merge 引入且修复很小，才允许按最小范围修改源码或测试；必须先加载 `systematic-debugging` 并记录根因。

### 禁止

- rebase、reset、checkout 丢弃改动、提交 commit、勾选 tasks。
- 为了让验证绿而删除验证、跳过真实失败或扩大重构。
- 从 repo root 直接跑测试；repo 规则要求从 package 目录跑。

### 失败处理

- 如果命令不存在，记录不可运行原因和最近等价命令。
- 如果命令失败：
  - 明确列出失败文件/错误类型。
  - 判断是 production、test/support、environment、known merge drift。
  - 对 production 或 fork-specific WebGUI/IDE bridge 失败，优先尝试最小修复；修复前加载 `systematic-debugging`。
  - 对大范围失败或需要产品取舍，返回 `BLOCKED`。

### 报告契约

把完整报告写到 `openspec/changes/sync-opencode-webgui/.comet/task-5-report.md`，并追加 `merge-evidence.md` 的 `## Verification` 和 `## Remaining compatibility risk before verify`。

最终回复只包含：
- `DONE` | `DONE_WITH_CONCERNS` | `BLOCKED` | `NEEDS_CONTEXT`
- 验证命令摘要
- pass/fail/skipped/substituted 列表
- 修复过的失败
- 剩余风险
- 是否建议允许进入 Comet verify 阶段
