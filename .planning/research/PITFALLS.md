# 领域陷阱

**领域:** 下游 Fork 同步——基于上游 CLI (opencode) 构建的 WebGUI + IDE 插件
**研究日期:** 2026-04-12
**总体置信度:** 高（基于实际合并历史和代码库分析）

---

## 严重陷阱

导致重写、发布中断或多天恢复工作的错误。

### 陷阱 1: 上游核心修改成为永久性合并税

**问题描述:** 下游修改了 `packages/opencode/src/` 中的 12 个文件（config.ts、server.ts、mcp/index.ts、provider/provider.ts、session/message-v2.ts、skill/index.ts 等），用于添加 WebGUI 功能（MCP 工具开关、技能权限、服务器路由）。每次上游合并都必须手动协调这 12 个文件，而上游频繁修改这些文件——仅 server 就经历了多次重大重构（Bun→Hono、workspace 路由、Effect.js 迁移）。

**发生原因:** 在最近的上游文件上直接打补丁来添加功能是最省事的做法，而不是创建扩展点。MCP 路由添加（routes/mcp.ts）、配置覆盖层（config.ts）和服务器挂载点（server.ts → webgui/server/app.ts）都是对上游的直接修改。

**后果:**

- 51 个下游提交涉及上游 src——每一个都是未来的冲突点
- 大合并（41ce0564a）修改了 790 个文件，新增 46K 行：随着分歧增长，这个规模还会扩大
- 仅 `server.ts` 在最近几个月就被上游重构了约 10 次
- 如果上游移动了你打过补丁的文件，`git merge` 会静默丢弃你的更改

**预警信号:**

- 合并提交耗时超过 1 小时
- `git diff opencode/dev...HEAD -- packages/opencode/src/` 随时间增长
- 合并提交信息中提到"resolve conflicts in server.ts"（已发生 3 次以上）

**预防措施:**

1. 审计 `packages/opencode/src/` 中的每个下游更改——分类为"可提取到扩展点"和"必须保留为核心补丁"
2. 对于服务器路由：使用 Hono 中间件组合——通过单独的模块挂载下游路由，`server.ts` 只需一行 import，将合并面最小化到一行导入
3. 对于配置：在 `webgui/` 中使用包装层读取上游配置并叠加下游新增内容，而不是直接修改 `config.ts`
4. 跟踪"合并税"指标：计算 `packages/opencode/src/` 中有下游更改的文件数量
5. 目标：上游文件被修改数 ≤3，理想情况下只有服务器挂载点

**检测方法:** 每次合并前运行 `git diff opencode/dev...HEAD -- packages/opencode/src/ | diffstat`。如果数量在增长，停止添加功能并先进行提取。

**阶段:** 在阶段 1（合并基础）中解决——这是可持续同步的前提条件。

---

### 陷阱 2: Effect.js 迁移雪崩

**问题描述:** 上游正在进行激进的 Effect.js 迁移——销毁门面、将函数签名从 `Promise<T>` 改为 `Effect<T, E, R>`、将 `defineEffect → define` 重命名，以及升级 Effect beta 版本（目前是 beta.46）。这不是一次性重构；而是一个进行中的多月活动，最近几周有 20 多个"destroy X facade"提交。

**发生原因:** 上游项目选择了 Effect.js 进行结构化错误处理和依赖注入。他们的迁移是渐进的——每个 PR 消除一个门面包装器。这意味着*每次*同步都会引入 `packages/opencode/src/` 中的函数签名变更。

**后果:**

- 下游对 `mcp/index.ts`、`config/config.ts`、`provider/provider.ts` 等的补丁可能调用了签名从同步变为 Effect 的函数
- 生成的 SDK（`@opencode-ai/sdk`）可能在服务器的 OpenAPI 规范改变时改变其 API 表面
- TypeScript 编译可能因 Effect 类型推断变化而静默失败（Effect<A, E, R> 是一个复杂的泛型类型）
- `bun.lock` 冲突面随着每次 Effect 版本升级而扩大（他们目前在 beta.46，API 不稳定）

