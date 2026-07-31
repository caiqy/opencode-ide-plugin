# Acceptance evidence

<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-019c4801a5b126a39ef50e0660a95b50cb04bcf12732dbc8c124e8993d817dbc",
    "evidence_refs": [
      "hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt",
      "hosts/vscode-plugin/src/test/suite/integration.test.ts",
      "packages/opencode/webgui/package.json"
    ]
  },
  {
    "acceptance_id": "acceptance-83a4d61965dc2d62a099eced4923c813c46a00de7ff06451f3752c60e344c827",
    "evidence_refs": [],
    "skipped_reason": "v1.18.5..v1.18.6 对 packages/protocol 和 Server HttpApi 源码的变化为 0，未触发生成规则。"
  },
  {
    "acceptance_id": "acceptance-84edecc2f40a90af677e0b70f1e263a3001c3204f6a8300103727b0ecb12fc59",
    "evidence_refs": [
      "hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt",
      "hosts/vscode-plugin/src/extension.ts",
      "packages/opencode/src/server/routes/instance/httpapi/server.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-b75b6be30e580648278cb1dd0dedd9c81eac162d59b60fe9b90e252595eb780a",
    "evidence_refs": [
      "bun.lock",
      "package.json",
      "packages/opencode/package.json"
    ]
  },
  {
    "acceptance_id": "acceptance-e4bc16f743ff1b7d24bd3968f4bf5886304c8e1d941ddb51fe59e8eb1e995bc3",
    "evidence_refs": [
      "package.json",
      "packages/opencode/package.json"
    ]
  }
]
<!-- comet-native:acceptance-evidence:end -->

当前 change 已进入 Verify revision 9。机器块使用 Runtime 为 contract hash `2dd0c82c13e363aee2db62feb46a726261473d5c279708ea5905d28936f82dba` 返回的全部 5 个 acceptance IDs，并由官方 `comet native evidence format` 规范化。

# Commands and results

## Authoritative release target

- `git remote get-url opencode`：`https://github.com/anomalyco/opencode.git`。
- `git ls-remote --tags --refs opencode`：最新稳定 semver tag 为 `v1.18.6`，ref 为 `00ac24ee5176117aae9df7873924d26b034a3229`。
- `gh api repos/anomalyco/opencode/releases/latest`：`v1.18.6`，`draft=false`、`prerelease=false`，发布时间 `2026-07-27T02:47:44Z`，来源为 `https://github.com/anomalyco/opencode/releases/tag/v1.18.6`。
- npm latest 为 `1.18.6`。未设置 `OPENCODE_VERSION` 时，`packages/script/src/index.ts` 会自动增加一个 patch，开发构建因而显示 `1.18.7`；该值不是 release/tag 证据。

## Merge and tree evidence

- `git fetch opencode tag v1.18.6`：取得 tag commit `00ac24ee5176117aae9df7873924d26b034a3229`。
- `git diff v1.18.5..v1.18.6`：8 commits、75 files、551 insertions、348 deletions。共享运行时增量集中于 Core repository/reference cache 和对应测试；Protocol/Server source 变化为 0。
- `git merge --no-ff --no-commit v1.18.6`：先建立正式上游 ancestry，在用户授权前保持未提交。
- 三方 manifest 比较：27 个非下游 manifest 接收 tag 主体；`packages/app` 与 `packages/session-ui` 接收上游依赖变化；`packages/console/app` 与 `packages/opencode` 保留下游主体并升级 release version。
- 最终 29 个 release manifests 均为 `1.18.6`，无错误版本。
- `vfox exec bun@1.3.14 -- bun install --ignore-scripts`：从最终 manifests 重建 `bun.lock`；随后 `bun install --frozen-lockfile --ignore-scripts` 无变化。
- 提交前 `MERGE_HEAD` 与 `v1.18.6^{commit}` 均为 `00ac24ee5176117aae9df7873924d26b034a3229`。
- unmerged paths 为 0；staged merge diff 为 75 files、551 insertions、348 deletions。
- 7 个受影响的 Core source/test 与 OpenCode HTTP API test 在 index 中和 `v1.18.6` tag 完全一致。
- `v1.18.6..opencode/dev` 当前为 0 commits；没有纳入 tag 之后的未发版提交。
- WebGUI `embed.generated.ts` 无 staged 或 unstaged drift。
- `AGENTS.md`、`CLAUDE.md`、`hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml` 保持原有 unstaged 状态，三者进入 staged merge 的数量为 0。
- 正式 merge commit 为 `c6024fe5decee2581a2c09bb0d75a6887e9e52f9`，message 为 `chore(opencode): merge upstream v1.18.6`；恰有两个 parent，第一 parent 为 `f7b4d048513335a1f50e3d55e19a00dbe208237f`，第二 parent 为 tag commit `00ac24ee5176117aae9df7873924d26b034a3229`。
- commit first-parent diff 恰为预期 75 paths、551 insertions、348 deletions；提交后 index 为 0。
- `packages/opencode/test/session/llm.anthropic-replay.test.ts` 的 fixture 解耦位于独立 commit `253389db631ad45627e133c7318b5e65a06479a8`；该 commit 恰含此一个文件，`v1.18.6` merge commit 未包含该修复或任何 Comet/用户 dirty 文件。

