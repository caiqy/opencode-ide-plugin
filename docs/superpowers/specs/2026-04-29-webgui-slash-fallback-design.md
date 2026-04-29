# WebGUI 未知 /输入降级为普通消息设计

> 日期：2026-04-29
> 状态：待审阅

## 问题

当前 webgui 在发送消息时，只要输入文本以 `/` 开头，就会直接按 command 请求发送到后端 `session.command`。

这在已知 slash 项上是正确的，例如：

- `/init`
- `/review`
- `/<skill-name>`
- `/<mcp-prompt-name>`

但当用户输入的是一个**并不存在的 slash 项**时，例如：

- `/123`
- `/123 abc`
- `/unknown-command do something`

前端仍会把它当成 command 调用后端，最终收到：

- `Command not found: "..."`

实际结果是：

- 用户只是输入了一个以 `/` 开头的普通文本
- 界面却弹出发送失败 toast 与会话错误
- 错误信息里还会附带整串可用 commands / skills，噪音很大

而同仓库中的另一个前端实现已经有更稳妥的行为：只有匹配到已知 command 时才走命令执行，否则按普通消息发送。因此本次需要把 webgui 对齐到这种更安全的策略。

## 范围

本次只处理 **webgui 消息输入框对 `/` 开头文本的发送分流逻辑**。

包含：

- 调整 `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts` 的 slash 判定方式
- 让未知 slash 项不再调用 `session.command`
- 保证未知 slash 项按原始文本走普通消息发送
- 保持已知 command / skill / MCP prompt 的 slash 执行行为不变
- 补充 webgui 回归测试

不包含：

- 修改后端 `session.command` 对未知命令的报错语义
- 修改 slash 自动补全的 UI 样式、排序或展示文案
- 修改 TUI、CLI、`packages/app` 或其他客户端的命令解析行为
- 新增新的 toast、提示条或输入框警告文案
- 重新设计 command / skill / MCP 的数据模型

## 方案

采用“**前端发送前做精确匹配，未命中则降级为普通消息**”的方案。

核心规则：

1. 用户输入以 `/` 开头时，先提取首个 token 作为 slash 名称候选
2. 使用 `/command` 返回的完整列表做精确匹配
3. 若命中已知项，则继续走 `session.command`
4. 若未命中，则改走 `session.prompt`
5. 降级为普通消息时，文本保持原样，不移除前导 `/`

### 为什么选择这个方案

- 根因在 webgui 发送前的分流逻辑，而不是后端 command 执行本身
- `/command` 列表已经统一聚合了 `command`、`skill`、`mcp` 三类 slash 项，直接复用即可，避免前端维护三套来源
- 保留后端未知命令报错语义，可以避免影响 TUI、CLI 或其他仍依赖该错误的调用方
- 用户目标是“未匹配时不要报错，原样展示”，前端提前分流比“先报错再重试”更符合预期

## 设计细节

### slash 判定规则

发送阶段不再使用“`text.startsWith("/")` 就等于 command”这种粗粒度判断，而是改成两步：

1. **识别候选名称**
   - `/review foo` → `review`
   - `/123 abc` → `123`
   - `/skill-name` → `skill-name`

2. **做精确匹配**
   - 候选名称存在于 `/command` 列表中：视为已知 slash 项
   - 候选名称不存在：视为普通消息

这里的“已知 slash 项”包括：

- source 为 `command`
- source 为 `skill`
- source 为 `mcp`

因为后端 `Command.Service.list()` 已经把这三类合并到了同一个 `/command` 列表里，所以前端不需要分别查询 `/skill` 或其他接口。

### 主改动点：`packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`

当前问题发生在 `submitText()`：

- 现在只要 `text.startsWith("/")` 就会进入 command 分支
- 这会把未知 slash 文本也发送到 `sdk.session.command(...)`

本次把这里改成“解析 + 匹配后再分流”：

- **已知 slash 项**：继续走 `sdk.session.command(...)`
- **未知 slash 项**：走 `sdk.session.prompt(...)`

普通消息分支里不对文本做额外变形，因此：

- `/123` 仍作为 `/123` 发送
- `/123 abc` 仍作为 `/123 abc` 发送

这保证了“原样展示、原样发送”的目标。

### 与自动补全数据源保持一致

当前 slash 自动补全使用 `useCommandSearch()`，其数据来源是 `sdk.command.list()`，本质上就是 `/command`。

本次发送阶段应复用同一类数据源，避免出现以下不一致：

- 自动补全认为某个 slash 项可用，但发送阶段不认识
- 自动补全不展示某个项，但发送阶段却按 command 执行