**预警信号:**

- 合并后 `bun typecheck` 失败并引用 Effect 类型
- 导入错误：已删除的门面如 `Question`、`SessionRunState`、`Account` 等
- 运行时错误：下游代码调用的函数现在返回 `Effect<...>` 而不是 `Promise<...>`

**预防措施:**

1. 永远不要从下游代码直接导入或调用内部 Effect 包装的函数——始终通过 HTTP API/SDK 边界
2. 如果下游必须调用上游函数（如 config.ts），将它们包装在一个薄适配器中以吸收签名变更
3. 每次合并前，扫描上游提交中的 `refactor(effect)` 和 `destroy.*facade`——统计有多少涉及你修改过的文件
4. 如果上游升级导致不稳定，在下游补丁中固定一个已知良好的 Effect 版本

**检测方法:** 每次合并后，在做其他任何事情之前立即在 `packages/opencode` 中运行 `bun typecheck`。Effect 类型错误会复合——要尽早发现。

**阶段:** 阶段 1（合并基础）——必须在 Effect 迁移到达你修改过的文件之前建立适配器模式。

---

### 陷阱 3: SDK 重新生成间隙导致静默 API 漂移

**问题描述:** WebGUI 依赖于 `@opencode-ai/sdk`，该 SDK 是从服务器的 OpenAPI 规范自动生成的。当上游添加/更改端点时，SDK 需要重新生成。但 `sdkClient.ts` 有 566 行手动 fetch 包装器，用于 SDK 未覆盖的端点。合并后，生成的 SDK 可能有新的/更改的类型，手动包装器可能命中已更改的端点，而没有任何东西能捕获这种不匹配，因为所有东西都被类型化为 `any`。

**发生原因:** SDK 生成器（`./packages/sdk/js/script/build.ts`）不会在合并期间自动运行。WebGUI 中的 434 多个 `any` 类型意味着 TypeScript 无法捕获 API 形状不匹配。sdkClient.ts 第 252 行的 TODO（"Remove once SDK is regenerated with Stainless"）已经存在数月。

**后果:**

- WebGUI 对形状已更改的 API 响应渲染空白/错误状态
- 新的上游功能（如会话权限、workspace 路由）对 WebGUI 不可见，直到手动接入
- 手动包装器静默返回错误的数据形状——例如缺失新字段的会话对象
- 15 个以上手动包装的 API 端点意味着每次合并有 15 个以上潜在的断裂点

**预警信号:**

- 合并后 WebGUI 显示"undefined"或空白字段
- 控制台报错：API 响应上缺少属性
- 合并后 `sdkClient.ts` 在增长而不是缩减

**预防措施:**

1. **合并后检查项:** 合并后始终使用 `./packages/sdk/js/script/build.ts` 重新生成 SDK
2. **减少手动包装器:** 每个合并阶段应将 2-3 个手动包装器迁移到生成的 SDK
3. **类型化契约:** 用生成 SDK 中的正确类型替换 `ServerEvent` 和 `sdkClient.ts` 中的 `any`——这会将静默失败转为编译时错误
4. **Diff OpenAPI 规范:** 合并前后，比较 `openapi.json` 查看 API 表面发生了什么变化

**检测方法:** 重新生成 SDK 后，运行 `bun typecheck`——新的类型错误揭示了手动包装器偏离实际 API 的位置。

**阶段:** 阶段 1（合并基础）用于重新生成步骤；阶段 2 用于系统性消除 `any`。

---

### 陷阱 4: bun.lock 合并地狱

**问题描述:** `bun.lock` 是一个庞大的类二进制 JSON 文件，在*每次*合并时都会冲突，因为双方都添加/更新依赖。上游频繁升级 AI SDK、Effect 和其他依赖（最近历史中有 10 次以上 bun.lock 变更）。下游添加 React、Tailwind 和 IDE 特定依赖。每次合并都需要删除锁文件并重新生成——但这可能引入意外的版本变更。

