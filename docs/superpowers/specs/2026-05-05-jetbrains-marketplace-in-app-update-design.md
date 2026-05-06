# JetBrains 插件站内更新能力设计

**日期**: 2026-05-05
**状态**: 设计已确认

## 概述

当前 WebGUI 右上角版本号行已经暴露“检查更新”入口，但 JetBrains 宿主侧只实现了通用 IDE bridge 能力，没有实现 `getUpdateInfo`、`checkForUpdates`、`installUpdate` 三个更新请求。因此 WebGUI 在 JetBrains 下点更新，本质上是在调用一个宿主并不支持的能力，表现为入口可见但无法真正完成更新。

本次改动的目标不是简单把按钮“点通”，而是把 JetBrains 的更新能力正式收敛成一套明确的宿主契约：Marketplace 安装版支持站内检查和原生安装，本地 ZIP / 开发版明确降级提示，WebGUI 继续复用唯一的 `UpdateContext` 状态机，不再依赖“调用失败”来推断宿主能力。

## 目标

1. 让 JetBrains Marketplace 安装版支持完整站内更新流程：检查更新 → 确认 → 原生安装
2. 让 JetBrains 端的版本来源只以 JetBrains Marketplace 为准，避免 GitHub Release 与 Marketplace 审核存在时间差时误报
3. 继续复用 WebGUI 现有 `UpdateContext`，不新增第二套更新状态机
4. 让本地 ZIP / 开发版安装形态优雅降级，明确提示“仅 Marketplace 安装版支持站内更新”
5. 保持 VSCode 现有 GitHub Release / VSIX 更新流零回归

## 不在范围内

- 不重做 WebGUI 整套更新 UI
- 不把 JetBrains 更新来源改成 GitHub Release
- 不让本地 ZIP / 开发版自动升级到 Marketplace 正式版
- 不改造现有 VSCode 更新实现
- 不在本次新增 changelog 预览、忽略版本、上次检查时间等附加功能

## 当前现状与根因

### WebGUI 现状

- `packages/opencode/webgui/src/state/UpdateContext.tsx`
  - 已经实现 `getUpdateInfo` 初始化读取
  - 已经实现 `checkForUpdates()` 手动检查
  - 已经实现 `installUpdate(version)` 安装请求
  - 已经能消费 `updateAvailable` / `downloading` / `installing` / `success` / `error` 事件
- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
  - 已经把版本号旁的检查更新入口接到 `useUpdate()`

也就是说，WebGUI 侧更新交互本身已经成型，并且默认假设宿主支持完整更新链路。

### JetBrains 现状

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - 当前仅实现 `openFile`、`openUrl`、`reloadPath`、`clipboardWrite`、`restartHost`、`storageGet`、`storageSet`
  - **没有**实现 `getUpdateInfo`、`checkForUpdates`、`installUpdate`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
  - 已通过 JCEF 承载 `/app`
  - 已为 WebGUI 注入 `ideBridge` 与 `ideBridgeToken`
- `docs/repowiki/06-settings-update-localization.md`
  - 已明确记录“JetBrains 当前没有同等更新 API，WebGUI 在 JetBrains 下应视为能力退化”

### 根因

根因不是按钮样式或前端状态问题，而是：

1. WebGUI 已经统一接入更新状态机
2. VSCode 宿主实现了更新 API
3. JetBrains 宿主没有实现对应更新 API
4. 于是 JetBrains 下出现“入口存在，但能力未落地”的协议断层

## 方案比较

### 方案 A：补齐 JetBrains 更新宿主能力并复用 WebGUI 现有状态机（采用）

做法：

- JetBrains 宿主新增 `getUpdateInfo`、`checkForUpdates`、`installUpdate`
- 版本来源只看 JetBrains Marketplace
- 安装动作走 JetBrains 原生插件更新/安装链路
- 本地 ZIP / 开发版明确返回“不支持站内更新”

优点：

- 最符合“完整站内更新”的目标
- 不需要重做 WebGUI 交互
- 宿主能力边界清晰，后续更易维护

缺点：

