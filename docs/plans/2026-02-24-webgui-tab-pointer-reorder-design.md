# WebGUI 标签栏拖拽换序设计（Pointer-based）

## 背景

当前 `webgui` 标签栏在 VSCode webview 中可触发拖拽动画，但鼠标释放后未稳定触发顺序变更。现有实现基于 HTML5 DnD（`dragstart/dragover/drop` + `dataTransfer`），同时项目中存在 document 级 DnD 处理用于文件拖入，二者在 webview 场景下存在事件竞争风险。

## 目标

1. 修复标签拖拽后“松手不换序”问题
2. 保证“松手即换序”
3. 保证换序结果持久化（刷新/重开后顺序保持）
4. 不影响现有文件拖入消息框能力

## 范围

仅改动 `packages/opencode/webgui`：

- `src/components/CompactHeader/TabBar.tsx`
- `src/components/CompactHeader/Tab.tsx`
- 对应测试文件（`TabBar.test.tsx`、必要时 `Tab.test.tsx`）

不改：

- `packages/app`
- 会话切换/创建业务规则
- 文件拖入主流程（document 级 drop 用于外部文件）

## 备选方案与取舍

### 方案 B：收敛全局 DnD（统一 document 级监听）

**思路**：保留 HTML5 DnD，但调整全局监听策略，仅拦截外部文件拖入，减少对 tab drop 的影响。

**优点**：改动相对可控，保留现有交互模型。

**缺点**：仍依赖 HTML5 DnD，在 webview/宿主转发链路下兼容性不稳定，可能不能彻底消除 drop 丢失。

### 方案 C（选用）：Pointer-based 标签重排

**思路**：标签重排改为 `pointerdown/move/up`，不依赖 `dataTransfer/drop`。

**优点**：

- 在 webview 场景兼容性更高
- 与 document 级文件 drop 解耦，降低事件竞争
- 能稳定实现“松手即换序”

**缺点**：实现复杂度高于 B，需要补充手势阈值、取消路径和边界处理。

## 架构设计

### 1) 事件模型（TabBar 局部）

- `pointerdown`：记录起点与源索引（`from`）
- `pointermove`：超过阈值后进入 dragging，实时计算目标索引（`to`）与插入视觉提示
- `pointerup`：若 `from !== to`，调用 `onReorder(from, to)`
- `pointercancel` / `lostpointercapture`：取消拖拽，不提交换序

采用 pointer capture，保证拖拽过程中指针事件持续回流到标签栏逻辑。

### 2) 状态边界

- 拖拽临时态仅存在 `TabBar` 本地状态（不入全局 store）
- 顺序真源仍是 `tabStore.openTabs`
- 顺序写入口仍是 `tabStore.reorderTabs(from, to)`

### 3) 持久化

沿用 `tabStore.reorderTabs` 现有 500ms debounce 持久化（`sdk.kv.update`），满足刷新/重开后顺序保持。

## 组件改动设计

## `TabBar.tsx`（主改）

- 新增 pointer 拖拽状态（如 `dragging`, `from`, `to`, `pointerId`, `startX/startY`）
- 替换现有 `onDragOver/onDrop` 路径为 pointer 计算路径
- 保留或复用现有插入线视觉（left/right）
- 在提交后与取消时统一清理临时状态

## `Tab.tsx`（轻改）

- 移除或降级 HTML5 DnD 事件绑定（`draggable`, `onDrag*`）
- 暴露 pointer 事件回调给父层（或由父层容器接管）
- 保持点击激活、双击重命名、中键关闭等已有行为

## 错误处理与边界条件

1. `openTabs.length < 2`：直接禁用重排
2. 未超过拖拽阈值：按点击处理，不触发 reorder
3. `from/to` 越界：忽略提交
4. 编辑态（重命名输入框）禁用拖拽起始
5. `pointercancel` / `lostpointercapture` / 失焦：统一 cancel，不脏写

## 测试策略

### 单测：`TabBar.test.tsx`

1. pointer 拖拽超过阈值并 `pointerup` 后触发 `onReorder(from, to)`
2. 未超过阈值不触发 reorder
3. 取消路径（`pointercancel` 等）不触发 reorder
4. 编辑态不触发拖拽提交

### Store 回归：`tabStore.test.ts`

- 复用现有 `reorderTabs` 与 debounce 持久化测试，确保持久化不回归。

### 集成回归

- 验证文件拖入消息框路径未受影响（手测 + 相关测试保持通过）

## 验收标准

1. VSCode webview 下：拖拽标签后松手立即换序
2. 刷新或重开后顺序保持
3. 不影响点击切换、重命名、关闭、文件拖入

## 非目标

- 不同步改造 `packages/app` 标签系统
- 不在本次引入复杂拖拽预览 ghost 组件
- 不改现有 tab policy（6 标签上限/virtual 唯一）逻辑
