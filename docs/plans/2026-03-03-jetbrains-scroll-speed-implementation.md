# JetBrains JCEF 滚动速度优化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 通过 URL 参数传递滚动倍数，在 Web 层拦截并放大 JCEF 环境下的滚动量，解决 JetBrains 插件中主聊天区域滚动过慢的问题。

**Architecture:** Kotlin 层在构建 URL 时添加 `jcefScrollMultiplier=4` 参数，Web 层的 `createAutoScroll` hook 读取该参数，拦截 `wheel` 事件并放大 `deltaY` 后手动调用 `scrollBy`。

**Tech Stack:** Kotlin (JetBrains Plugin), TypeScript (SolidJS), JCEF

---

## Task 1: Kotlin 层添加 URL 参数

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt:206-216`

**Step 1: 在 URL 构建中添加 jcefScrollMultiplier 参数**

找到 `urlWithBridge` 的构建代码（约 209-216 行），在 `ideBridgeToken` 参数后添加新参数：

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

**Step 2: 验证修改**

检查代码：

- 确保参数拼接正确（使用 `&` 连接）
- 确保参数名拼写正确：`jcefScrollMultiplier`
- 确保值为 `4`

**Step 3: Commit**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt
git commit -m "feat(jetbrains): add jcefScrollMultiplier URL parameter"
```

---

## Task 2: Web 层读取 URL 参数并拦截滚动

**Files:**

- Modify: `packages/ui/src/hooks/create-auto-scroll.tsx:12-118`

**Step 1: 在 hook 初始化时读取 URL 参数**

在 `createAutoScroll` 函数开头（第 12 行后）添加参数读取逻辑：

```typescript
export function createAutoScroll(options: AutoScrollOptions) {
  // 读取 JCEF 滚动倍数参数
  const scrollMultiplier = (() => {
    const params = new URLSearchParams(window.location.search)
    const value = params.get('jcefScrollMultiplier')
    if (!value) return undefined
    const parsed = parseFloat(value)
    return parsed > 0 ? parsed : undefined
  })()

  let scroll: HTMLElement | undefined
  // ... 其余代码
```

**Step 2: 修改 handleWheel 函数以拦截和放大滚动**

找到 `handleWheel` 函数（约 108-118 行），完全替换为：

```typescript
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

**Step 3: 修改事件监听器为非 passive 模式**

找到 `scrollRef` 函数中的事件监听器注册（约 226 行），修改为：

```typescript
scrollRef: (el: HTMLElement | undefined) => {
  if (cleanup) {
    cleanup()
    cleanup = undefined
  }

  scroll = el

  if (!el) return

  updateOverflowAnchor(el)
  // 修改：如果有 scrollMultiplier，使用非 passive 模式以便 preventDefault
  el.addEventListener("wheel", handleWheel, { passive: !scrollMultiplier })

  cleanup = () => {
    el.removeEventListener("wheel", handleWheel)
  }
}
```

**Step 4: 验证修改**

检查代码：

- 确保 `scrollMultiplier` 在函数顶部正确初始化
- 确保 `handleWheel` 中先检查嵌套滚动区域
- 确保拦截逻辑中调用了 `preventDefault()`
- 确保向上滚动时调用 `stop()`
- 确保事件监听器的 `passive` 选项正确设置

**Step 5: Commit**

```bash
git add packages/ui/src/hooks/create-auto-scroll.tsx
git commit -m "feat(ui): intercept and amplify wheel events for JCEF"
```

---

## Task 3: 手动测试

**Files:**

- Test: JetBrains IDE 插件

**Step 1: 构建 JetBrains 插件**

```bash
cd hosts/jetbrains-plugin
./gradlew buildPlugin
```

**Step 2: 在 JetBrains IDE 中安装并测试**

1. 打开 JetBrains IDE（IntelliJ IDEA / PyCharm 等）
2. 安装构建的插件（从 `build/distributions/` 目录）
3. 打开 OpenCode 工具窗口
4. 在主聊天区域测试滚动：
   - 使用鼠标滚轮向下滚动，观察滚动距离是否明显增加
   - 使用鼠标滚轮向上滚动，观察滚动距离是否明显增加
   - 快速连续滚动，观察是否流畅无卡顿

**Step 3: 测试边界情况**

1. 测试嵌套滚动区域（代码块、diff 视图）：
   - 在代码块内滚动，确保不受影响（使用原生滚动速度）
   - 在 diff 视图内滚动，确保不受影响
2. 测试自动滚动功能：
   - 发送消息，观察是否自动滚动到底部
   - 手动向上滚动后，观察是否停止自动滚动
3. 测试滚动到边界：
   - 滚动到顶部，确保不会过度滚动
   - 滚动到底部，确保不会过度滚动

**Step 4: 记录测试结果**

在测试过程中记录：

- 滚动速度是否符合预期（4 倍放大是否合适）
- 是否有卡顿或延迟
- 嵌套滚动区域是否正常
- 自动滚动功能是否正常

**Step 5: 根据测试结果调整倍数（如需要）**

如果 4 倍不合适，修改 `ChatToolWindowFactory.kt` 中的倍数值，重新构建并测试。

---

## Task 4: 兼容性测试

**Files:**

- Test: VSCode 插件, Desktop 应用

**Step 1: 测试 VSCode 插件**

1. 构建并安装 VSCode 插件
2. 打开 OpenCode 面板
3. 测试主聊天区域滚动：
   - 确保滚动速度正常（不受 JCEF 参数影响）
   - 确保没有控制台错误

**Step 2: 测试 Desktop 应用**

1. 构建并运行 Desktop 应用
2. 测试主聊天区域滚动：
   - 确保滚动速度正常（不受 JCEF 参数影响）
   - 确保没有控制台错误

**Step 3: 验证向后兼容性**

确认：

- 没有 `jcefScrollMultiplier` 参数时，行为与之前完全一致
- 其他环境不受影响

---

## Task 5: 文档更新（可选）

**Files:**

- Create: `docs/troubleshooting/jetbrains-scroll-speed.md` (可选)

**Step 1: 创建故障排查文档（如需要）**

如果用户可能需要调整滚动速度，创建文档说明如何修改倍数参数。

**Step 2: 更新 CHANGELOG（如需要）**

在项目的 CHANGELOG 中添加此改进的说明。

---

## 测试检查清单

- [ ] JetBrains IDE 中主聊天区域滚动速度明显提升
- [ ] 向上滚动和向下滚动都正常工作
- [ ] 嵌套滚动区域（代码块、diff 视图）不受影响
- [ ] 自动滚动功能正常工作
- [ ] 快速连续滚动无卡顿
- [ ] VSCode 插件滚动正常（不受影响）
- [ ] Desktop 应用滚动正常（不受影响）
- [ ] 无控制台错误或警告

## 回滚方案

如果出现问题，按以下步骤回滚：

1. 移除 Kotlin 层的 URL 参数：

   ```bash
   git revert <commit-hash-of-task-1>
   ```

2. 移除 Web 层的拦截逻辑：

   ```bash
   git revert <commit-hash-of-task-2>
   ```

3. 重新构建并部署

## 未来优化方向

1. **可配置倍数：** 在 JetBrains Settings 中添加滚动速度配置项
2. **自适应倍数：** 根据 `deltaMode` 区分触摸板和鼠标滚轮
3. **平滑滚动：** 考虑添加 `behavior: 'smooth'` 选项