## Project verification

- `vfox exec bun@1.3.14 -- bun test test/session/llm.anthropic-replay.test.ts --timeout 30000`（`packages/opencode`，外层 90 秒预算）：3 pass、0 fail、16 assertions，5.28 秒完成；请求仍断言走 Anthropic `/messages`，normal、missing-text、tool-mixed replay 全部通过。
- `vfox exec bun@1.3.14 -- bun typecheck`（`packages/opencode`，独立 replay 提交前复核）：`tsgo --noEmit` exit 0。
- `bun typecheck` 与 16 个受影响测试文件（`packages/opencode`）：类型检查通过，661 pass、5 skip、0 fail。
- `bun typecheck && bun test test/server/httpapi-reference.test.ts test/session/llm.anthropic-replay.test.ts`（合入 `v1.18.6` 后）：4 pass、0 fail。
- `bun typecheck && bun test test/reference.test.ts test/repository-cache.test.ts test/repository.test.ts`（`packages/core`）：14 pass、0 fail。
- `bun run build && bun run test:run`（`packages/opencode/webgui`）：生产构建通过，158 个测试文件、1394 tests 全部通过；仅有现存的大 chunk warning。
- `OPENCODE_VERSION=1.18.6 bun run script/build.ts --single --skip-install --skip-embed-web-ui`（`packages/opencode`）：WebGUI embed、Windows x64 binary 和 smoke test 通过，`--version` 输出 `1.18.6`。
- `bun typecheck && bun test`（`packages/sdk/js`）：5 pass、0 fail。
- `bun typecheck && bun test test/provider-error.test.ts`（`packages/llm`）：2 pass、0 fail。
- `bun typecheck`（`packages/plugin`）：通过。
- `corepack pnpm test`（`hosts/vscode-plugin`）：pretest 编译和 lint 通过，VS Code 1.74 集成测试 226 passing、1 pending，进程 exit 0。GitHub Copilot proposed API warning及测试中的 binary publish fallback 不影响结果。
- `vfox exec java@21.0.2+13 -- .\gradlew.bat unitTest --no-daemon`（`hosts/jetbrains-plugin`）：Launcher JVM 21，`BUILD SUCCESSFUL`。
- `comet native check merge-upstream-tags`：生成 receipt `runtime/evidence/check-receipts/25e3a02e82b372124b97d403e01bd6b876c97e336c3d8e6ba9509e8569781e5e.json`，返回 failed；contract 与 snapshot 均 fresh，但 scoped-text-safety 在 128 个选中文件处触发 `scan-limit`，实际扫描 0 文件、记录 0 个代码问题。该 failed receipt 不作为 pass receipt 提交。

# Skipped checks

- 未运行 Client 生成命令：`v1.18.5..v1.18.6` 对 `packages/protocol` 和 Server source 的变化为 0，不触发仓库生成规则。
- 未运行官方 App/Desktop 全量测试：这些路径不是自有 WebGUI/IDE 插件验收目标；相关 tag 内容已原样进入 staged merge。

# Spec consistency

项目已通过正式 merge commit 包含最新稳定 tag `v1.18.6`，12 个目标 tag 均形成独立 first-parent merge 历史。运行时 package、lockfile、Core 修复、WebGUI 和两个 IDE host 的项目验证均通过；Git 历史与项目侧规格一致。

## Workflow infrastructure history

