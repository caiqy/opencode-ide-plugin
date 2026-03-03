# JetBrains JCEF 滚动速度优化设计

## 问题描述

在 JetBrains IDE 插件中，webgui 通过 JCEF（Java Chromium Embedded Framework）嵌入。用户反馈主聊天区域滚动速度过慢，每次鼠标滚轮滚动的步进量太小，需要滚动很多次才能到达目标位置。

**问题根源：** JCEF 传递给网页的 `wheel` 事件 `deltaY` 值比原生浏览器小很多（通常是 1/3 到 1/5），导致浏览器原生滚动行为的步进量不足。

**影响范围：** 仅主聊天区域（使用 `createAutoScroll` hook 的区域），嵌套滚动区域（代码块、diff 视图等）不受影响。

## 解决方案

采用**混合方案**：Kotlin 层通过 URL 参数传递滚动倍数，Web 层读取参数并拦截 `wheel` 事件，放大滚动量后手动调用 `scrollBy`。

### 方案优势

- **配置灵活：** 可以在 Kotlin 层调整倍数，无需重新构建前端
- **实现清晰：** 通过 URL 参数明确标识 JCEF 环境，无需复杂的环境检测
- **影响可控：** 只修改主聊天区域，不影响其他滚动区域
- **向后兼容：** 非 JCEF 环境（VSCode、Desktop 等）不受影响

## 架构设计

### 数据流

```
用户滚动鼠标
  ↓
JCEF 触发 wheel 事件（deltaY 很小）
  ↓
createAutoScroll.handleWheel 拦截
  ↓
检查 URL 参数 jcefScrollMultiplier
  ↓
放大 deltaY × multiplier
  ↓
手动调用 element.scrollBy()
  ↓
触发 scroll 事件
  ↓
handleScroll 更新 userScrolled 状态
```

## 组件设计

### 1. Kotlin 层修改

**文件：** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`

**修改位置：** 在构建 `urlWithBridge` 时添加参数

```kotlin
val urlWithBridge = buildString {
    append(baseUrl)
    append(if ('?' in baseUrl) '&' else '?')
    append("ideBridge=")
    append(URLEncoder.encode(session.baseUrl, StandardCharsets.UTF_8))
    append("&ideBridgeToken=")
    append(URLEncoder.encode(session.token, StandardCharsets.UTF_8))
    append("&jcefScrollMultiplier=4")  // 新增：滚动倍数参数
}
```

**参数说明：**

- `jcefScrollMultiplier=4`：默认 4 倍放大
- 后续可以做成可配置项（通过 Settings）

### 2. Web 层修改

**文件：** `packages/ui/src/hooks/create-auto-scroll.tsx`

**修改内容：**

1. **读取 URL 参数：** 在 hook 初始化时解析 `jcefScrollMultiplier`
2. **修改 handleWheel：**
   - 如果存在倍数参数，拦截事件并放大滚动量
   - 保留原有的"用户滚动检测"逻辑
   - 保留对嵌套滚动区域的判断

**实现要点：**

```typescript
// 读取参数
const scrollMultiplier = (() => {
  const params = new URLSearchParams(window.location.search)
  const value = params.get("jcefScrollMultiplier")
  if (!value) return undefined
  const parsed = parseFloat(value)
  return parsed > 0 ? parsed : undefined
})()

// 修改 handleWheel
const handleWheel = (e: WheelEvent) => {
  // 检查嵌套滚动区域
  const el = scroll
  const target = e.target instanceof Element ? e.target : undefined
  const nested = target?.closest("[data-scrollable]")
  if (el && nested && nested !== el) return

  // JCEF 滚动放大
  if (scrollMultiplier && el) {
    e.preventDefault()
    const delta = e.deltaY * scrollMultiplier
    el.scrollBy({ top: delta, behavior: "auto" })

    // 向上滚动时标记用户交互
    if (e.deltaY < 0) {
      stop()
    }
    return
  }

  // 原有逻辑：向上滚动时标记用户交互
  if (e.deltaY >= 0) return
  stop()
}
```

**关键修改：**

- 将 `wheel` 事件监听器改为 `{ passive: false }` 以便调用 `preventDefault()`
- 拦截所有滚动方向（向上和向下），统一放大处理
- 向上滚动时仍然调用 `stop()` 标记用户交互

## 错误处理

- **参数缺失：** 如果 URL 中没有 `jcefScrollMultiplier` 参数，回退到浏览器原生滚动
- **参数非法：** 如果参数 ≤ 0 或非数字，忽略该参数
- **向后兼容：** 非 JCEF 环境不传递该参数，行为不变

## 测试策略

### 功能测试

- 在 JetBrains IDE 中验证滚动速度是否符合预期
- 测试向上滚动和向下滚动都正常工作
- 验证滚动到顶部和底部的边界行为

### 边界测试

- 测试嵌套滚动区域（代码块、diff 视图）不受影响
- 测试快速连续滚动时的行为
- 测试自动滚动（auto-scroll）功能不受影响

### 兼容性测试

- 确保 VSCode 插件正常工作（无 URL 参数）
- 确保 Desktop 应用正常工作（无 URL 参数）
- 确保其他使用 `createAutoScroll` 的组件不受影响

### 性能测试

- 验证快速滚动时没有卡顿
- 验证内存占用无明显增加

## 未来优化

1. **可配置倍数：** 在 JetBrains Settings 中添加滚动速度配置项
2. **自适应倍数：** 根据触摸板和鼠标滚轮自动调整倍数
3. **平滑滚动：** 考虑添加 `behavior: 'smooth'` 选项（需要权衡性能）

## 风险评估

- **低风险：** 修改范围小，只影响 JCEF 环境的主聊天区域
- **易回滚：** 如果出现问题，移除 URL 参数即可回退
- **测试充分：** 通过 URL 参数控制，可以在生产环境逐步灰度测试