- JetBrains 端需要新增一套更新查询与安装封装

### 方案 B：只补检查更新，安装时跳转到插件设置或 Marketplace 页面（不采用）

不采用原因：

- 风险较低，但不满足“站内完成更新”的目标
- 用户仍然需要手动完成安装，体验割裂

### 方案 C：JetBrains 下隐藏或禁用更新入口（不采用）

不采用原因：

- 虽然最稳，但直接放弃了已上架 Marketplace 后应具备的能力演进方向
- 不满足用户目标

## 最终设计

## 一、总体原则

1. **WebGUI 继续只有一个更新状态机**：所有更新 UI 仍统一通过 `UpdateContext` 驱动
2. **JetBrains 自己声明能力**：由宿主返回支持/不支持与原因，不让前端再通过失败兜底反推
3. **Marketplace 是 JetBrains 唯一版本真相源**：JetBrains 端不再拿 GitHub Release 当更新依据
4. **安装走原生链路**：允许出现 JetBrains 原生确认与重启提示，不追求 VSCode 式静默安装
5. **本地 ZIP / 开发版只做说明性降级**：不伪装成“可更新”

## 二、架构拆分

### 新增 JetBrains 更新模块

在 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/` 下新增更新相关文件：

- `PluginUpdateService.kt`
  - JetBrains 更新总入口
  - 对外提供：
    - `getUpdateInfo()`
    - `checkForUpdates()`
    - `installUpdate(version)`
- `PluginUpdateModels.kt`
  - 更新相关数据结构
  - 包括当前版本、最新版本、支持状态、不支持原因、检查结果、安装结果等

### 保留 `IdeBridge.kt` 的职责边界

`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` 只负责协议分发，不直接内嵌 Marketplace 查询或安装实现。它只新增三个 message handler：

- `getUpdateInfo`
- `checkForUpdates`
- `installUpdate`

具体更新逻辑全部转交 `PluginUpdateService`。

### 安装形态识别

JetBrains 宿主需要在运行时区分：

- Marketplace 正式版：支持站内更新
- 本地 ZIP / 开发版：不支持站内更新

通过 `hosts/jetbrains-plugin/src/main/resources/opencode-build.properties` 注入一个明确的分发渠道标记 `distributionChannel=marketplace|local`，并在 `processResources` 阶段与现有 `opencode.min.version` 一起展开到资源文件里，运行时由 `PluginUpdateService` 读取。这样能力判断来自明确配置，而不是零散猜测。

## 三、数据模型

### `getUpdateInfo` 返回结构

JetBrains 端返回统一的结构化对象，供 WebGUI 初始化时直接消费：

```ts
type JetBrainsUpdateInfo = {
  supported: boolean
  reason?: "marketplace-only"
  currentVersion: string
  latest?: {
    version: string
    releaseUrl?: string
    notes?: string
    publishedAt?: string
  } | null
  hasUpdate?: boolean
}
```

语义：

- `supported: true`
  - 表示当前安装形态允许站内更新
- `supported: false`
  - 表示当前安装形态不允许站内更新
  - `reason: "marketplace-only"` 表示只有 Marketplace 安装版支持

### `checkForUpdates` 返回结构

JetBrains 端返回：

```ts
type JetBrainsCheckForUpdatesResult =
  | {
      status: "available"
      latest: {
        version: string
        releaseUrl?: string
        notes?: string
        publishedAt?: string
      }
    }
  | {
      status: "up-to-date"
      currentVersion: string
    }
  | {
      status: "unsupported"
      reason: "marketplace-only"
      currentVersion: string
    }
