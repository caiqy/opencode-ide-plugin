# Spec Kit + Superpowers 工作流指南

本文档说明本项目如何使用 **Spec Kit** 与 **Superpowers Bridge（`superb`）** 组合工作，并给出从初始化到功能收尾的完整 AI 消息模板。

适用对象：在本仓库中使用 opencode 进行需求澄清、规格编写、计划生成、任务拆解、实现、验证和收尾的开发者。

语言约定：后续新增或更新 Spec Kit 相关文档时，模板骨架标题可以保留官方英文；项目特定正文、需求、计划、任务、检查项和验证说明使用简体中文。技术专有名词、命令、文件路径、标识符和协议名按原文保留。

---

## 1. 核心分工

这套流程的关键原则是：

> **Spec Kit 负责 WHAT：把需求沉淀成可追踪的规格、计划和任务。**  
> **Superpowers / superb 负责 HOW：在实现阶段施加 TDD、调试、验证、评审和收尾纪律。**

### Spec Kit 负责

- 项目原则：`/speckit.constitution`
- 功能规格：`/speckit.specify`
- 需求澄清：`/speckit.clarify`
- 技术计划：`/speckit.plan`
- 任务拆解：`/speckit.tasks`
- 一致性检查：`/speckit.analyze`
- 需求质量清单：`/speckit.checklist`
- 实现执行入口：`/speckit.implement`

### Superpowers Bridge (`superb`) 负责

- 安装与依赖诊断：`/speckit.superb.check`
- 任务覆盖与 TDD 准备检查：`/speckit.superb.review`
- 实现前 TDD 门禁：`/speckit.superb.tdd`（由 hook 在 `/speckit.implement` 前触发）
- 完成前证据门禁：`/speckit.superb.verify`（由 hook 在 `/speckit.implement` 后触发）
- 系统化调试：`/speckit.superb.debug`
- 对照 spec / plan / tasks 的实现评审：`/speckit.superb.critique`
- 处理评审反馈：`/speckit.superb.respond`
- 分支收尾：`/speckit.superb.finish`

---

## 2. 什么时候使用这套流程

### 推荐使用完整流程

- 新功能
- 跨多文件改动
- 涉及产品/交互/架构决策的改动
- 需要可追踪需求、验收标准或评审证据的改动
- 影响用户体验、数据结构、API、插件生命周期或构建流程的改动

### 可以跳过 Spec Kit，仅使用普通 Superpowers / 直接修改

- 修 typo
- 单行配置修复
- 明确的小 bug，且不涉及需求判断
- 只改注释或文档中的一小段文字

如果不确定，默认走完整流程；如果中途发现范围很小，可以降级。

---

## 3. 一次性初始化

以下步骤通常每台机器或每个仓库只需要做一次。

### 3.1 安装 Specify CLI（本机一次）

```powershell
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v0.8.11
uv tool update-shell
```

验证：

```powershell
specify --version
```

如果 `specify` 不在 PATH 中，可临时使用完整路径：

```powershell
C:\Users\caiqy\.local\bin\specify.exe --version
```

### 3.2 在项目中初始化 Spec Kit + opencode（每个项目一次）

在项目根目录执行：

```powershell
specify init --here --force --integration opencode --script ps --ignore-agent-tools
```

本项目已初始化，关键配置为：

```text
.specify/integration.json
.opencode/commands/speckit*.md
```

### 3.3 安装 Superpowers Bridge (`superb`)（每个项目一次）

```powershell
$env:PYTHONIOENCODING="utf-8"
specify extension add superpowers-bridge --from https://github.com/RbBtSn0w/spec-kit-extensions/releases/download/superpowers-bridge-v1.3.0/superpowers-bridge.zip
```

验证扩展：

```powershell
$env:PYTHONIOENCODING="utf-8"
specify extension list
```

期望看到：

```text
✓ Superpowers Bridge (v1.3.0)
  superb
  Commands: 8 | Hooks: 3 | Status: Enabled
```

### 3.4 确保 superb 能找到 Superpowers skills

`superb` 只按以下顺序查找 skills：

```text
./.agents/skills/
~/.agents/skills/
```

本机 opencode 的 Superpowers skills 在：

```text
C:\Users\caiqy\.config\opencode\superpowers\skills\
```

因此需要链接到：

```text
C:\Users\caiqy\.agents\skills\
```

Windows 推荐使用 Junction：

