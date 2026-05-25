# webgui New Session 复用修复设计

## 背景

webgui 的 `New session` 入口当前通过 `draft_session` 指针复用空会话：如果指针存在、session 存在且 messages 为空，则打开并切换到该 session；否则创建新的 session。浏览器直开 webgui 时，每次刷新都会产生新的 `New session`。IDE 内也偶尔会出现没有复用历史空 `New session`，导致多个默认 `New session - <ISO time>` 留在历史中。

调研定位到四类问题：

1. 无 `ideBridge` 时，`scopedStorage` 只使用模块内存 Map，刷新后丢失 `tabs`、`draft_session`、`drafts`、selection 等状态。
2. `tabStore.persist()` 通过 `saveOpenTabs()` 再 `activateTab()` 分两次写入，刷新或 webview 重载可能留下 `open_tabs` 有值但 `active_tab` 为空的半状态。
3. `prepareSession()` 把复用检查失败统一当作不可复用，临时 API/网络失败也会清空 `draft_session`。
4. `draft_session` 指针丢失后，没有扫描历史空默认会话的兜底逻辑。

## 目标

- 浏览器直开 webgui 时，刷新后能复用已有空 `New session`，不再每次刷新创建新 session。
- IDE 内消除 tabs 半写入、activeTab 为空、临时校验失败导致的偶发不复用。
- 如果 `draft_session` 指针丢失，仍可复用最近的空默认 `New session`。
- 保持 IDE 宿主 storage 行为不变。
- 避免启动时大量扫描历史 sessions。

## 非目标

- 不改变 session 创建 API 或服务器 session schema。
- 不改变用户发送第一条消息后的 draft 清理语义。
- 不迁移旧 localStorage key；当前 webgui scoped state 已统一通过 `scopedStorage` 访问。
- 不引入 IndexedDB 或复杂离线同步。

## 设计

### 1. scopedStorage 浏览器持久化 fallback

`scopedStorage` 对外接口保持不变：

- `scopedStateGet(scope, keys)`
- `scopedStateSet(scope, key, value)`
- `scopedStateGetJSON(scope, key, fallback)`
- `scopedStateSetJSON(scope, key, value)`

内部行为调整：

- `ideBridge.isInstalled()` 为 true 时，继续优先读写宿主侧 `storageGet/storageSet`。
- `ideBridge.isInstalled()` 为 false 时：
  - `global` 和 `workspace` scope 读写浏览器 `localStorage`。
  - `mem` scope 只读写内存 Map，不持久化。
- 浏览器 fallback 使用包装 key，避免 scope 冲突：

```ts
opencode:webgui:scoped:${scope}:${key}
```

- `localStorage` 读取失败或不可用时返回内存 Map 中的值。
- `localStorage` 写失败时仍写入内存 Map，并通过现有 `warn()` / reporter 提示 `host_write_failed`，提示文案沿用“设置未保存，本次会话可继续使用”。

这样浏览器刷新后能恢复 tabs、draft session、drafts、selection 等已有 scoped state。

### 2. tabs 原子持久化与恢复兜底

当前 `tabStore.persist()` 先保存 open tabs，再补写 active tab。设计改为一次性保存完整状态：

```ts
saveTabs({ open_tabs: next.openTabs, active_tab: next.activeTab })
```

`saveOpenTabs()` 可保留给其他潜在调用，但 `tabStore.persist()` 不再使用它完成 tabs 状态写入。

`CompactHeader` 初始化恢复时增加兜底：

- 如果 `tabStore.openTabs.length > 0` 且 `tabStore.activeTab` 非空：保持现有逻辑，切换到 active tab。
- 如果 `tabStore.openTabs.length > 0` 但 `tabStore.activeTab` 为空：
  - 优先取 `openTabs[openTabs.length - 1]` 作为恢复目标。
  - 调用同一套 `switchWithRollback(target)`。
  - 成功后通过 `tabStore.activateTab(target)` 修复持久化状态。
  - 失败时不立即清空 tabs；交给已有 rollback / prune 逻辑处理，最终再进入 new session 兜底。
- 只有 `openTabs` 为空且 `currentSession` 也为空时才触发 `onNewSession()`。

### 3. draft session 三态校验

把 `prepareSession()` 的复用判断从 boolean 扩展为三态：

```ts
type ReuseCheck = "reusable" | "not_reusable" | "unknown"
```

语义：

- `reusable`：session 存在且 messages 为空，可以复用。
- `not_reusable`：session 明确不存在、已删除、或 messages 非空，不可复用，可以清理 draft 指针。
- `unknown`：请求失败、网络错误、API 临时不可用，不能确认，不清理 draft 指针。

`handleNewSession()` 中的 draft 检查规则：

- `sdk.session.get()` 明确无数据或返回 404 类错误：`not_reusable`。
- `sdk.session.messages()` 成功且长度为 0：`reusable`。
- `sdk.session.messages()` 成功且长度大于 0：`not_reusable`。
- 任一请求发生未知错误或非明确 not-found 错误：`unknown`。