```

### `installUpdate` 请求约束

`installUpdate(version)` 只接受一个明确版本号。JetBrains 宿主在真正执行安装前必须校验：

- 当前缓存到的 `latest` 存在
- `latest.version === version`

若不一致，直接拒绝安装并要求用户重新检查更新，避免安装过期目标。

## 四、Marketplace 查询与原生安装策略

### 检查更新来源

JetBrains 端更新查询只看 JetBrains Marketplace 的当前插件兼容更新。实现上直接使用 IntelliJ 平台现成的 Marketplace 查询能力：以当前插件 `PluginId` 和当前 IDE build 调用 `MarketplaceRequests.getLastCompatiblePluginUpdateModel(...)`，拿到当前插件在当前 IDE build 下的最新兼容 Marketplace update。

### 安装执行来源

JetBrains 端安装动作使用 IntelliJ 平台的 `PluginDownloader` 原生下载/安装链路，并复用平台已有的兼容性、签名校验、动态安装与重启安装判定逻辑。

这样可以获得：

- 与 JetBrains 原生插件更新一致的行为
- 平台已有的签名、兼容性与错误处理能力
- 更符合“允许原生确认”的目标

## 五、交互与时序

### 1. 初始化：`getUpdateInfo`

WebGUI 启动时，`UpdateContext` 继续请求 `getUpdateInfo`。

JetBrains 返回三类状态之一：

1. **支持且已有已知更新**
   - `supported: true`
   - `latest` 已填充
   - `hasUpdate: true`
2. **支持但当前无更新**
   - `supported: true`
   - `latest: null`
   - `hasUpdate: false`
3. **当前安装形态不支持站内更新**
   - `supported: false`
   - `reason: "marketplace-only"`

这样 WebGUI 可以直接拿到宿主能力声明，不必等用户点击后再失败。

### 2. 手动检查：`checkForUpdates`

用户点击版本号右侧刷新图标时：

1. WebGUI 调 `checkForUpdates`
2. JetBrains 先判断当前安装形态
3. 若不是 Marketplace 安装版：
   - 返回 `status: "unsupported"`
   - WebGUI 以 toast 明确提示：`当前安装包不支持站内更新，请使用 JetBrains Marketplace 安装版`
4. 若是 Marketplace 安装版：
   - JetBrains 查询 Marketplace 最新兼容版本
   - 若没有更新，返回 `up-to-date`
   - 若有更新，返回 `available + latest`
5. WebGUI 收到 `available` 后继续复用现有确认框：

```text
发现新版本
检测到新版本 vX，是否立即更新？
```

### 3. 安装更新：`installUpdate`

用户确认后：

1. WebGUI 调 `installUpdate(version)`
2. JetBrains 先完成版本校验
3. JetBrains **先回复 bridge 请求成功**
4. 然后异步执行原生安装链路
5. 过程中通过 SSE 推送：
   - `installing`
   - `success`
   - `error`

### 4. 状态事件策略

本次不要求 JetBrains 强行模拟 VSCode 的 `downloading` 阶段。

原因：

- JetBrains 原生插件更新往往把下载与安装视作一个更紧密的流程
- WebGUI 当前只需允许 JetBrains 从 `available` 直接进入 `installing`

因此推荐做法是：

- JetBrains 不发送 `downloading`
- 直接在实际安装开始时发送 `installing`

### 5. 传输中断保护

和 `restartHost` 一样，任何可能导致当前 transport 失效的动作都必须遵守：

1. 先回复请求
2. 再执行安装 / 重启 / 动态加载动作

否则 WebGUI 很容易把宿主已开始安装误判为请求失败。

## 六、WebGUI 兼容设计

### 继续复用 `UpdateContext`

`packages/opencode/webgui/src/state/UpdateContext.tsx` 继续作为唯一更新状态机，不新增第二套 JetBrains 专用状态。

需要补充的只是：

1. 处理 `checkForUpdates` 返回 `unsupported`
2. 允许 JetBrains 不经过 `downloading`，直接进入 `installing`
3. JetBrains 成功文案不再沿用 VSCode 风格语义

### 文案建议

- 不支持：
  - `当前安装包不支持站内更新，请使用 JetBrains Marketplace 安装版`
- 检查失败：
  - `检查更新失败，请稍后重试`
- 安装中：
  - `正在通过 JetBrains Marketplace 安装更新`
- 安装成功：
  - `更新已开始安装，请按 IDE 提示完成重启`

### 前后兼容

- **新 WebGUI + 老 JetBrains 宿主**
  - 仍需保留当前 `catch -> toast` 兜底
  - 即使宿主还没升级，也不会直接失控
- **老 WebGUI + 新 JetBrains 宿主**
  - JetBrains 返回新增字段 `supported` / `reason` 不应破坏已有 `latest` / `hasUpdate` 结构

## 七、错误处理与兼容策略

### 错误分层

#### 1. 不支持

- 场景：本地 ZIP / 开发版
- 结果：返回 `unsupported`
- 面向用户：明确提示，不视为异常

#### 2. 检查失败

- 场景：Marketplace 请求失败、插件元数据缺失、插件 id 无法匹配
- 结果：`checkForUpdates` 失败
- 面向用户：`检查更新失败，请稍后重试`

#### 3. 安装失败

- 场景：下载失败、签名/兼容性校验失败、原生安装链路抛错
- 结果：推送 `error`

#### 4. 版本不一致

- 场景：用户确认的版本与当前 JetBrains 端缓存的 `latest` 不一致
- 结果：拒绝安装，并要求重新检查

### 安装形态兼容

- Marketplace 正式版：支持完整站内更新
- 本地 ZIP / 开发版：只提示说明，不尝试安装

## 八、文件影响范围

### JetBrains

- 新增：`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
- 新增：`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateModels.kt`
- 修改：`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- 修改：`hosts/jetbrains-plugin/build.gradle.kts`
- 修改：`hosts/jetbrains-plugin/src/main/resources/opencode-build.properties`
- 新增：`hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`
- 新增：`hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