**发生原因:** 锁文件不是为多分支工作流设计的。Bun 的锁文件格式对合并特别不友好（在较新版本中是二进制格式）。双方独立解析依赖版本。

**后果:**

- 每次合并都在 bun.lock 冲突上阻塞
- 重新生成后，微妙的依赖版本变更可能破坏东西（特别是有 4 个补丁依赖的情况）
- 补丁依赖（`@ai-sdk/anthropic@3.0.64`、`solid-js@1.9.10` 等）可能静默升级超过补丁版本，从而破坏补丁
- 浪费开发者时间：每次合并仅在 bun.lock 上就花 15-30 分钟

**预警信号:**

- 合并后 `bun install` 出现补丁版本不匹配的警告
- 引用补丁包的构建失败
- 由于锁文件不一致导致 CI 和本地行为不同

**预防措施:**

1. **永远不要手动解决 bun.lock 冲突**——始终接受上游版本，然后运行 `bun install` 重新生成
2. **在合并脚本中自动化:** `git checkout opencode/dev -- bun.lock && bun install`
3. **安装后验证:** 检查所有 4 个补丁在重新生成后是否仍能正常应用
4. **跟踪补丁版本:** 合并前，记录补丁依赖的当前版本。合并后，验证它们没有跳变。
5. **考虑:** 将 WebGUI 专有依赖移到 `packages/opencode/webgui/package.json` 以减少根锁文件变动

**检测方法:** 添加一个 CI 步骤验证 `bun install --frozen-lockfile` 通过且补丁能应用。

**阶段:** 阶段 1（合并基础）——字面上每次合并你会遇到的第一个冲突。

---

## 中等陷阱

### 陷阱 5: 上游添加自己的 WebGUI（并行 UI 分歧）

**问题描述:** 上游已经有一个 SolidJS Web UI（`packages/app/`），可能会扩展它与下游的 React WebGUI 竞争。上游在 `src/webgui/server/app.ts` 中有 `serveWebGuiPath`——意味着他们已经在嵌入 Web UI。如果上游给他们的 SolidJS UI 添加了与 React WebGUI 功能重复的特性，维护两者将变得不合理。

**发生原因:** 上游项目自然希望控制自己的 UI 体验。他们已经在投资 SolidJS Web UI，包括 Figma tokens、启动闪屏和 beta 徽章功能（从分支名可见：`app/startup-splash`、`figma-tokens`、`go-hero-banner`）。

**后果:**

- 功能对等压力：每个上游 SolidJS 功能都需要 React 重新实现
- 用户对两个具有不同功能的 UI 感到困惑
- 如果上游的 Web UI 成为官方 IDE 插件（他们的分支 `sdks/vscode/` 已经存在），下游 Fork 将失去存在理由

**预警信号:**

- 上游出现 `sdks/vscode/` 或 `app/ide-plugin` 等分支
- 上游添加 IDE 特定 API（文件打开、workspace 上下文）
- 上游的 SolidJS UI 获得与你的 WebGUI 功能列表匹配的功能

**预防措施:**

1. **在集成深度上差异化:** 专注于 IDE 特定功能（bridge 协议、文件上下文、workspace 感知），这些是通用 Web UI 无法提供的
2. **考虑向上游贡献:** 不要维护并行的 React UI，而是提议向上游项目贡献 IDE 集成功能
3. **监控上游路线图:** 关注上游 `packages/app/` 目录和 `sdks/` 目录是否有竞争性工作
4. **建立退出策略:** 架构设计 WebGUI 使其可以在上游构建等效功能时被替换

**检测方法:** 每次合并前，检查 `git log opencode/dev -- packages/app/ sdks/` 是否有新的 IDE 相关工作。

**阶段:** 战略关注——在每个里程碑边界重新审视。

