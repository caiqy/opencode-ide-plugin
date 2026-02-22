# CompactHeader 标签卡片化与紧凑宽度设计

## Goal

在不改变标签行为语义（激活/关闭/拖拽/排序）的前提下，提升多未激活标签的边界识别度，并让标签在数量增多时更紧凑。

本次目标包含：

1. 未激活标签关闭按钮默认可见
2. 标签间不加间距（gap=0），通过卡片化样式增强边界感
3. 宽度方案采用 C：保留弹性模型，仅将最小宽度从 `100` 下调到 `72`

## Scope

仅影响 `packages/opencode/webgui` 下 CompactHeader 相关展示层：

- `src/components/CompactHeader/Tab.tsx`
- `src/components/CompactHeader/TabBar.tsx`
- 对应测试文件（`Tab.test.tsx`、`TabBar.test.tsx`）

不改动：

- tab store 规则与持久化
- 会话切换逻辑
- 拖拽排序与关闭语义

## Design

### 1) Layout rules

- 保留现有弹性分配：`flex-[1_1_150px]`
- 最大宽度保持：`max-w-[180px]`
- 最小宽度调整：`min-w-[72px]`
- 标签之间保持零间距（不通过 `gap` 制造边界）

`Tab.tsx` 与 `TabBar.tsx` 的宽度约束必须同步为同一组值（`72/180/150`），避免父子约束冲突。

### 2) Close button visibility

- 未激活标签关闭按钮默认常显（低透明度，如 `opacity-60`）
- hover 或 active 提升到 `opacity-100`
- 继续保持 `relative z-20`，确保按钮始终可见可点

### 3) Card boundary styling（零间距卡片）

在不加间距的前提下，通过标签自身样式表达边界：

- 顶部圆角（如 `rounded-t-md`）
- 轻边框（未激活弱、激活强）
- 轻底色（区分 active 与 inactive）

边界感来自“边框/底色层次”，而不是标签之间的空隙。

### 4) Title overflow handling

沿用已确认策略：

- 标题不使用 `truncate`（不显示 `...`）
- 使用 `overflow-hidden whitespace-nowrap`
- 右侧 fade 渐隐层继续存在
- fade 使用 `pointer-events-none`，不得影响关闭按钮点击

## File Changes

1. `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
   - 宽度类改为 `min-w-[72px] max-w-[180px] flex-[1_1_150px]`
   - 关闭按钮未激活态改为常显低透明，hover/active 提升
   - 引入零间距卡片边界样式（圆角/边框/底色）
   - 保持标题 fade 不拦截点击

2. `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`
   - wrapper 宽度类同步为 `min-w-[72px] max-w-[180px] flex-[1_1_150px]`
   - 保持标签间零间距

3. `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`
   - 更新宽度断言（72/180/150）
   - 更新关闭按钮可见性断言（未激活常显）
   - 保留标题 fade 与按钮层级断言

4. `packages/opencode/webgui/src/components/CompactHeader/TabBar.test.tsx`
   - 更新 wrapper 宽度断言（72/180/150）

## Testing Plan

- 运行：`bun run test:run src/components/CompactHeader/Tab.test.tsx`
- 运行：`bun run test:run src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/index.integration.test.tsx`
- 运行：`bun run build`（在 `packages/opencode/webgui`）

手测清单：

1. 未激活标签关闭按钮始终可见且可点击
2. 多个未激活标签紧贴时边界清晰（卡片感）
3. 标签最小宽度变窄，短标题场景横向占用明显下降
4. 长标题无 `...`，右侧渐隐正常，关闭按钮不受影响

## Acceptance Criteria

1. `Tab.tsx` 与 `TabBar.tsx` 同步使用 `min-w-[72px] max-w-[180px] flex-[1_1_150px]`
2. 未激活标签关闭按钮默认可见，hover/active 提升为全显
3. 标签之间无 gap，边界感通过卡片样式体现
4. 标题继续无省略号 + 渐隐，且不影响按钮点击
5. 现有激活/关闭/拖拽行为无回归

## Risks and Mitigations

- 风险：最小宽度降低后，极短空间下文本可读性下降
  - 缓解：保留渐隐与按钮优先可点击，确保操作优先

- 风险：卡片边界过重导致视觉噪声
  - 缓解：边框与底色使用轻量强度，只强化层次不强化装饰

- 风险：fade 覆盖交互热区
  - 缓解：fade 保持 `pointer-events-none`，关闭按钮保持 `z-20`
