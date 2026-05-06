# JetBrains 插件版本显示与 vendor 对齐设计

**日期**: 2026-05-06
**状态**: 设计已确认

## 概述

当前 JetBrains 插件存在两个对用户可见但来源不一致的元数据问题：

1. IDEA 插件详情页显示的已安装版本来自 JetBrains 插件自身版本，已经是最新的 `26.5.600`
2. WebGUI 右上角菜单中的版本号来自 `packages/opencode/webgui/package.json` 编译时注入的 `__APP_VERSION__`，仍停留在旧值 `26.5.501`
3. JetBrains 插件列表与详情页显示的 vendor 仍是 `qtkj`，与当前维护者标识不一致

这会让用户误以为插件没有真正升级成功，同时也让 JetBrains 市场页的发布者元数据继续暴露旧标识。

本次改动的目标，是把 JetBrains 端“右上角版本号”的权威来源改为**实际安装的 JetBrains 插件版本**，并把插件 vendor 统一改为 `Caiqy`。同时，正式发版链路还要补齐 WebGUI fallback 版本注入，避免未来再次出现正式包内嵌旧前端版本号的问题。

## 目标

1. JetBrains 右上角菜单中的版本号显示实际安装插件版本，而不是过期的 WebGUI 构建版本
2. JetBrains 插件详情页、插件列表中的 vendor 统一显示为 `Caiqy`
3. 正式 release 构建出的 JetBrains 安装包中，WebGUI fallback 版本与发版号保持一致
4. 保持 VSCode 现有版本显示与发布逻辑不回归
5. 保持当前更新检查链路可用，不把版本显示与更新状态机强耦合

## 不在范围内

- 不重做整个 Header UI
- 不把右上角版本号改成同时显示“插件版本 + WebGUI 版本”双字段
- 不修改 JetBrains 插件名称、插件 ID 或包名
- 不把版本显示逻辑迁移到 `UpdateContext`
- 不在本次处理 Marketplace 缓存延迟或 JetBrains 平台同步延迟

## 当前现状与根因

### 1. 右上角版本号现状

- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
  - `displayVersion` 初始值来自 `__APP_VERSION__`
  - 组件挂载后会尝试调用 `ideBridge.request("getExtensionVersion")` 覆盖显示值
- `packages/opencode/webgui/vite.config.ts`
  - `__APP_VERSION__` 由 `packages/opencode/webgui/package.json` 的 `version` 注入
- `packages/opencode/webgui/package.json`
  - 当前版本仍为 `26.5.501`

因此，只要宿主没有成功返回真实扩展版本，Header 就会一直显示旧的 fallback 值。

### 2. JetBrains 宿主现状

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - 当前没有实现 `getExtensionVersion`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
  - 有 `pluginVersion()` 帮助函数，但它只用于给 JCEF URL 加 cache buster，不会返回给 WebGUI
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - `readInstalledVersion()` 已经能通过 `PluginManagerCore.getPlugin(pluginId)?.version` 读取当前安装插件版本

这说明真实版本来源其实已经存在于 JetBrains 侧，但没有通过 IDE bridge 暴露给前端 Header。

### 3. vendor 现状

- `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
  - 当前 `<vendor>qtkj</vendor>`
- `hosts/jetbrains-plugin/build.gradle.kts`
  - 当前 `group = "qtkj.opencode"`

JetBrains 插件详情页中的 `qtkj` 来自插件 metadata，而不是 IDE 额外生成的标记。

### 根因总结

根因分两层：

1. **显示层协议缺口**：前端期待宿主提供 `getExtensionVersion`，但 JetBrains 宿主并未实现
2. **发版注入缺口**：release 流程会注入 JetBrains 插件版本，却不会同步注入 WebGUI 的 `package.json` 版本，导致 fallback 长期漂移

## 方案比较

### 方案 A：JetBrains bridge 补 `getExtensionVersion`，Header 以宿主实际安装版本为准，并补发版 fallback 注入（采用）

做法：

- JetBrains 宿主新增 `getExtensionVersion`
- 通过 `PluginManagerCore.getPlugin(pluginId)?.version` 返回当前安装插件版本
- WebGUI Header 保持现有 fallback + 异步覆盖模式
- release 流程同步注入 `packages/opencode/webgui/package.json` 的版本号
- vendor 改为 `Caiqy`

优点：

- 直接修复当前用户看到的版本不一致问题
- 右上角版本号与 JetBrains 市场页语义一致
- 保持 Header 与更新状态机解耦
- fallback 版本也不再在正式包里长期过期

缺点：

- 首次渲染到 bridge reply 返回之间，仍可能短暂显示 fallback 值

### 方案 B：Header 统一改为使用 `getUpdateInfo().currentVersion`

不采用原因：

- 把“显示版本”耦合到“更新上下文初始化”上，职责边界不清晰
- 版本显示不应依赖更新能力是否可用
- 当前前端已经有独立的 `getExtensionVersion` 接口预期，补齐宿主更自然

### 方案 C：只改 release 注入，不补 JetBrains `getExtensionVersion`

不采用原因：

- 能降低正式发布包显示旧值的概率，但不能保证本地构建、开发版或其他发布路径一致
- 没有真正解决“Header 应显示宿主真实安装版本”的核心问题

## 最终设计

## 一、版本显示原则

1. **JetBrains Header 版本号的唯一权威来源是实际安装插件版本**
2. **`__APP_VERSION__` 只作为 fallback，不再被视为 JetBrains 下的真相源**
3. **版本显示能力与更新能力分离**：Header 不依赖 `UpdateContext` 初始化成功
4. **VSCode 保持现有行为**：已有 `getExtensionVersion` 的宿主逻辑不改语义

## 二、JetBrains bridge 设计

### 新增 `getExtensionVersion` action

在 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` 中新增 message handler：

