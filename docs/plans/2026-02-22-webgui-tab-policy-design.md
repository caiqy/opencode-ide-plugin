# WebGUI Tab Policy Design (6-tab cap + virtual uniqueness + auto-scroll)

## Goal

在 webgui 的会话标签栏中新增统一策略：

1. 标签最小/最大宽度改为 `100px / 150px`
2. 新建会话仅允许一个 `virtual-*` 标签（重复新建时复用）
3. 同时最多打开 6 个标签（超出时自动关闭最旧非活动标签）
4. 每次打开或加载新标签时自动滚动到该标签
5. 不实现宿主窗口最小宽度 400px 限制（按最新确认）

## Scope

仅影响 `packages/opencode/webgui`：

- `state/tabStore.ts`
- `components/CompactHeader/index.tsx`
- `components/CompactHeader/TabBar.tsx`
- `components/CompactHeader/Tab.tsx`
- 新增 `state/tabPolicy.ts` 及测试

不改 `packages/app` 与宿主窗口宽度策略。

## Architecture

采用方案 C：新增纯函数策略层 `tabPolicy`，把标签业务规则从 UI 与持久化逻辑中剥离。

### 1) Policy layer (pure functions)

新增 `state/tabPolicy.ts`，输入旧状态输出新状态，不做 IO / DOM 操作。

核心常量：

- `MAX_OPEN_TABS = 6`

核心方法（拟定）：

- `openWithPolicy(state, incomingId)`
  - 已存在：仅激活，不改变顺序
  - 不存在：追加到末尾并激活
  - 若超上限：淘汰“最旧非活动标签”
- `openVirtualUnique(state, virtualId)`
  - 若已有 `virtual-*`：复用已有 virtual 并激活
  - 否则按 `openWithPolicy` 打开
- `findEvictionCandidate(state, incomingId)`
  - 从左到右找第一个 `id !== incomingId`（incoming 即新 active）
  - 若未找到，兜底移除最左侧

### 2) Store layer (state + persistence)

`tabStore.ts` 继续作为唯一可变状态和 KV 持久化层：

- API 形状保持兼容：`openTab/closeTab/removeTab/...`
- `openTab` 内改为调用 policy 产出 next state
- 仍沿用现有立即写 / 防抖写策略

### 3) UI layer

- `CompactHeader/index.tsx`
  - 新建会话入口调用 `openVirtualUnique` 路径（通过 store API 暴露）
  - 不在组件里重复写“最多 6 个/virtual 唯一”规则
- `TabBar.tsx`
  - 监听 `activeTab` 变化，将 active 对应 DOM 节点 `scrollIntoView`
- `Tab.tsx`
  - 宽度 class 从旧值调整为：`min-w-[100px] max-w-[150px]`

## Behavior Spec

### Open / Load tab

- 打开已存在标签：只切 active
- 打开新标签：追加右侧并切 active
- 打开后总数 > 6：自动移除最旧非活动标签

### New session virtual uniqueness

- 新建时若已存在 virtual 标签，复用并激活该标签
- 不新增第二个 virtual 标签

### Auto scroll

- 触发条件：`activeTab` 变更
- 行为：滚动使 active 标签进入可视区（平滑）

### Width

- 每个 tab 最小宽度 100px
- 每个 tab 最大宽度 150px

## Testing Strategy

### A. Policy unit tests (new)

文件：`state/tabPolicy.test.ts`

- open existing -> activate only
- open new under limit -> append + activate
- open 7th -> keep 6 + evict oldest non-active
- active 在左/中/右时都满足淘汰规则
- open virtual when one exists -> no new tab
- open first virtual -> append normally

### B. Store tests (update)

文件：`state/tabStore.test.ts`

- `openTab` 集成上限策略与淘汰策略
- virtual 唯一化行为
- KV 写入 payload 与时机不回归

### C. Component tests (update)

- `components/CompactHeader/Tab.test.tsx`
  - 断言宽度类名更新为 100/150
- `components/CompactHeader/TabBar.test.tsx`
  - mock `scrollIntoView`，验证 active 变化触发滚动

## Non-goals

- 不限制 VSCode Activity Bar / JetBrains ToolWindow 最小宽度
- 不改动 sessions API / 后端逻辑

## Risks & Mitigations

1. **规则分叉风险**：store 与 UI 各写一套规则
   - 缓解：规则只在 `tabPolicy`，UI 只调 API

2. **滚动抖动风险**：每次渲染都触发滚动
   - 缓解：仅在 `activeTab` 变化时触发

3. **回归风险**：close/reorder/replace 现有语义被破坏
   - 缓解：保留旧 API 与测试，增量覆盖新增规则

## Acceptance Criteria

- 打开第 7 个标签时，总数始终为 6，且淘汰最旧非活动标签
- 多次新建会话只保留 1 个 virtual 标签
- 打开/加载新标签后自动滚动到该标签
- 标签宽度按 100/150 生效
- 现有 close/reorder/replace 行为不回归