---

### 陷阱 6: 补丁依赖在上游依赖升级时中断

**问题描述:** 项目对 4 个依赖打了补丁（`@ai-sdk/anthropic@3.0.64`、`@ai-sdk/provider-utils@4.0.21`、`@standard-community/standard-openapi@0.2.9`、`solid-js@1.9.10`）。上游频繁升级 AI SDK 依赖（最近的提交：`chore: bump ai sdk deps #22005`）。当上游将 `@ai-sdk/anthropic` 从 3.0.64 升级到 3.0.70 时，下游对 3.0.64 的补丁将不再适用。

**发生原因:** 补丁是版本固定的。上游不知道下游的补丁，可以自由升级版本。

**后果:**

- `bun install` 失败并报"patch does not apply"错误
- 构建被阻塞直到手动为新版本更新补丁
- 如果上游的依赖升级修复了补丁所解决的问题，补丁就变成有害的（在正确修复之上应用过时的修复）

**预警信号:**

- CI 中 `bun install` 报错提及补丁
- 上游提交信息包含"bump" + 被补丁包的名称

**预防措施:**

1. **每次合并前:** 检查上游是否升级了 4 个被补丁依赖中的任何一个
2. **对于每个被升级的依赖:** 检查补丁修复的上游问题是否在新版本中已解决
3. **维护补丁跟踪器:** 记录每个补丁修复了什么、上游 issue URL 以及预期解决版本
4. **自动化检测:** 比较合并前后根 `package.json` 中被补丁依赖版本的脚本

**检测方法:** `bun install` 失败是第一个信号。主动方法：diff `package.json` 中被补丁依赖的版本变化。

**阶段:** 阶段 1（合并基础）——添加到合并检查清单。

---

### 陷阱 7: 双包管理器漂移

**问题描述:** 根目录使用带 bun workspaces 的 Bun；`hosts/vscode-plugin` 使用带独立锁文件的 pnpm。TypeScript 版本不同：根目录（5.8.2）、WebGUI（5.9.3）、VSCode 插件（5.0.0）。上游合并后，根目录的 TypeScript 可能升级，与使用 TypeScript 5.0.0（落后 2 个以上主版本）的 VSCode 插件产生类型不兼容。

**发生原因:** VSCode 插件是用 pnpm 独立开发的，将其集成到 bun workspace 被认为风险太大，因为 VSCode 扩展打包需求（`vsce`）。

**后果:**

- WebGUI 和 VSCode 插件之间共享的类型（如消息协议类型）可能不兼容
- `bun install` 和 `pnpm install` 解析不同版本的共享依赖
- CI 必须运行两个独立的安装+构建管道
- WebGUI 中使用的 TypeScript 功能可能无法在 VSCode 插件中编译

**预警信号:**

- WebGUI 变更后 VSCode 插件构建失败
- `CommunicationBridge.ts` 或 `UnifiedMessage.ts` 中引用 WebGUI 类型的类型错误
- `bun.lock` 变更时 `pnpm-lock.yaml` 未更新

**预防措施:**

1. 在独立的 `.d.ts` 文件中定义共享类型，不使用 TS 版本特定功能
2. 每次合并后，始终两者都构建：`bun run build`（根目录）和 `pnpm build`（vscode-plugin）
3. 考虑将 TypeScript 版本对齐到一个小版本之内
4. 长期：评估将 vscode-plugin 迁移到 bun workspace

**检测方法:** CI 必须构建两个目标。通过 `bun build` 但未通过 `pnpm build` 的合并就是此陷阱的表现。

**阶段:** 阶段 1（合并基础）——将两个构建添加到验证检查清单。

---

### 陷阱 8: 服务器挂载点脆弱性

**问题描述:** WebGUI 通过单一集成点提供服务：`server.ts` 从 `src/webgui/server/app.ts` 导入 `serveWebGuiPath` 并挂载。上游在最近历史中已重构其服务器架构 3 次（workspace 路由、Hono 迁移、中间件简化）。每次重构都有破坏或删除此挂载点的风险。

