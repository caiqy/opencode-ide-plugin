---
title: 历史手动加载
description: 把顶部翻页入口改成显式交互
---

# 历史手动加载

## 理解背景

当前 WebGUI 历史分页仍主要依赖顶部 scroll 触发 `loadOlder(sessionID)`。相关分页状态继续由 `packages/opencode/webgui/src/state/MessagesContext.tsx` 持有，渲染入口位于 `packages/opencode/webgui/src/components/MessageList/index.tsx`。

当前顶部链路还把“接近顶部”“是否继续翻页”“prepend 后滚动恢复”几件事揉在 `hooks/useTopTrim.ts` 附近处理。这样虽然能在部分场景下工作，但交互意图并不清晰。

已讨论结果已经明确。用户偏好是手动加载更多，推荐方案也是在顶部提供固定且明确的“加载更早消息”条，作为主要触发入口。

---

## 界定问题

现有方案把历史翻页绑定到 scroll 事件，这会带来两个直接问题。其一，用户加载一页后若仍停留在顶部附近，但没有再次触发足够新的 scroll 事件，就不会自动继续下一页。

其二，失败状态被埋在滚动触发链路里，不容易稳定暴露给用户。用户既看不清“现在还能不能继续加载”，也不容易直觉理解“失败后该在哪里重试”，整体交互显得别扭。

问题本质不是阈值调得不够激进，而是翻页入口本身不够显式。顶部历史分页需要一个稳定、可见、可重试、可表达状态的 UI 面。

---

## 明确边界

### 目标

- 把顶部历史分页的主触发方式从 scroll 自动触发改为显式手动触发
- 明确写死 scroll 不再触发历史翻页，顶部显式加载条是继续向上翻页的唯一入口
- 保持 `MessagesContext` 继续负责 `loadOlder(sessionID)` 与分页状态，不改变后端协议
- 让 `MessageList` 负责顶部加载条 UI、点击触发和状态呈现
- 让顶部条清晰表达四类状态：可加载、正在加载、加载失败可重试、已加载全部消息
- 在 prepend 历史页后继续保持锚点恢复，尽量不让阅读位置乱跳
- 让 `useTopTrim` 收敛为滚动稳定与 trim 管理，而不是 scroll 自动翻页入口

### 非目标

- 不修改 `sdk.session.messages(limit, before)` 或任何服务端分页协议
- 不把方案扩展成完整双向 virtualization 或新的分页模型
- 不改变 SSE、`question`、`permission`、`typing` 和 `scroll-to-bottom` 的现有产品语义
- 不在本 spec 中展开实施排期、任务拆分或 git 提交流程

---

## 比较方案

### 纯手动

顶部固定展示“加载更早消息”条，只有用户点击后才调用 `loadOlder(sessionID)`。优点是入口最明确，失败和完成状态也最容易表达，缺点是用户需要多一次明确操作。

### 混合自动预取

界面保留顶部加载条，但用户接近顶部时仍在后台静默预取下一页，条仅用于兜底重试或补充说明。优点是理论上滚动更顺，缺点是交互语义重新变得含糊，也会把失败可见性再次藏回自动链路。

### 连续自动加载

继续把顶部 scroll 作为主入口，并在用户停留顶部附近时主动连拉多页。优点是最接近现状，缺点是会继续保留当前“不知道为什么没继续”“失败不可见”“触发链路难解释”的核心问题。

### 采纳结论

采纳纯手动。它最符合已确认的用户偏好，也最直接解决入口不明确、失败不可见和连续触发不稳定这三类问题。

采纳后需要同时废弃旧主路径：scroll 不再触发历史翻页，`useTopTrim` 也不再从 scroll 事件里调用 `loadOlder(sessionID)`。历史继续向上翻页只允许通过顶部显式加载条进入。

---

## 采用方案

新方案定义为“顶部显式手动加载更多”。`MessageList` 在历史区顶部固定渲染一个加载条，作为继续向上翻页的唯一入口。

加载条不只是按钮，它还是分页状态的统一展示位。用户滚到当前已挂载历史段顶部时，可以直接判断当前是还能加载、正在加载、加载失败需要重试，还是已经到达最早消息。