```powershell
$source = "C:\Users\caiqy\.config\opencode\superpowers\skills"
$target = "C:\Users\caiqy\.agents\skills"

Get-ChildItem -Path $source -Directory | ForEach-Object {
  $link = Join-Path $target $_.Name
  if (-not (Test-Path -LiteralPath $link)) {
    New-Item -ItemType Junction -Path $link -Target $_.FullName
  }
}
```

然后在 opencode 中运行：

```text
/speckit.superb.check
```

期望结论：

```text
Verdict: READY
```

---

## 4. 每个新功能的完整流程

下面是从想法到收尾的推荐顺序。

```text
0. 判断是否需要完整流程
1. /speckit.constitution        项目原则（项目内通常只做一次）
2. /speckit.specify             写功能规格
3. /speckit.clarify             澄清遗漏或歧义
4. /speckit.checklist           检查需求质量（可选但推荐）
5. /speckit.plan                写技术计划
6. /speckit.tasks               拆任务
7. /speckit.analyze             检查 spec / plan / tasks 一致性（推荐）
8. /speckit.superb.review       检查任务覆盖和 TDD readiness
9. /speckit.implement           执行实现；superb hook 会介入 TDD 和 verify
10. /speckit.superb.critique    对照规格评审实现（推荐）
11. /speckit.superb.respond     处理评审反馈（如有）
12. /speckit.superb.finish      分支收尾：PR / 保留 / 丢弃等
```

---

## 5. 第 0 步：判断是否需要完整流程

给 AI 发：

```text
我准备做一个改动：<一句话描述改动>。
请先判断这个改动应该走完整的 Spec Kit + Superpowers 流程，还是只需要直接修改。
如果建议走完整流程，请说明原因，并告诉我下一条应该发送哪个 /speckit 命令。
```

示例：

```text
我准备给 WebGUI 的消息输入框增加图片粘贴上传能力。
请先判断这个改动应该走完整的 Spec Kit + Superpowers 流程，还是只需要直接修改。
如果建议走完整流程，请说明原因，并告诉我下一条应该发送哪个 /speckit 命令。
```

---

## 6. 第 1 步：建立项目原则 `/speckit.constitution`

项目只需要做一次；如果 `.specify/memory/constitution.md` 已经存在，后续只在原则变化时更新。

给 AI 发：

```text
/speckit.constitution

请为本仓库建立或更新 Spec Kit constitution。

项目背景：OpenCode IDE Plugin 是基于 opencode 的 IDE 插件项目，包含 WebGUI、VSCode 插件、JetBrains 插件和 opencode 核心适配。

请重点纳入这些原则：
1. 上游兼容优先：合并上游时尽量同时保留上游逻辑和 WebGUI / IDE 插件逻辑。
2. 功能不退化：上游合并后构建通过，WebGUI 和 IDE 插件可用。
3. 测试与验证优先：关键改动需要可执行验证证据。
4. TypeScript / React / Kotlin 代码遵循本仓库 AGENTS.md 中的约定。
5. 实现阶段必须遵守 Superpowers 的 TDD、systematic-debugging 和 verification-before-completion 纪律。
6. 对不确定需求必须先澄清，不允许直接猜测实现。
```

如果只是检查是否已建立：

```text
请检查 `.specify/memory/constitution.md` 是否已经足够覆盖本仓库的开发原则。
如果缺少 Spec Kit + Superpowers 组合规则，请提出补充建议，不要直接改文件，先让我确认。
```

---

## 7. 第 2 步：创建功能规格 `/speckit.specify`

目标：描述 **要做什么、为什么做、用户如何验收**。不要在这里过早决定技术实现细节。

给 AI 发：

```text
/speckit.specify <功能标题>

我要实现：<功能目标>。

背景：
- <为什么需要这个功能>
- <当前痛点或用户场景>

期望行为：
- <用户做什么>
- <系统应该如何响应>
- <边界情况或错误情况>

非目标：
- <明确不做什么，避免范围膨胀>

验收标准：
- <如何判断完成>
- <必须保留哪些现有行为>

请只关注需求和验收，不要直接写实现代码。
如果需求不清晰，请在 spec 中标记需要澄清的问题。
```

示例：