- Build scope 的纯文本候选输出为 `scope:7b2ec0f193084609c93d87a482d28df2bc66d5d8ca4224c0151f727b11c696e7`，并报告 17 条已归属变化、0 unresolved/0 unattributed，overflow hash 为 `63b73044f63fa2fe354fc20b0e6f01208b652c56f1d03dad5257f5b4cdb4119d`。
- 用户明确接受上述范围；但 `--allow-partial-scope 7b2ec0f...` 在 artifact 参数之后和之前两种顺序均稳定返回 `Native partial allowance does not match the current implementation scope`。
- 官方 `--json` 尝试未返回规范 envelope，并留下已无 owner process 的 `root-move.lock` 与 `transition-merge-upstream-tags.lock`；`comet native doctor merge-upstream-tags --repair` 仅通过官方恢复入口移除了两个 stale locks。
- 未修改 `.opencode/skills/comet*`、Comet Runtime、hash 算法或 workflow 基础设施，也未删除 artifact、扩大代码修复或伪造 scope。
- 目标规格与 merge tree 在上述尝试后又更新到 `v1.18.6`，因此旧 implementation scope/allowance 已失效；官方入口未能签发可用的新 scope hash，Native 无法从 Build 进入 Verify。
- 稳定 merge commit 上重新运行官方 Build 入口后，纯文本候选为 `scope:b61f462317ece08e4fab35b1b363a85282181ecb5735910a93925e5d1a81e6ab`，报告 24 条已归属 overflow、0 unresolved/0 unattributed，overflow hash 为 `0ed4f018befee5df9027ba9133fe23edfeb6a82da32618490fc93a36d7009289`；纯文本仍未暴露 `--allow-partial-scope` 所需的 implementation scope hash。
- 最后一次有界官方机器输出命令为 `comet native next merge-upstream-tags --summary "已创建并校验 v1.18.6 双父 merge commit，完成项目验证并保留 replay 修复及用户 dirty 文件未提交" --confirmed --artifact .github --artifact .opencode --artifact AGENTS.md --artifact CLAUDE.md --artifact artifacts --artifact bun.lock --artifact infra --artifact nix --artifact package.json --artifact packages --artifact patches --artifact sdks --json`，外层超时为 90 秒。
- 该命令在超时前结束，process exit 65、输出 1 行；`ConvertFrom-Json` 报错：`After parsing a value an unexpected character was encountered: c. Path 'data.preparedScope.acceptancePage.items[0].text', line 1, position 2553.` 因机器输出不是有效 JSON，仍未取得可授权的真实 implementation scope hash。
- `comet native status merge-upstream-tags --details` 报告 `contract-changed-after-approval`；用户已明确确认更新后的 `v1.18.6` contract，并已授权完成 merge commit。剩余 blocker 仅属于 scope 机器入口。
- 最新 Native checkpoint 为 `8d11bedf-9e91-4848-88f5-0b2b5b24f7f2`，state revision 8，phase 仍为 Build；checkpoint 已保存 `bun.lock`、Core repository cache、OpenCode manifest 和 replay 修复引用。
- 用户随后明确要求恢复流程，并重新确认包含独立 replay 测试提交的当前 contract；后续仅通过官方 Native 入口继续，不修改 Runtime 或 Skill。
- 当前 contract 对应的官方 implementation scope evidence 为 `runtime/evidence/scopes/75895c428899a35d84b21e5bb9c979eabe44522b21282a5d14342539e16b7c60.json`；其 `scopeHash` 为 `75895c428899a35d84b21e5bb9c979eabe44522b21282a5d14342539e16b7c60`，记录 0 unresolved、0 unattributed，唯一 partial 项为 24 条明细因输出预算由 overflow hash `0ed4f018befee5df9027ba9133fe23edfeb6a82da32618490fc93a36d7009289` 汇总。
- 用户明确接受上述 detail-overflow 可见性风险，并授权使用该精确 scope hash 继续进入 Verify。
- `comet native next ... --allow-partial-scope 75895c... --confirmed` 成功生成 allowance `runtime/evidence/allowances/342206fb7719c2dfd7954a8fa6301c4a9eca490c23f13c159f7a54b40333ee3d.json`，Native 进入 Verify revision 9，acceptance hash 为 `71351bfd0432a86c84cfec3c3c0867c710bebae9a2a8e855459f55d8ab32d97b`。

# Known limitations and risks

- 当前 index 为空，工作树明确不 clean：`AGENTS.md`、`CLAUDE.md`、`hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml` 为 unstaged modified，`docs/comet/changes/` 为 untracked。
- Anthropic replay fixture 解耦已进入独立测试 commit；用户原有 dirty 文件和 Comet 产物仍未进入任何本轮提交。
- VS Code 测试继续使用仓库现有 bundled binary；当前源码 binary 的独立 `1.18.6` smoke build 已通过，但未发布新的 VSIX/JetBrains 安装包。
- WebGUI 单个 JavaScript chunk 约 1.65 MB，Vite 发出大 chunk warning；本次同步没有新增 embed drift，也未把性能重构扩大到 release sync。
- Acceptance machine block 已绑定全部 5 个 IDs；其中 Protocol/Server `HttpApi` 条件因 source diff 为 0 诚实记录为未触发。
- Native 内置文本检查受 scope 文件数量预算限制，0 文件被扫描；项目测试、构建和 Git 证据不受该检查预算限制影响。

# Conclusion

项目侧与 Git 历史验证通过：`v1.18.6` merge commit、依赖、后端、WebGUI、VS Code、JetBrains 与受影响测试均无失败。

Verify 结论为 pass：全部适用 acceptance 均有项目证据，唯一条件项因 source diff 为 0 未触发；内置文本检查的 `scan-limit` 作为已知 workflow 检查预算限制保留，不伪装为通过 receipt。
