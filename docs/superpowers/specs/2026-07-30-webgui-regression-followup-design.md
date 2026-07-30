# WebGUI 大合并回归补漏设计

## 背景

上游大同步 `53ecc6ef0b` 后的第一轮恢复已修复配置 cache、单文件配置替换、会话重连、visibility、Diff 和模型选择等主要路径。复审确认仍有六个边界未满足恢复设计，而现有 WebGUI `1397/1397` 测试未覆盖这些组合时序。

## 目标

- 删除会话后不保留或恢复该会话的 pending question/permission。
- abort 失败时不提前破坏 pending question。
- 首次 `server.connected` 能恢复已经耗尽重试预算的 visibility 同步。
- 无本地模型选择时使用有效的服务端 provider default。
- 长会话持续扫描到 selection/revert boundary 或历史末尾。
- 文件变化按 `added`、`modified`、`deleted` 分别展示。

## 非目标

- 不处理 project `PATCH /config` 写入 `config.json` 的历史问题。
- 不定义多个 global 配置文件下的有效配置替换语义。
- 不重构 Session、Messages 或配置状态架构。

## 设计

### Pending 生命周期

`session.deleted` 按 session ID 清理本地 permission 和 question。当前连接 epoch 的 pending hydration 同时记录已删除 session ID，并在合并 HTTP 快照前过滤这些实体，防止删除期间发起的旧请求复活 pending 状态。

abort 先请求 `sdk.session.abort`。只有服务端确认成功后，才拒绝或清理该会话的 pending question 并标记 idle；error tuple 或异常只显示错误，保留 pending 状态。

### Visibility 连接 epoch

每次 `server.connected` 都递增 epoch、清空 synced/blocked/attempts 和旧 retry timer，再同步最新可见 session 集合。首次连接与后续重连使用同一规则，不保留特殊首连分支。

### 默认模型

保持现有优先级：workspace selection、agent selection、recent、`config.model`、provider default、首个可用模型。provider default 按 provider 列表顺序选择第一个仍存在的 `{ providerID: modelID }` 映射；无效映射继续降级，不写入额外配置。

### 长历史 selection

移除十页硬上限。扫描由以下条件终止：找到 selection、cursor 为空、cursor 重复、请求失败、激活 token 失效或 AbortSignal 取消。请求失败继续使用现有提示；正常到达历史末尾且未找到 selection 时沿用当前配置。

### Diff 分类

`FileChangesPanel` 将 diff 分为 `added`、`modified`、`deleted` 三组，分别统计和渲染。总 additions/deletions/net 继续基于全部 diff 计算；不改变文件打开行为或 DiffModal patch 解析。

## 测试

每项先添加一个最小失败测试：

1. hydration 期间删除 session 后，旧 question/permission 快照不能恢复。
2. abort error tuple 时不调用 question reject，且不标记 idle。
3. 初始同步三次失败后，第一次 `server.connected` 会重新同步。
4. provider 首项模型与 default 不同时选择 default；无效 default 降级。
5. selection 位于第十一页以后时仍能恢复，并保留重复 cursor 防护。
6. `added` 文件有独立计数和展示，不计入 modified。

完成后运行 WebGUI 全量 Vitest、生产构建和相关 typecheck。第一批不改 backend Protocol、HttpApi 或 generated SDK。

## 后续批次

配置文件问题单独设计。实施前先决定 global replace 是否允许合并、迁移或删除低优先级物理配置文件，以免静默丢失 JSONC 注释或用户手工配置。