```text
/speckit.specify WebGUI 支持图片粘贴上传

我要实现：用户在 WebGUI 的消息输入框中粘贴图片时，可以把图片作为附件加入当前消息。

背景：
- 用户经常需要把截图发给 AI 分析。
- 目前只能输入文字，截图需要绕路保存文件再引用，体验较差。

期望行为：
- 用户复制一张图片后，在消息输入框粘贴。
- 系统把图片加入当前消息的附件列表。
- 用户可以在发送前移除该图片。
- 如果图片格式或大小不支持，应显示清晰错误提示。

非目标：
- 本次不做图片编辑。
- 本次不做多模态模型能力适配之外的 provider 重构。

验收标准：
- 粘贴 PNG / JPEG 后能看到附件预览。
- 发送消息时附件信息被正确传递。
- 不影响原有文字粘贴行为。
- 有对应测试或手动验证步骤。

请只关注需求和验收，不要直接写实现代码。
如果需求不清晰，请在 spec 中标记需要澄清的问题。
```

---

## 8. 第 3 步：澄清需求 `/speckit.clarify`

目标：让 AI 针对 spec 中不清楚的地方逐项提问，并写回 spec。

给 AI 发：

```text
/speckit.clarify

请基于当前 feature spec 提出最关键的澄清问题。
要求：
1. 一次只问一个问题。
2. 优先询问会影响实现、数据结构、测试或用户体验的决策。
3. 不要询问无关偏好。
4. 我回答后，请把结论写回 spec 的 Clarifications 或对应需求段落。
```

如果你认为需求已经清晰：

```text
/speckit.clarify

请检查当前 spec 是否仍有必须澄清的问题。
如果没有，请明确说明可以进入 `/speckit.checklist` 或 `/speckit.plan`。
```

---

## 9. 第 4 步：需求质量检查 `/speckit.checklist`

目标：检查 spec 是否完整、清晰、可测试。

给 AI 发：

```text
/speckit.checklist

请为当前 feature spec 生成需求质量检查清单，并逐项检查：
1. 是否存在模糊词或不可测试表述。
2. 是否覆盖主要用户故事。
3. 是否包含边界情况和错误场景。
4. 是否明确非目标。
5. 是否有可验证的验收标准。

如果发现问题，请先列出问题和建议，不要直接进入实现。
```

如果清单发现问题，给 AI 发：

```text
请根据 checklist 中未通过的项目修订当前 spec。
修订时保持范围克制，不要新增未确认的大功能。
修订完成后再次说明哪些 checklist 项已经满足。
```

---

## 10. 第 5 步：生成技术计划 `/speckit.plan`

目标：把需求转成技术方案、涉及文件、数据流、测试策略。

给 AI 发：

```text
/speckit.plan

请基于当前 spec 生成技术实现计划。

技术约束：
- 遵守本仓库 AGENTS.md 的代码规范。
- WebGUI 使用 React 19 + Vite + Tailwind。
- opencode 核心使用 TypeScript / Bun / Effect 风格。
- VSCode 插件使用 TypeScript。
- JetBrains 插件使用 Kotlin。
- 尽量复用现有模式，避免无关重构。

计划需要包含：
1. 受影响模块和文件。
2. 数据流或 API 变化。
3. UI / 状态管理变化。
4. 错误处理策略。
5. 测试策略。
6. 风险和回滚方案。

不要写实现代码；如果需要探索现有代码，请先说明要查什么，再基于证据写计划。
```

如果计划看起来过度设计：

```text
请审视当前 plan 是否过度设计。
要求：
1. 删除与当前验收标准无关的工作。
2. 标记可以后续迭代的内容。
3. 保留能满足当前 spec 的最小可靠方案。
```

---

## 11. 第 6 步：生成任务 `/speckit.tasks`

目标：把 plan 拆成可执行任务。任务应足够小，便于 TDD 和验证。

给 AI 发：

```text
/speckit.tasks

请基于当前 spec 和 plan 生成 tasks.md。

要求：
1. 任务按依赖顺序排列。
2. 能并行的任务标记为 [P]。
3. 涉及代码修改的任务必须优先包含测试或验证任务。
4. 每个任务要写清具体文件路径或模块。
5. 每个用户故事应能独立验证。
6. 不要把多个大改动塞进一个任务。
```

---

## 12. 第 7 步：一致性检查 `/speckit.analyze`

目标：检查 spec / plan / tasks 之间是否矛盾、遗漏或重复。

给 AI 发：

```text
/speckit.analyze

请检查当前 spec、plan、tasks 是否一致。
重点检查：
1. 每条验收标准是否有对应任务。
2. 每项技术计划是否能追溯到需求。
3. tasks 是否引入 spec 未要求的功能。
4. 是否存在顺序依赖错误。
5. 是否有未覆盖的测试或验证缺口。

如果发现问题，请输出修复建议；修复前先让我确认。
```

如果需要让 AI 修复：

