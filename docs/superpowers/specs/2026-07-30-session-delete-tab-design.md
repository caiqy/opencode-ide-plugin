# 会话删除标签同步修复设计

## 问题

删除成功后，`SessionContext` 先移除会话，而 `CompactHeader` 依赖后续 effect 清理标签。这个间隙会让恢复逻辑切换到已删除的当前会话，或让非当前标签因失去会话标题而显示为“新建会话”。

## 行为

- 删除非当前会话时，立即移除对应标签，当前会话保持不变。
- 删除当前会话时，沿用 `tabStore.closeTab` 的规则选择相邻标签。
- 删除最后一个标签时，沿用现有 `onNewSession` 流程创建或复用空白会话。
- 删除失败时，不修改标签状态。
- 删除成功后，先前指向该会话的在途切换不得重新激活它。

## 实现

`CompactHeader` 传给 `useSessionActions` 的删除函数在 `deleteSession` 成功后立即调用 `tabStore.closeTab`。恢复 effect 在 `actions.isDeleting` 为真时暂停，避免批量删除期间切换到下一条待删除会话；删除结束后再按最终标签状态恢复。`SessionContext` 删除成功时使同 ID 的 pending switch token 失效，并依据实时 current-session ref 清除可能已返回的旧结果。不新增状态、事件或标签选择算法。

## 验证

新增回归测试，证明成功删除会立即关闭 backing tab、失败时保留标签、批量删除期间不会恢复待删除标签，并且删除后晚到的同 ID 切换响应会被丢弃。运行相关聚焦测试和 WebGUI typecheck。