### WebGUI

- 修改：`packages/opencode/webgui/src/state/UpdateContext.tsx`
- 修改：`packages/opencode/webgui/src/state/UpdateContext.test.tsx`
- 修改：`packages/opencode/webgui/src/components/UpdateBanner.tsx`
- 修改：`packages/opencode/webgui/src/components/UpdateBanner.test.tsx`

### 文档

- 修改：`docs/repowiki/02-ide-bridge.md`
- 修改：`docs/repowiki/06-settings-update-localization.md`
- 修改：`docs/repowiki/07-host-plugins.md`

## 九、测试策略

## 一、JetBrains 单测

至少覆盖：

### `getUpdateInfo`

- Marketplace 安装版 + 无更新
- Marketplace 安装版 + 有更新
- 本地 ZIP / 开发版 + `supported: false`

### `checkForUpdates`

- 返回 `up-to-date`
- 返回 `available`
- 返回 `unsupported`
- Marketplace 请求异常时返回失败

### `installUpdate`

- 版本匹配时进入安装流程
- 版本不匹配时拒绝
- 安装异常时推送 `error`

### `IdeBridge` roundtrip

- `getUpdateInfo`
- `checkForUpdates`
- `installUpdate`
- 请求失败不会把 bridge 卡死

## 二、WebGUI 测试

至少补这些场景：

- JetBrains 返回 `unsupported` 时显示正确 toast
- JetBrains 没有 `downloading`，直接 `installing` 时状态仍正确
- JetBrains 成功文案不误用 VSCode 语义
- 老宿主未实现接口时，仍然走兜底失败提示

## 三、集成验收

### 1. Marketplace 正式版

- 能检查到新版本
- 能弹确认框
- 能进入 JetBrains 原生安装链路
- 成功后提示用户按 IDE 提示重启或完成生效

### 2. 本地 ZIP / 开发版

- 入口可点
- 明确提示“不支持站内更新”
- 不会假装开始安装

### 3. 回归验证

- VSCode 现有更新流程不受影响
- JetBrains `restartHost` 不受影响
- WebGUI `UpdateContext` 仍是唯一更新状态机

## 十、验收标准

本次完成标准定义为：

1. IDEA 端更新入口不再是“点了无效”或 `unsupported message type`
2. JetBrains Marketplace 安装版能完成“检查更新 → 确认 → 原生安装”
3. 本地 ZIP / 开发版能优雅降级并给出明确说明
4. VSCode 更新能力零回归
5. 文档明确记录 JetBrains 与 VSCode 在更新能力上的共同点与差异边界