```text
请按刚才的 analyze 结果修复 spec / plan / tasks 中的不一致。
只修复已确认的问题，不要扩大范围。
修复后总结变更点。
```

---

## 13. 第 8 步：superb 任务覆盖检查 `/speckit.superb.review`

目标：在实现前检查 tasks.md 是否足以支撑 TDD 实现。

给 AI 发：

```text
/speckit.superb.review

请检查当前 tasks.md 是否完整覆盖 spec.md 和 plan.md。
重点关注：
1. 是否每个需求都有任务。
2. 是否每个任务足够小，可以按 TDD 执行。
3. 是否缺少测试任务或验证任务。
4. 是否存在任务顺序或依赖问题。

如果发现缺口，请列出 gap report，并说明应该修改 spec、plan 还是 tasks。
```

如果 review 发现缺口：

```text
请根据 /speckit.superb.review 的 gap report 修复 tasks.md。
只补齐缺失任务和测试/验证任务，不改变已确认的需求范围。
修复后请再次说明是否 TDD-ready。
```

---

## 14. 第 9 步：执行实现 `/speckit.implement`

目标：按 tasks.md 实现。`superb` 会通过 hook 在实现前后介入：

- `before_implement` → `/speckit.superb.tdd`
- `after_implement` → `/speckit.superb.verify`

给 AI 发：

```text
/speckit.implement

请按当前 tasks.md 执行实现。

硬性要求：
1. 遵守 superb 的 TDD gate：涉及代码修改的任务必须先写失败测试或明确验证步骤。
2. 一次只处理当前任务，不要顺手做无关重构。
3. 遇到失败或异常时，停止猜测，使用 /speckit.superb.debug 的系统化调试流程。
4. 完成前必须提供新鲜验证证据，包括实际运行的命令和结果。
5. 不要把任务标记完成，除非验证证据支持。
```

如果实现过程中 AI 开始跳过测试，可以打断：

```text
停止。请回到 superb / Superpowers 的 TDD 要求。
先说明当前任务对应的失败测试或验证步骤是什么，然后再继续实现。
```

---

## 15. 失败或异常：使用 `/speckit.superb.debug`

当出现以下情况时使用：

- 测试失败
- 构建失败
- UI 行为不符合预期
- AI 连续尝试修复但没有定位根因
- 出现不清楚的运行时错误

给 AI 发：

```text
/speckit.superb.debug

当前问题：<粘贴错误、失败测试或异常行为>。

请按 systematic-debugging 流程处理：
1. 先读取完整错误信息。
2. 复现问题。
3. 查最近变更和相关代码路径。
4. 提出一个明确 root-cause 假设。
5. 用最小验证方式验证假设。
6. 只有确认根因后才能修改代码。

不要直接猜测修复。
```

如果 AI 想一次改很多地方：

```text
停止。请一次只验证一个假设。
先说明你认为的根因、证据、最小修改点，再继续。
```

---

## 16. 实现后评审：`/speckit.superb.critique`

目标：对照 spec / plan / tasks 审查实际代码 diff，发现偏离、遗漏和风险。

给 AI 发：

```text
/speckit.superb.critique

请对当前实现进行 spec-aligned code review。

要求：
1. 读取当前 feature 的 spec.md、plan.md、tasks.md。
2. 检查 git diff 中的实现是否满足验收标准。
3. 检查是否存在未实现需求、过度实现、测试缺口、错误处理缺口。
4. 按 Critical / High / Medium / Low 输出问题。
5. 对每个问题说明对应的 spec / plan / task 依据。
6. 不要直接修改代码，先输出评审结果。
```

---

## 17. 处理评审反馈：`/speckit.superb.respond`

当 `/speckit.superb.critique`、PR review 或人工 review 给出反馈后使用。

给 AI 发：

```text
/speckit.superb.respond

请处理以下评审反馈：

<粘贴评审反馈>

要求：
1. 逐条判断反馈是否成立。
2. 对不成立或需要澄清的反馈说明原因，不要盲目照做。
3. 对成立的反馈，提出最小修改方案。
4. 涉及代码修改时继续遵守 TDD 和验证要求。
5. 修改后提供验证证据。
```

---

## 18. 分支收尾：`/speckit.superb.finish`

当实现、验证和评审都完成后使用。

给 AI 发：

```text
/speckit.superb.finish

当前功能已经实现并通过验证。
请按 finishing-a-development-branch 流程帮助我收尾。

请先检查：
1. 当前 git status。
2. 当前分支和 main/master 的关系。
3. 是否还有未验证变更。
4. 是否需要创建 PR、保留分支、合并或丢弃。

不要自动 commit、merge、push 或创建 PR，除非我明确确认。
```

