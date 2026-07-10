# WebGUI 大版本回归恢复

> 修复大版本同步直接引入的功能缺失，并收敛当前已确认的 WebGUI 会话、SDK 适配和宿主更新故障。

## 背景

大版本同步提交 `53ecc6ef0bdcdbcc438576a519c19b155793a888` 相对同步前基线 `c6924271f49262720161cc273c5a24bf70dc0027` 改动了 backend、Schema、SDK 和 WebGUI 的大量契约。第一轮修复已恢复流式文件工具、fork WebGUI 构建、配置热更新、generated-image `relativePath` 和发布版本注入，但并行复审仍确认三类问题：

1. 同步直接引入的回归：内置 reviewer 丢失、provider-native 生图断链、release preflight 失败。
2. 旧 WebGUI SDK 适配层与当前 backend 契约不一致。
3. 会话断线、重试、回退和宿主升级的失败路径会产生错误状态或静默失败。

## 目标

1. 恢复同步前明确存在且仍有用户价值的能力。
2. 让 WebGUI 在刷新、SSE 重连和 HTTP 失败后回到服务端真实状态。
3. 让 retry、revert、redo、abort、fork 和 diff 使用当前 backend 契约。
4. 确保新插件不会复用旧 backend，也不会继续提供旧 WebGUI。
5. 恢复 release preflight，使现有发布任务可以启动。

非目标：

- 不恢复已被上游明确移除的 scout。
- 不扩大 VSCode Windows ARM64 或 JetBrains Marketplace 的平台范围。
- 不在本变更中修正全部 OpenAPI `requestBody.required`；该问题影响约 50 个 endpoint，应独立变更。
- 不重写 WebGUI API 层或整体迁移到 SDK Next。

## 实施分批

### 第一批：核心回归与发布

#### 只读 reviewer

恢复内置 reviewer 注册项及其同步前语义：

- `mode: "subagent"`
- `native: true`
- 默认拒绝所有工具，只允许 `read`、`grep` 和 `glob`
- 使用现有 `reviewer.txt` prompt

配置只能覆盖模型、variant 等允许项，不能把 reviewer 的基础权限静默降级为普通 `mode: "all"` Agent。

#### Provider-native 生图

在 processor 的 tool result 完成路径重新接入现有的 `normalizeImageGenerationOutput` 和 `persistGeneratedImageAttachments`：

1. 归一化 hosted `image_generation` 的 base64/result 输出。
2. 持久化图片并生成可复用的 `relativePath`。
3. 将附件写入完成态 tool part。
4. 普通工具结果保持当前路径，不引入额外解析。

#### Release preflight

使用仓库现有同步脚本重新生成 JetBrains `description.html` 和 `changelog.html`。生成器是真源，不手工维护等价 HTML。

### 第二批：WebGUI 会话正确性

#### SSE 重连与 pending 请求水合

以每次 `server.connected` 为连接 epoch：

1. 初次连接和重连均拉取 session status、当前 session、最新消息、pending question 和 pending permission。
2. HTTP 快照与随后到达的 SSE 按稳定 ID 合并，SSE 新状态优先，避免重复或旧快照覆盖实时事件。
3. 重连失败保留现有 UI 数据并显示离线状态，不清空用户可见历史。
4. 成功水合后再解除 stale 状态。

不为 SSE 增加自定义 replay 协议；当前 server event stream 没有 durable cursor，显式重拉快照是最小可靠方案。

#### Retry

兼容 wrapper 继续复用当前 prompt endpoint，但必须：

- 为新 prompt 删除旧 `id`、`sessionID` 和 `messageID`，由服务端创建新 part ID。
- 保留原 user message 的 `agent`、`model`、`variant`、`format`、`system` 和 `tools`。
- 子任务错误使用 `part.sessionID`，不能回退到全局 `currentSession.id`。
- 任一请求返回 error tuple 时不修改本地成功状态。

#### Revert、redo 与 abort

`/session/{sessionID}/revert` 契约本身保持不变。修复其周边状态机：

- redo 拉取消息失败时保持原 revert boundary，禁止调用 unrevert。
- revert boundary 不在当前分页窗口时继续加载到 boundary，不能显示 boundary 之后的消息。
- revert/unrevert 改变同一 session 的可见历史后，重新计算 agent/model/variant selection。
- abort 返回 error tuple 或抛错时保持 busy 状态，并显示失败提示；只有服务端确认成功才能标记 idle。
- revert、redo、unrevert 的失败均显示明确错误，不再静默关闭确认状态。