`prepareSession()` 行为：

- draft 为 `reusable`：打开 tab，切换 session，成功后直接返回。
- draft 为 `not_reusable`：清空 `draft_session`，继续后续兜底。
- draft 为 `unknown`：保留 `draft_session`，继续后续兜底，不因临时失败破坏指针。

### 4. 空默认 New session 兜底扫描

当 draft 缺失、不可复用或状态 unknown 且未成功恢复时，尝试复用最近的空默认 `New session`。

候选条件：

- session 未 archived。
- session 没有 `parentID`。
- title 匹配默认标题 `New session - <ISO time>`。
- session 不是 subagent session。
- messages 为空。

扫描输入优先使用当前 `sessions` 列表；如果当前列表为空或不足，可额外调用一次 `sdk.session.list({ limit: SESSION_LIST_LIMIT, roots: true })` 获取最近 root sessions。

扫描顺序按更新时间/创建时间从新到旧。对每个候选调用 `sdk.session.messages()` 确认为空：

- 找到空候选：打开 tab，切换 session，保存为 `draft_session`，返回。
- 候选 messages 非空：跳过。
- 候选 messages 请求失败：跳过，不删除任何状态。
- 没有候选：创建新 session。

为避免启动放大请求量，扫描最多检查最近一页候选。初始实现不跨多页递归加载。

### 5. New session 创建优先级

最终 `handleNewSession()` 流程：

1. 读取 `draft_session`。
2. 如果 draft 存在：
   - 可复用则打开并切换，结束。
   - 明确不可复用则清理 draft 指针。
   - unknown 则保留 draft 指针，继续兜底。
3. 扫描最近空默认 `New session`：
   - 找到则打开并切换，保存为 `draft_session`，结束。
4. 创建新 session：
   - 成功后打开 tab，保存为 `draft_session`。
   - 失败则显示“创建会话失败”。

`creating.current` 继续保留，防止一次 UI 生命周期内重复创建。

## 错误处理

- 浏览器 `localStorage` 不可用时降级为内存，不阻断 UI。
- host storage 写失败保留现有节流提示机制。
- draft 校验 unknown 不清理指针，避免临时失败造成长期状态损坏。
- 空默认 session 扫描中单个候选请求失败只跳过该候选，不中断整体流程。
- 切换候选 session 失败时继续尝试后续候选；全部失败后再创建新 session。

## 测试计划

### scopedStorage

- 无 `ideBridge` 时，`global/workspace` 写入后可从 `localStorage` 读回。
- 无 `ideBridge` 时，`mem` 不写入 `localStorage`。
- `localStorage` 抛错时，写入内存 Map 并触发 reporter。
- 有 `ideBridge` 时仍优先使用 host storage。

### tabsRepo / tabStore / CompactHeader

- `tabStore.persist()` 原子保存 `{ open_tabs, active_tab }`。
- `activeTab` 为空但 `openTabs` 非空时，恢复最后一个 tab，不调用 `onNewSession()`。
- 恢复成功后调用 `activateTab()` 修复 active tab。
- `openTabs` 为空且 `currentSession` 为空时仍调用 `onNewSession()`。

### prepareSession / App

- draft session 可复用时不会创建新 session。
- draft session 明确不可复用时清理指针并继续兜底。
- draft session 校验 unknown 时不清理指针。
- draft 缺失时能复用最近空默认 `New session`。
- 默认标题但已有 messages 的 session 不被复用。
- 空默认候选 messages 请求失败时跳过候选。
- 没有可复用候选时才创建新 session。

## 风险与缓解

- **风险：浏览器 localStorage 跨不同项目 origin 共享。** 当前 key 包含 scope 但不包含目录；如果同一 origin 服务多个项目，workspace 状态可能串用。缓解：本设计保留现有 scoped key，不引入项目 ID；若发现串用，再将 workspace fallback key 纳入 server 暴露的 project/worktree 标识。
- **风险：兜底扫描增加启动请求。** 限制只扫描最近一页，且只对默认标题候选请求 messages。
- **风险：复用过旧空 session。** 扫描按最新时间排序，只复用最近空默认 session。
- **风险：三态改造影响现有 prepareSession 测试。** 通过兼容性测试覆盖原有可复用与不可复用路径。

## 验收标准

- 浏览器打开 webgui，点击/自动创建一个空 `New session` 后刷新页面，不再创建第二个空 `New session`。
- 浏览器关闭并重新打开同一 webgui 地址，仍能恢复 tabs 与空 draft session。
- IDE webview 重载后，如果 tabs 有 open tab 但 active tab 为空，不会直接创建新 session。
- 临时 session/messages 请求失败不会清空已有 `draft_session`。
- 当 `draft_session` 丢失但历史中存在最近空默认 `New session` 时，点击 New Session 复用该会话。