是否通过提取共享加载函数、共享缓存，或在 `useMessageInput` 中单独复用 `sdk.command.list()`，属于实现细节；但原则上发送判定与自动补全必须依赖同一份 slash 真源。

### 加载失败时的降级策略

发送前可能遇到 command 列表暂时不可用，例如：

- `/command` 请求失败
- 命令缓存尚未建立且加载异常

这种情况下，本次采用**保守降级为普通消息**的策略，而不是继续盲目调用 `session.command`。

原因是本次修复目标是消除“未知 slash 项导致前端报错”的体验问题。若列表不可用时仍强行走 command 分支，用户仍会看到相同的失败结果；而按普通消息发送则更接近“宽容处理未知 slash 文本”的目标。

### 编辑器发送与 quick phrase 一致性

`submitText()` 同时服务于：

- 编辑器直接发送
- quick phrase 发送

本次应把 slash 匹配逻辑放在这条共享链路中，而不是只修补某一个入口。这样可以保证：

- 手工输入 `/123 abc` 不报错
- quick phrase 内容恰好以 `/` 开头时，也遵循相同规则

避免两套入口出现行为分叉。

### 边界行为

本次将以下输入统一视为“未匹配 slash 时的普通文本”：

- `/`
- `/   `
- `/123`
- `/123 abc`
- `/unknown-command do something`

其中：

- 若最终文本在现有普通消息规则下属于空消息，继续沿用当前空消息保护，不额外扩展产品语义
- 若最终文本非空，则原样进入普通消息发送链路

也就是说，本次目标是**消除误判成 command 的错误**，而不是重新定义空消息产品规则。

## 文件改动清单

### 前端修改

- `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- 如需提取共享判定 / 加载逻辑，可能新增一个小型辅助模块，例如放在 `hooks/` 或 `lib/` 下，但优先保持职责清晰、改动聚焦
- 如需要复用现有 slash 数据缓存，可能涉及 `packages/opencode/webgui/src/hooks/useCommandSearch.ts`

### 测试修改

- `packages/opencode/webgui/src/components/MessageInput/...` 现有相关测试文件
- 若更适合直接测 hook 行为，可新增与 `useMessageInput` 同主题的测试文件；但应优先贴近当前 MessageInput 测试组织方式

## 测试

本次适合按 TDD 补 4 组回归测试，先观察失败，再补实现。

### 1. 已知 slash 项仍走 command

至少覆盖：

1. 输入 `/review`
2. 调用 `sdk.session.command`
3. 不调用 `sdk.session.prompt`

### 2. 未知 slash 项降级为普通消息

至少覆盖：

1. 输入 `/123`
2. 不调用 `sdk.session.command`
3. 调用 `sdk.session.prompt`
4. prompt 文本保持 `/123`

### 3. 未知 slash 项带参数时仍原样发送

至少覆盖：

1. 输入 `/123 abc`
2. 走普通消息发送
3. prompt 文本保持 `/123 abc`

### 4. slash 列表加载失败时不再报 command not found

至少覆盖：

1. 命令列表加载失败
2. 输入 `/123`
3. 不调用 `sdk.session.command`
4. 仍按普通消息发送

如现有测试结构方便，也可补充 `/` 与 `/   ` 的边界测试，但优先级低于上述 4 类核心回归场景。

## 风险与兼容性

### 风险

- 若 slash 匹配逻辑与自动补全使用不同数据源，可能造成展示与发送不一致
- 若在列表加载失败时直接阻止发送，可能引入新的卡死或无响应体验
- 若错误地移除前导 `/`，会破坏“原样展示”的明确需求
- 若把逻辑只放在编辑器入口，quick phrase 仍可能保留旧问题

### 降低风险的方式

- 统一使用 `/command` 作为 slash 真源
- 把判定逻辑放在 `submitText()` 共享链路中
- 未命中与加载失败都降级为普通消息，而不是抛错
- 用回归测试分别覆盖：已知 slash、未知 slash、未知 slash + 参数、加载失败

## 非目标

本次不处理：

- 在输入时就阻止用户键入未知 `/xxx`
- 为未知 slash 项增加特殊灰态提示或内联校验 UI
- 修改后端错误文案 `Command not found`
- 让所有客户端都自动拥有相同降级逻辑
- 重做整个 slash 自动补全、命令中心或技能管理界面

## 预期结果

修复后，webgui 中 `/` 开头文本的发送行为会更符合用户直觉：

- `/review` 这类已知 slash 项继续按原有方式执行
- `/123`、`/123 abc` 这类未匹配内容不再触发 `Command not found`
- 未匹配文本按普通消息原样发送与展示

最终用户会看到：真正存在的 slash 项继续工作；不存在的 `/xxx` 则只是普通文本，不再制造无意义的发送失败与会话错误噪音。