`MessagesContext` 不改变既有职责，仍负责页游标、去重、`complete` 判定和 `loadOlder(sessionID)` 请求。渲染层只消费这些状态并发起显式调用，不重写分页协议。

---

## 设计架构

整体职责继续分三层。分页数据层是 `MessagesContext`，顶部交互层是 `MessageList`，滚动稳定层是 `useTopTrim`。

`MessagesContext.tsx` 继续维护每个 session 的已加载消息、`cursor`、`complete`、并发去重和请求落地时序。若需要补足失败态表达，只在现有分页状态模型上增加或暴露更明确的 `error` / `loading` 读取口径，而不是改协议。

`MessageList/index.tsx` 新增顶部加载条渲染逻辑。它根据 session 当前分页状态计算加载条文案、可点状态和点击后的行为，并在用户点击时调用 `loadOlder(sessionID)`。

`useTopTrim.ts` 不再承担“接近顶部就自动触发 `loadOlder`”的主职责。它需要明确暴露或承接一个 `prepare/capture for prepend` 能力，并继续在消息 prepend 后处理锚点恢复、trim 窗口推进和高度变化补偿。

调用关系固定为三步。第一步，用户点击顶部条后，由 `MessageList` 调用 `useTopTrim` 的 `prepare/capture for prepend`。第二步，`MessageList` 再调用 `loadOlder(sessionID)`。第三步，消息更新并 prepend 落地后，由 `useTopTrim` 在更新阶段恢复锚点。

---

## 描述数据流

### 生成状态

`MessagesContext` 继续在 session 维度维护消息页与分页元数据。`MessageList` 读取当前 session 的消息列表，以及 `loading`、`complete`、失败信息和 `loadOlder(sessionID)`。

顶部加载条根据这些状态派生展示模型。若 latest page 尚未 ready，则顶部条隐藏，不抢主加载面或主错误面。

### 触发翻页

用户点击顶部“加载更早消息”条后，`MessageList` 先调用 `useTopTrim` 暴露的 `prepare/capture for prepend`，记录当前视口锚点。随后 `MessageList` 调用 `loadOlder(sessionID)`，由 `MessagesContext` 发起请求并在成功后 prepend 更早历史。

prepend 完成后，`useTopTrim` 在消息更新时恢复原锚点，让用户继续停留在原阅读位置附近。验收口径应是 prepend 后当前阅读块保持在原视口邻近位置，而不是被插入内容推离一个可感知的大位移。

### 刷新展示

点击重试后，顶部条应立即清除局部 error 并进入 loading。loading 期间禁用重复点击。

loading 完成后，顶部条按固定规则落状态。推荐口径写死为 `complete > error > 可加载`，也就是先看是否已全部完成，再看是否失败，否则进入可继续加载状态。

请求失败时，不清空当前已显示内容。顶部条切换为“加载失败，点击重试”，并继续把失败处理约束在历史翻页这一局部交互里。

---

## 处理失败与状态

顶部条必须覆盖四种明确状态。第一种是可加载，显示“加载更早消息”，允许点击。

第二种是正在加载，显示 loading 文案并禁用重复点击。第三种是加载失败，显示失败提示并保留重试入口。

第四种是已加载全部消息，显示终态文案并停止触发 `loadOlder(sessionID)`。这个终态需要可见，避免用户误以为还可以继续翻页。

失败态应依赖 `MessagesContext` 的分页错误口径，而不是在 `MessageList` 内部私自猜测。若当前 `MessagesContext` 只记录布尔型 `error`，第一版可先按布尔态展示通用失败文案，不要求引入新的后端返回结构。

状态切换规则需要明确。latest page 未 ready 时顶部条隐藏；用户点击加载或点击重试后立即进入 loading，并清除局部 error；loading 完成后按 `complete > error > 可加载` 落状态；loading 中始终禁止重复点击。

---

## 处理滚动稳定

手动触发并不意味着可以放弃 prepend 补偿。相反，因为入口更显式，用户会更关注点击前后阅读位置是否稳定。