- action: `getExtensionVersion`
- result:

```json
{
  "version": "26.5.600"
}
```

语义要求：

- 返回值必须是当前 **已安装 JetBrains 插件描述符** 上的版本号
- 读取失败时返回协议错误，由前端保留 fallback
- 不复用 `ChatToolWindowFactory.pluginVersion()`，避免依赖 `implementationVersion` 或日期 fallback 这类弱语义来源

### 版本读取来源

统一复用 JetBrains 已有的真实版本读取方式：

- `PluginManagerCore.getPlugin(pluginId)?.version`

如果仓库里已有同类读取逻辑，则应抽成可复用 helper，避免 `PluginUpdateService` 与 `IdeBridge` 各自维护一套版本来源。

## 三、WebGUI Header 设计

### 保持当前交互模式

`packages/opencode/webgui/src/components/CompactHeader/index.tsx` 保持以下模式：

1. 初始值先显示 `__APP_VERSION__`
2. 组件挂载后请求 `getExtensionVersion`
3. 若返回合法字符串，则覆盖 `displayVersion`
4. 若请求失败，则静默保留 fallback

本次不改交互样式，只确保 JetBrains 下请求真正可用。

### 为什么不改成阻塞渲染

不等待宿主版本返回后再渲染 Header，原因是：

- Header 版本号不是首屏阻塞信息
- 当前已有稳定 fallback
- 保持现有交互结构，回归风险最小

## 四、vendor 元数据设计

### plugin metadata

将以下 JetBrains 插件元数据统一改为 `Caiqy`：

- `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
  - `<vendor>Caiqy</vendor>`

### 构建元数据

同步将：

- `hosts/jetbrains-plugin/build.gradle.kts`
  - `group = "qtkj.opencode"`

改为：

- `group = "Caiqy.opencode"`

这样可以让源码元数据、构建元数据与 Marketplace 对外展示保持一致。

## 五、release 注入设计

### 目标

确保 tag release 构建 JetBrains 安装包时，WebGUI fallback 版本也与发版号一致。

### 做法

在 `.github/workflows/release.yml` 的 JetBrains 构建链路中，除现有的：

- 注入 `hosts/jetbrains-plugin/build.gradle.kts` 的插件版本

还要新增：

- 注入 `packages/opencode/webgui/package.json` 的 `version`

注入值应与当前 release tag 的 clean version 一致，例如：

- tag: `v26.5.600`
- injected webgui version: `26.5.600`

### 边界

- 这是 release 工作流中的临时构建内修改，不要求本地仓库文件永久变更
- VSCode 发布链路无需依赖这个改动，但共用 WebGUI 构建时不应因此回归

## 六、测试设计

### JetBrains 宿主测试

新增或扩展 JetBrains bridge / service 测试，覆盖：

1. `getExtensionVersion` 成功返回当前插件版本
2. 版本读取失败时返回错误 reply
3. vendor 改动不会影响现有更新服务测试

### WebGUI 测试

补充 Header 相关测试，覆盖：

1. `getExtensionVersion` 返回合法版本时，Header 显示宿主版本而非 fallback
2. `getExtensionVersion` 失败时，Header 保留 `__APP_VERSION__`

### Release 工作流验证

补充脚本化校验，确认 release job 运行后：

1. JetBrains 插件版本已被注入 tag 版本
2. WebGUI `package.json` 版本已被注入相同版本

## 七、风险与缓解

### 风险 1：JetBrains 版本读取逻辑分叉

如果 `IdeBridge` 和 `PluginUpdateService` 各自维护独立读取逻辑，后续可能再次漂移。

缓解：

- 优先复用同一 helper / 同一读取实现

### 风险 2：release 注入只覆盖 JetBrains，不覆盖其他共享构建路径

如果 WebGUI 构建发生在注入之前或走了别的 job，可能仍打进旧 fallback。

缓解：

- 把注入步骤放在实际 JetBrains 插件构建前
- 增加 workflow 校验步骤，直接检查注入后的文件值

### 风险 3：Header 短暂闪旧值

这是现有 fallback + 异步覆盖模式的已知特性。

缓解：

- 当前接受该行为，以最小改动修复真值来源
- 若未来需要彻底消除闪动，再单独设计 skeleton / delayed render 方案

## 成功标准

1. 从 JetBrains Marketplace 安装 `26.5.600+` 版本后，插件右上角显示与插件详情页版本一致
2. 插件详情页和插件列表中的 vendor 显示为 `Caiqy`
3. JetBrains 相关单测通过
4. WebGUI Header 相关测试通过
5. release 工作流能验证 JetBrains 构建前的 WebGUI fallback 版本注入正确