如果你要创建 commit，可以明确说：

```text
请为当前已验证的改动创建一个 git commit。
提交前请检查 git status、git diff 和最近 commit 风格。
不要 push。
```

如果你要创建 PR：

```text
请创建 PR。
先检查当前分支、与 base branch 的 diff、是否需要 push。
PR 描述要引用 spec / plan / tasks 的核心内容，并列出验证证据。
```

---

## 19. 常用快捷消息模板

### 19.1 开始一个新功能

```text
我想实现：<功能一句话>。
请先判断是否需要完整 Spec Kit + Superpowers 流程。
如果需要，请引导我从 /speckit.specify 开始，并提醒我每一步应该提供什么信息。
```

### 19.2 要求 AI 不跳步骤

```text
请严格遵守本仓库的 Spec Kit + Superpowers 工作流。
现在处于 <specify/clarify/plan/tasks/implement/review> 阶段。
不要跳到后续阶段，不要写与当前阶段无关的代码。
```

### 19.3 要求 AI 给出下一步

```text
请根据当前 `.specify/` 状态判断下一步应该执行哪个命令。
只给出一个推荐命令，并说明原因。
```

### 19.4 发现范围膨胀

```text
请检查当前方案是否超出 spec 的验收标准。
把必须做、可选做、明确不做分开列出。
不要实现可选项，除非我确认。
```

### 19.5 要求验证证据

```text
请不要直接说完成。
先列出你实际运行的验证命令、输出结果、覆盖了哪些验收标准，以及还有哪些未验证风险。
```

---

## 20. 常见问题

### 20.1 `/speckit.superb.check` 找不到 skills

确认以下文件存在：

```text
C:\Users\caiqy\.agents\skills\test-driven-development\SKILL.md
C:\Users\caiqy\.agents\skills\verification-before-completion\SKILL.md
C:\Users\caiqy\.agents\skills\systematic-debugging\SKILL.md
C:\Users\caiqy\.agents\skills\receiving-code-review\SKILL.md
C:\Users\caiqy\.agents\skills\finishing-a-development-branch\SKILL.md
```

如果不存在，重新执行 Junction 链接命令，或把 skills 复制到 `C:\Users\caiqy\.agents\skills\`。

### 20.2 `specify extension search` 在 Windows 下 Unicode 报错

先设置：

```powershell
$env:PYTHONIOENCODING="utf-8"
```

再执行 specify 命令。

### 20.3 是否要同时使用 `/speckit.implement` 和手动 Superpowers 执行？

本项目安装的 `superb` 设计是增强 Spec Kit 主流程，所以推荐使用：

```text
/speckit.implement
```

并让 `superb` 的 hooks 自动处理 TDD 和 verification。

不要再额外让 AI 用另一套 `executing-plans` 重跑同一个 `tasks.md`，否则容易产生双重执行和状态混乱。

### 20.4 什么时候手动调用 `/speckit.superb.tdd` 或 `/speckit.superb.verify`？

通常不需要；它们是 hookable 命令，会围绕 `/speckit.implement` 触发。

只有在你怀疑 hook 没触发、或想单独检查 TDD / verify 纪律时，才手动调用。

---

## 21. 推荐的完整对话示例

下面是一轮理想对话顺序。

```text
用户：我想实现 WebGUI 支持图片粘贴上传。请判断是否需要完整 Spec Kit + Superpowers 流程。

用户：/speckit.specify WebGUI 支持图片粘贴上传
...补充背景、期望行为、非目标、验收标准...

用户：/speckit.clarify

用户：/speckit.checklist

用户：请根据 checklist 修订 spec，但不要扩大范围。

用户：/speckit.plan
...补充技术约束...

用户：请审视 plan 是否过度设计，保留最小可靠方案。

用户：/speckit.tasks

用户：/speckit.analyze

用户：请修复 analyze 发现的不一致，只修复已确认问题。

用户：/speckit.superb.review

用户：请根据 gap report 修复 tasks.md，并再次说明是否 TDD-ready。

用户：/speckit.implement

用户：/speckit.superb.critique

用户：/speckit.superb.respond
...粘贴评审反馈...

用户：/speckit.superb.finish
```

---

## 22. 最小记忆口诀

```text
需求不清：clarify
计划之前：spec/checklist
实现之前：tasks/analyze/review
实现之中：implement + TDD
失败之时：debug
完成之前：verify
完成之后：critique/respond/finish
```