在点击加载前，`MessageList` 必须先调用 `useTopTrim` 的 prepend 准备能力来记录当前视口顶部附近的稳定锚点。历史页 prepend 到 DOM 后，`useTopTrim` 再按该锚点恢复同一阅读块的位置，而不是依赖用户再次滚动来“自然对齐”。

trim 逻辑仍可继续存在，但它服务的是 DOM 裁剪与滚动稳态。它不再负责判定“是不是该自动继续下一页”，也不再从 scroll 事件里调用 `loadOlder(sessionID)`。

若高度测量仍在收敛，补偿规则也应保持与现有滚动稳态设计一致。只有 anchor 之前的高度变化参与当前视口补偿，避免 prepend 后再出现多次小幅跳动。

---

## 处理边界

当 session 尚未完成最近页初始化时，顶部条不应抢占主错误面。它只在会话进入可用状态后，承担旧历史继续翻页的入口职责。

当用户切换 session 时，顶部条应立即切换到对应 session 的分页状态。不同 session 的 loading、error 和 complete 不能串写。

当历史区已经被 trim 时，顶部条仍应稳定位于当前已挂载历史段的最上方。具体挂载约束写死为：顶部条必须位于 history trim spacer 之后、history rows 之前。

顶部条自身不能被 trim 裁掉。它不是 sentinel 的附属物，也不是可被卸载的历史 row。

若同一 session 已存在进行中的 `loadOlder(sessionID)`，重复点击只消费现有 pending 请求，不再并发发起新请求。这个约束继续由 `MessagesContext` 的去重语义保证。

若当前没有更多历史，顶部条应进入已完成终态，而不是直接消失。保留终态能减少用户困惑，也方便确认当前确实已经到达最早消息。

---

## 设定验收

### 功能验收

- 顶部历史分页主入口已从 scroll 自动触发改为显式手动点击
- scroll 不再触发历史翻页，顶部显式加载条是继续向上翻页的唯一入口
- `MessageList` 顶部存在固定且明确的“加载更早消息”条
- 顶部条可正确表达可加载、正在加载、加载失败可重试、已加载全部消息四类状态
- latest page 未 ready 时顶部条隐藏，不抢主加载面或主错误面
- 用户点击顶部条后会调用 `loadOlder(sessionID)`，成功时 prepend 更早历史
- 点击重试后会立即清除局部 error 并进入 loading，loading 时不可重复点击
- 历史 prepend 后原阅读块保持在原视口邻近位置，不出现可感知的大位移
- 历史页失败时，当前已显示内容保持不变，用户可在顶部条直接重试

### 技术验收

- `MessagesContext` 继续负责 `loadOlder(sessionID)` 与分页状态，不改变后端协议
- `MessageList` 负责顶部加载条 UI 与点击触发，不把该职责下沉回 scroll 监听
- `useTopTrim` 不再承担 scroll 自动触发 `loadOlder` 的主职责，也不再从 scroll 事件里调用 `loadOlder(sessionID)`
- `MessageList -> useTopTrim.prepare/capture for prepend -> loadOlder(sessionID) -> useTopTrim restore` 的调用链路已明确
- 顶部条挂载在 history trim spacer 之后、history rows 之前，且自身不参与 trim
- prepend 后的滚动恢复继续基于锚点补偿或等价稳定机制，而不是放任位置漂移
- 同会话历史翻页继续沿用现有请求去重与过期响应保护语义

---

## 控制风险

最大风险是顶部条虽然变成显式入口，但实际仍受 trim 或布局边界影响而偶发不可见。缓解方式是把它定义为历史区顶部的稳定结构，而不是临时插入的 sentinel 附属物。

第二类风险是分页状态来源分散，导致顶部条文案和真实请求状态不同步。缓解方式是让展示状态直接收敛到 `MessagesContext` 的 session 分页元数据，不在 `MessageList` 额外复制一套状态机。

第三类风险是手动加载后锚点恢复不稳，导致用户觉得“点一下内容乱跳”。缓解方式是明确保留现有 prepend 补偿链路，并把 `useTopTrim` 的职责收缩到滚动稳定，而不是继续承担自动翻页决策。