**发生原因:** 挂载点是对上游文件的下游添加。上游开发者不知道它的存在，因此在重构时不会保护它。

**后果:**

- 合并后 WebGUI 变得不可访问——挂载调用在 server.ts 重构期间丢失
- 没有测试能捕获这个问题，因为没有完整服务器→webview 流程的 E2E 测试
- 用户看到空白/错误的 webview，没有清晰的错误信息

**预警信号:**

- `server.ts` 出现在合并冲突文件中
- 上游提交信息提到"refactor(server)"或"replace"服务器组件
- 合并后，导航到 WebGUI URL 返回 404

**预防措施:**

1. 添加冒烟测试：构建后，`curl localhost:PORT/` 应返回带有 WebGUI 标记的 HTML
2. 使挂载点尽可能小——理想情况下只有一个导入和一个 `app.route()` 调用
3. 如果上游采用服务器路由的插件/中间件系统，将挂载迁移到使用该系统
4. 嵌入方式中的 `initScript`（`src/webgui/server/app.ts`）是好的——它是自包含的。保持这种状态。

**检测方法:** 合并后冒烟测试：启动服务器，访问 `/`，验证 HTML 响应。

**阶段:** 阶段 1（合并基础）——添加到自动化验证。

---

## 轻微陷阱

### 陷阱 9: IDE Bridge 协议版本偏差

**问题描述:** CommunicationBridge（VSCode↔WebGUI 消息传递）定义了自己的协议类型。当上游更改会话、消息或配置的工作方式时，bridge 协议可能传递过时的数据形状。由于错误处理被静默吞掉（36 个以上的空 catch 块），bridge 故障是不可见的。

**预防措施:**

1. 给 bridge 协议加版本号，连接时进行握手
2. 用至少 `console.warn` 替换 bridge 代码中的空 catch 块
3. 添加协议兼容性测试，验证 VSCode 和 WebGUI 在消息类型上达成一致

**阶段:** 阶段 2——在合并基础稳定之后。

---

### 陷阱 10: 嵌入式二进制文件提取在上游构建变更时中断

**问题描述:** VSCode 插件的 `ResourceExtractor.ts` 期望扩展包中有特定的二进制文件布局。如果上游更改了 Go 二进制文件的构建方式（名称、路径、编译标志），提取器会静默失败，用户会看到"connecting..."旋转图标 5 分钟后超时。

**预防措施:**

1. 添加二进制验证步骤：提取后，运行 `opencode --version` 确认其可用
2. 将 300 秒超时减少到 30 秒，并提供清晰的错误信息
3. 每次合并后，验证 `build_opencode.sh` 中的二进制名称/路径与 `ResourceExtractor.ts` 的期望匹配

**阶段:** 阶段 1——添加到合并验证检查清单。

---

### 陷阱 11: 测试套件分歧

**问题描述:** 上游测试可能依赖于下游补丁已更改的 fixture、配置或行为。合并后，上游测试可能因为下游更改了 `config.ts` 或 `mcp/index.ts` 以改变预期行为而失败。反之，WebGUI 功能的下游测试可能在上游更改 API 响应时中断。

**预防措施:**

1. 每次合并后运行完整测试套件：`packages/opencode` 中的 `bun test`、`webgui` 中的 vitest、`vscode-plugin` 中的 mocha
2. 保持下游测试 fixture 与上游测试 fixture 隔离
3. 使用标签或目录区分："我们运行但不修改的上游测试"与"我们的测试"

**阶段:** 阶段 1——合并验证的一部分。

---

### 陷阱 12: 合并频率与合并痛苦——指数曲线

**问题描述:** 合并间隔太长会使每次合并呈指数级变难。该项目历史上进行了 10 次以上合并，但有些是批量的（41ce0564a 覆盖了"355 个提交"——v1.3.0 到 v1.3.3）。当这种情况发生时，冲突堆积，开发者失去对上游变更的上下文，合并变成多天的折磨。

