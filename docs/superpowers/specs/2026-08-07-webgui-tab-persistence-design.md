# WebGUI 标签持久化一致性设计

## 背景

WebGUI 将打开标签保存到 workspace scoped storage。当前标签操作会并发发起异步写入，`activateTab` 还会先从宿主持久化存储读取旧快照再写回。较早的请求如果较晚完成，会覆盖关闭或新增标签后的新快照，造成连续重启后标签集合收缩，以及已关闭的空白 `New session` 再次出现。

## 目标

- 同一个 scoped storage key 的写入按调用顺序落盘。
- 存在待写入或失败后的本地新值时，读取必须返回本地新值，不得用宿主旧值覆盖。
- 标签状态始终以完整 `{ open_tabs, active_tab }` 快照保存。
- WebGUI 主动请求重启宿主前，等待已排队的状态写入完成。
- 关闭尚未对话的 `New session` 只移除其打开标签，不删除服务端 session；以后显式点击 New session 仍可复用该空会话。

## 非目标

- 不新增宿主协议版本、CAS 或跨 WebGUI 实例的分布式冲突处理。
- 不改变会话创建、删除、历史列表或最多六个标签的现有策略。
- 不清理已关闭空会话的服务端记录或草稿复用指针。

## 设计

### Scoped storage

`scopedStorage` 为每个 `scope + key` 维护独立写入链。`scopedStateSet` 仍同步更新内存 cache，然后把宿主写入追加到对应链；前一写入无论成功或失败，后一写入都继续执行。不同 key 互不阻塞。

待写入期间，该 key 视为本地权威。`scopedStateGet` 可以请求宿主值，但不得用宿主旧值覆盖 cache，也必须向调用者返回 cache。只有最新排队写入成功后才能清除本地 dirty/pending 状态；失败时保留 cache 并沿用现有告警行为。

导出 flush 操作，等待当前所有 scoped storage 写入链稳定。队列排空后任一 scope 仍有 dirty key 时，flush 必须失败。flush 不发起新写入，也不吞掉调用开始之后追加到既有链的写入。

### 标签状态

`tabStore` 的内存状态是标签集合的唯一组装位置。打开、关闭、激活、替换、重排和修剪均把完整快照交给 `saveTabs`。激活已有标签不再调用 repository 的 read-modify-write 入口，避免从宿主旧状态重新组装标签集合。

repository 保留数据解析与完整快照读写职责；不再由 React store 使用只更新 active tab 的入口。

### 重启

WebGUI 菜单触发插件或 IDE 重启时，先 flush scoped storage，再发送 `restartHost`。队列排空后仍有 dirty key 导致 flush 失败时，不发送 `restartHost`，并沿用现有失败 toast；正常重启路径则保证已确认的标签写入先于重启请求到达宿主。

外部 IDE 强制重载无法等待页面异步工作，不在本次保证范围内。

## 错误处理

- 单次宿主写入失败不会阻断同 key 后续写入。
- 失败值继续保留在 cache，并按现有节流规则提示“设置未保存”。
- flush 等待队列稳定；队列排空后任一 dirty key 仍存在时抛出明确错误。具体单次写入失败继续由 `scopedStateSet` 的结果和现有报告器表达。

## 测试

- `scopedStorage`：延迟第一个写入，证明同 key 第二个写入不会越过它；验证待写期间读取本地新值；验证失败后后续写入仍执行且最终新值可读。
- `tabStore`：激活已有标签保存完整快照且不再调用 read-modify-write；模拟激活相邻标签后关闭当前空白标签，最终写入不含已关闭标签。
- `CompactHeader`：主动重启先等待 flush，再调用 `restartHost`；flush 完成前或因 dirty key 失败时不得重启，并显示现有失败 toast。
- 运行 WebGUI focused tests 和 package typecheck。

## 验收标准

1. 多个标签连续重启两次后仍恢复同一标签集合和 active tab。
2. 有其他打开标签时，关闭未对话的 `New session`，重启后该标签不再出现。
3. 显式点击 New session 仍可复用保留的服务端空会话。
4. 写入失败不会卡死该 key 的后续持久化。
5. 队列排空后仍有 dirty key 时 flush 失败；该 key 后续成功写入后 flush 恢复成功。
6. scoped storage 未保存状态存在时，主动重启不发送 `restartHost` 并显示现有失败 toast。
