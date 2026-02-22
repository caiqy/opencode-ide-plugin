# CompactHeader Tab 宽度与标题渐隐设计

## Goal

在不改变现有标签交互语义的前提下，完成两项 UI 调整：

1. 标签最大宽度从 `150px` 调整到 `180px`。
2. 标签标题超长时不显示省略号，改为右侧渐隐提示，且不影响关闭按钮点击。

## Scope

仅影响 `packages/opencode/webgui` 下的 CompactHeader 标签展示层：

- `src/components/CompactHeader/Tab.tsx`
- `src/components/CompactHeader/TabBar.tsx`
- 对应测试文件（主要是 `Tab.test.tsx`，必要时补充 `TabBar` 断言）

不改动：

- tab store 规则（打开、关闭、排序、持久化）
- session 切换逻辑
- 关闭按钮行为语义

## Design

### Layout rules

- 保持 `min-w-[100px]` 不变。
- 保持动态基准 `flex-[1_1_150px]` 不变。
- 将最大宽度统一调整为 `max-w-[180px]`。

为避免父子约束冲突，`Tab.tsx` 与 `TabBar.tsx` 的宽度上限必须同步更新到 `180px`。

### Overflow title behavior

- 标题移除 `truncate`，不显示 `...`。
- 改为单行裁切：`overflow-hidden whitespace-nowrap`。
- 在标题区域右侧增加 fade 渐隐层，作为“还有内容”的视觉提示。

渐隐层仅用于视觉，不参与交互；覆盖区域仅限标题尾部，不延伸到关闭按钮区域。

### Clickability and layering

- 渐隐层设置 `pointer-events-none`，不拦截点击。
- 关闭按钮继续保留 `relative z-20`，保证在边缘/遮罩存在时仍可见、可点。
- 标题容器维持 `min-w-0 flex-1`，关闭按钮维持 `flex-shrink-0`，确保布局分区稳定。

## File Changes

1. `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
   - `max-w-[150px]` -> `max-w-[180px]`
   - 标题样式从 `truncate` 改为无省略号裁切 + fade 辅助
   - 确保 fade 层不影响 close 按钮点击

2. `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`
   - 外层 tab wrapper 的 `max-w-[150px]` -> `max-w-[180px]`

3. `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`
   - 更新宽度 class 断言（100 / 180 / 150 basis）
   - 更新标题溢出样式断言（无 `truncate`，有 `overflow-hidden`、`whitespace-nowrap`）
   - 保留 close 按钮层级断言（`z-20`）

## Testing Plan

- 单测：运行 `Tab.test.tsx`，确认 class 与行为断言通过。
- 手测：
  - 长标题场景下无省略号，右侧有渐隐。
  - active tab 的关闭按钮始终可见可点。
  - 多标签场景下动态宽度上限生效为 `180px`。
- 回归：拖拽、激活、关闭操作不受影响。

## Acceptance Criteria

1. `Tab.tsx` 与 `TabBar.tsx` 的最大宽度均为 `180px`。
2. 最小宽度仍为 `100px`，`flex-[1_1_150px]` 保持不变。
3. 长标题不显示 `...`，改为尾部渐隐提示。
4. 渐隐层不影响关闭按钮点击；关闭按钮保持 `z-20`。
5. 现有 tab 核心交互无回归。

## Risks and Mitigations

- 风险：渐隐层误覆盖按钮热区。
  - 缓解：渐隐层限制在标题区内，并使用 `pointer-events-none`。

- 风险：仅改单层 `max-w` 导致父子宽度冲突。
  - 缓解：`Tab.tsx` 与 `TabBar.tsx` 同步改动并测试。

- 风险：极窄宽度下文本与按钮视觉拥挤。
  - 缓解：保持 `min-w-[100px]` 与按钮固定区布局，保障操作优先。