**发生原因:** 合并令人不快，因此被推迟。每次推迟都使下一次合并更不愉快，形成死亡螺旋。

**预防措施:**

1. **每周至少合并一次**——即使没有要发布的内容，也要拉取上游并在冲突还小的时候解决
2. **自动化冲突检测:** 运行 `git merge --no-commit --no-ff opencode/dev` 的脚本，报告冲突，然后中止
3. **预算合并时间:** 每周分配 2-4 小时用于上游同步，而不是作为特殊事件
4. **跟踪合并时长:** 如果合并耗时超过 2 小时，这是需要更频繁合并或减少上游文件修改的信号

**检测方法:** `git log --oneline opencode/dev..HEAD | wc -l`——如果这个数字超过 50，你已经逾期了。

**阶段:** 阶段 1——作为流程建立的一部分确定节奏。

---

## 阶段特定警告

| 阶段主题         | 可能的陷阱                                        | 缓解措施                                                         |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| 阶段 1: 合并基础 | bun.lock 地狱（#4）阻塞首次合并尝试               | 在尝试第一次自动化合并之前编写锁文件重新生成流程的脚本           |
| 阶段 1: 合并基础 | Effect.js 迁移（#2）在合并后破坏类型检查          | 合并后立即运行 `bun typecheck`，在任何其他验证之前               |
| 阶段 1: 合并基础 | 上游核心修改（#1）导致级联冲突                    | 在构建自动化之前审计并提取下游补丁                               |
| 阶段 2: 验证管道 | SDK 重新生成间隙（#3）导致静默 API 漂移           | 使 SDK 重新生成成为强制性 CI 步骤，而非可选                      |
| 阶段 2: 验证管道 | 双包管理器（#7）意味着"构建通过"≠"所有构建通过"   | CI 必须构建根目录(bun)和 vscode-plugin(pnpm)和 jetbrains(gradle) |
| 阶段 2: 验证管道 | 服务器挂载脆弱性（#8）不做 E2E 冒烟测试就无法检测 | 添加最小冒烟测试：启动服务器，curl /，验证 HTML                  |
| 持续: 每次合并   | 上游依赖升级时补丁依赖中断（#6）                  | 合并前后检查被补丁依赖版本                                       |
| 持续: 每次合并   | 合并频率衰减（#12）导致指数级痛苦                 | 强制每周合并节奏，跟踪合并时长                                   |
| 战略: 里程碑评审 | 上游并行 UI（#5）侵蚀差异化                       | 监控上游 `packages/app/` 和 `sdks/` 是否有竞争性 IDE 工作        |

## 复合风险："一切同时崩溃"场景

最危险的情况是陷阱 #1、#2、#4 和 #6 同时触发：上游进行了一次大的 Effect.js 重构（#2），更改了你修改过的文件中的函数签名（#1），升级 AI SDK 依赖破坏了你的补丁（#6），并重新生成了锁文件（#4）。这已经几乎发生过——355 个提交的合并（41ce0564a）触及了所有这些层面。

**复合风险的预防:**

- 永远不要让合并间隙超过 2 周
- 先将上游合并到一次性分支中，测试，然后再合并到你的开发分支
- 在最近一次成功的合并点上保持一个"last known good"标签

---

## 来源

- 实际代码库分析：`git remote -v`、`git log`、`git diff --stat`
- 代码库审计的 CONCERNS.md（2026-04-12）
- 上游提交历史：`opencode/dev` 分支，领先下游 820+ 提交
- 合并历史：10 次以上合并提交，提交信息中有冲突说明
- 上游 Effect.js 迁移：最近几周有 20+ "destroy facade"提交
- 置信度：高——所有发现来自直接的代码库证据，无需外部来源

---

_陷阱审计：2026-04-12_