回退集成测试只操作临时仓库，禁止对当前工作树执行真实 revert。

#### Session visibility

恢复前端当前调用的 `PUT /session/visibility`：

- request body 为去重后的 `sessionIDs`。
- 状态保持 process-local，并按当前 Instance/Workspace 隔离。
- 调度器读取同一份可见集合。
- instance dispose 或客户端状态更新时清理旧集合。
- 非法 Session ID 返回明确 400；成功响应返回实际保存的 ID 列表。

恢复接口后保留现有重试，但只对网络错误和 5xx 使用有上限的退避；4xx 不永久重试。

#### Diff 契约

WebGUI 改为消费当前 `SnapshotFileDiff { file, patch, status, additions, deletions }`：

- 文件面板使用 `status` 判断 added/modified/deleted。
- DiffModal 从 unified patch 派生展示数据；不再直接读取不存在的 `before/after`。
- 缺少 `file` 或 `patch` 的历史数据使用安全降级，不调用字符串 diff API 处理 `undefined`。

#### Fork 与默认模型

分叉采用已确认语义：新会话复制选中消息之前的历史，并把选中的用户提示词回填输入框供修改，不自动执行。

Provider 默认模型按服务端 `{ [providerID]: modelID }` 读取，不再假设 `default.provider/default.model`。

### 第三批：宿主更新可靠性

VSCode backend 提取路径按插件版本隔离：

```text
%TEMP%/opencode-bin/<plugin-version>/opencode.exe
```

- 同一插件版本可复用已提取文件。
- 不同版本永不因文件大小相同而复用。
- Windows 文件锁导致复制失败时，只能回退到当前版本的 bundled binary 或当前版本目录，不能启动旧版本目录中的 backend。
- 清理更早版本目录保持 best-effort，不阻塞启动。

## 错误处理

- 所有 SDK `{ error }` tuple 与 thrown error 统一视为失败。
- 失败不能推进 optimistic 状态：不能把 busy 标为 idle、不能扩大 revert boundary、不能删除 pending request。
- 可恢复网络错误显示现有数据和重试状态；契约错误停止重试并记录明确 endpoint/status。
- 水合与 SSE 竞态使用请求 epoch 和实体 ID 解决，不用任意延时。

## 测试

每项非平凡逻辑先添加一个能复现当前故障的最小测试，再实现修复。

### 第一批

- Agent service：reviewer 无配置和仅覆盖模型时仍为 native/read-only subagent。
- Processor：hosted image generation 产生持久化附件和 `relativePath`。
- `bun run release-content:check` 通过。

### 第二批

- MessagesContext：初次挂载和重连恢复 pending question/permission，SSE/HTTP 合并不重复。
- SessionContext：redo error 不 unrevert；长会话 boundary 不泄漏消息；revert 后 selection 重算。
- Retry：part ID 被移除，完整 prompt 选项被保留，子任务使用 child session ID。
- Abort：error tuple 不标 idle。
- Visibility HttpApi：更新、隔离、清理和 4xx 不重试。
- Diff：patch/status 正确分类和展示，缺字段不崩溃。
- Fork：选中提示词回填但不自动执行。

### 第三批

- ResourceExtractor：相同大小的不同版本 binary 不复用；文件锁 fallback 不跨版本。
- 构建 VSIX 后启动 bundled backend，确认 `/app` 返回当前 WebGUI 版本。

最终门禁：

- WebGUI 全量测试和生产构建。
- `packages/opencode` typecheck 与相关定向测试。
- SDK contract 测试。
- release content check。
- Windows VSIX 内容、backend 版本和 `/app` 实际服务检查。

按既有约束不运行 Java/Gradle。

## 风险与回退

- 重连水合会增加请求量：只在连接 epoch 变化时执行，并复用当前分页/请求去重机制。
- Diff patch 解析可能遇到历史异常数据：缺失或无法解析时显示 patch 原文，不崩溃。
- Visibility 是 process-local 状态：与当前本地 Session drain 边界一致；未来 clustering 需要独立设计，当前不预留分布式抽象。
- 版本化 backend 目录增加临时磁盘占用：旧目录 best-effort 清理，失败不影响当前版本。

每一批都应可独立验证和回退；不得用后一批修复掩盖前一批测试失败。
