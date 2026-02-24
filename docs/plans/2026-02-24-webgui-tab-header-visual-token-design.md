# WebGUI CompactHeader 标签视觉 Token 化设计

## 背景

当前 `webgui` 的 `CompactHeader` 有两个可见问题：

1. 未激活标签标题字体偏暗，识别性不够。
2. 标签栏右侧连接状态图标与标签区域之间缺少留白，视觉上偏挤。

同时，相关样式目前分散在组件内硬编码 class，不利于后续统一微调。

## 目标

1. 未激活标签标题在 light/dark 主题下都提亮一档（中等强度）。
2. 标签区与右侧连接状态区增加稳定间距（约 8px）。
3. 将本次视觉规则抽成 `CompactHeader` 范围内语义 token，减少硬编码。

## 范围与非目标

### 范围

- 仅 `packages/opencode/webgui/src/components/CompactHeader/*`
- 仅视觉层改动（颜色/间距/样式组织）

### 非目标

- 不改会话切换、关闭、重命名、拖拽等交互逻辑
- 不扩展到其它页面或全局设计系统
- 不调整 active 标签样式基线

## 方案选择

在 3 个备选中最终选择方案 C：**CompactHeader 视觉 token 化**。

- A（局部 class 微调）：最快但样式仍分散
- B（轻量常量抽取）：折中
- C（本次采用）：对当前范围做语义化 token，后续调优只改 token 值

## 架构与组件设计

### 1) Token 层（`CompactHeader/utils.ts`）

新增/扩展语义 token：

- `TAB_TEXT_INACTIVE = "text-gray-700 dark:text-gray-300"`
- `TAB_TEXT_INACTIVE_DEFAULT = "text-gray-500 dark:text-gray-400"`
- `HEADER_RIGHT_GAP = "ml-2"`（8px）

### 2) `Tab.tsx`

- 未激活标签文字色由硬编码替换为 `TAB_TEXT_INACTIVE`
- 默认标题（斜体）色阶替换为 `TAB_TEXT_INACTIVE_DEFAULT`
- active 标签与其它交互逻辑保持不变

### 3) `index.tsx`

- 右侧容器（含 `StatusIndicator`）增加 `HEADER_RIGHT_GAP`
- 保持现有结构与按钮密度不变

## 数据流与兼容性

- 不引入新状态，不改 store，不改副作用。
- 所有行为路径（激活/关闭/重命名/拖拽重排）保持一致。
- 视觉调整仅通过 class/token 生效，风险可控。

## 错误处理与回退策略

- 若视觉过亮或间距不理想，仅调整 token 值即可回退。
- 不涉及 API、持久化或业务状态，不需要迁移脚本。

## 测试与验收

### 自动化测试

1. `Tab.test.tsx`：断言未激活标题使用新色阶 class（light/dark）。
2. `CompactHeader/index.test.tsx`：断言右侧容器包含 `ml-2`。
3. 现有 `Tab/TabBar/CompactHeader` 交互测试继续通过。

### 手动验收

1. 未激活标签标题比当前明显更亮（中等强度）。
2. 标签栏到连接状态图标之间有稳定 8px 间距。
3. light/dark 主题视觉层级一致。
