# 右上角菜单“检查更新”入口设计

**日期**: 2026-04-14
**状态**: 设计已确认

## 概述

在 WebGUI 右上角“更多菜单”底部的版本号这一行，补充一个手动“检查更新”入口。用户点击版本号右侧图标后，WebGUI 会通过 IdeBridge 主动请求 VSCode 插件立即检查 GitHub Release，而不是等待后台轮询。若检测到新版本，则弹确认框，用户确认后直接复用现有自动更新链路完成 VSIX 下载与安装；若当前已是最新版，则显示 toast 提示；若检查失败，则显示失败 toast。

该功能是对现有自动更新体系的补充，不替代后台轮询，也不替代现有 `UpdateBanner`。自动轮询继续负责被动发现更新；手动入口负责用户主动触发立即检查。

## 目标

1. 在右上角菜单的版本号行补充一个轻量检查更新入口
2. 手动点击时强制实时请求 GitHub latest release
3. 有更新时弹确认，确认后复用现有安装链路
4. 无更新时明确提示“已是最新版”
5. 保留现有 `UpdateBanner` 作为更新状态与后续操作的兜底入口

## 不在范围内

- 不移除现有后台轮询
- 不移除现有 `UpdateBanner`
- 不增加 changelog 预览
- 不增加“忽略此版本”
- 不增加“上次检查时间”展示
- 不把入口挪到 Header 常驻按钮区

## 方案选择

### 采用方案 A：版本号右侧图标按钮 + 复用现有更新主链路

菜单底部版本号区从：

```text
v26.4.1406
```

调整为：

```text
v26.4.1406   [检查更新图标]
```

点击后：

1. 图标进入 loading 状态
2. WebGUI 发起 `checkForUpdates`
3. VSCode 插件立即请求 GitHub
4. 若有更新：弹确认框，确认后安装
5. 若无更新：toast 提示“已是最新版”
6. 若失败：toast 提示“检查更新失败，请稍后重试”

### 选择理由

- **改动最小**：复用现有 UpdateService / UpdateBanner / installUpdate
- **符合用户预期**：入口位于版本号旁，语义自然
- **视觉干扰低**：不增加 Header 常驻按钮密度
- **职责清晰**：手动入口只负责“主动检查”，Banner 继续负责“持续展示状态”

### 不采用的方案

- **只点击版本号文字触发检查**：可发现性差
- **增加文字按钮而不只是图标**：菜单底部信息区会过重
- **移到右上角常驻按钮区**：会挤压现有 Header 操作按钮

## 交互设计

## 一、入口位置与样式

### 位置

入口位于 `CompactHeader/ActionButtons.tsx` 的“更多菜单”底部版本号这一行，放在版本号文本右侧。

### 样式

- 保持版本号行仍然是菜单底部的轻量信息区
- 图标尺寸与当前菜单内小图标一致或略小
- hover tooltip：`检查更新`
- checking 时图标切换为 loading / 旋转状态
- checking 时按钮禁用，避免重复点击

## 二、点击后的结果流

### 有更新

1. 图标 loading 结束
2. 弹出确认框：

```text
发现新版本
检测到新版本 v26.4.1407，是否立即更新？
```

按钮：

- `立即更新`
- `稍后`

3. 若用户确认，则复用现有 `installUpdate(version)` 主链路
4. `UpdateBanner` 同时保留，继续承接下载、安装、成功、失败状态

### 无更新

1. 图标 loading 结束
2. 通过 toast 提示：`已是最新版`

### 检查失败

1. 图标 loading 结束
2. 通过 toast 提示：`检查更新失败，请稍后重试`

## 三、与现有自动更新体系的关系

### 背景轮询仍保留

- `UpdateService.start()` 的 30 秒首次检查 + 4 小时轮询继续存在
- 自动发现新版本时仍会广播 `updateAvailable`

### `UpdateBanner` 仍保留

- 手动检查不是唯一入口
- 即使用户在确认框里点了“稍后”，仍可以通过 Banner 再次操作更新
- 更新过程中的 `downloading/installing/success/error` 继续通过 Banner 持续显示

### 手动检查只是主动触发通道

- 不替代轮询
- 不改变现有安装逻辑
- 不新增第二套更新状态机

## 接口设计

## 一、新增 Bridge 请求

WebGUI 向 VSCode 插件发送：

```ts
ideBridge.request("checkForUpdates")
```

该请求语义是：

- 强制实时检查
- 不等待轮询
- 不优先读旧缓存结果

## 二、返回结果结构

建议返回结构化结果：

```ts
type CheckForUpdatesResult =
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
```

异常情况（GitHub 失败、release 解析失败、缺少当前平台 VSIX）统一通过 request reject 处理，由 WebGUI toast 提示失败。

## 三、VSCode 侧职责

### `UpdateService`

新增一个手动检查入口，例如：

```ts
checkForUpdates(): Promise<CheckForUpdatesResult>
```

职责：

- 立即调用 checker 查询 GitHub latest release
- 若有更新：
  - 更新内部 `latest`
  - 必要时广播 `updateAvailable`
  - 返回 `status: "available"`
- 若无更新：
  - 返回 `status: "up-to-date"`

### `IdeBridgeServer` / `WebviewController`

新增 handler：

- `checkForUpdates`

由 `WebviewController` 将该 handler 接到 `UpdateService.checkForUpdates()`。

## 四、WebGUI 侧职责

### `UpdateContext`

新增：

```ts
isChecking: boolean
checkForUpdates: () => Promise<void>
```

行为：

- 管理手动检查 loading 状态
- 调用 `ideBridge.request("checkForUpdates")`
- 根据返回结果决定：
  - toast“已是最新版”
  - 打开确认框
  - 调用 `installUpdate(version)`

### `ActionButtons`

负责：

- 在版本号右侧渲染检查更新图标
- 读取 `isChecking`
- 点击时调用 `checkForUpdates()`

### 确认框

复用现有 `ConfirmModal`，不新增新的弹窗组件。

## 状态设计

## 一、手动检查状态与安装状态分离

在 `UpdateContext` 中，新增的 `isChecking` 与现有安装状态分开：

- `isChecking`：只表示“正在手动检查 latest release”
- `status`：仍表示“更新流程状态”，如 `available / downloading / installing / success / error`

这样避免把“检查中”混入安装状态机，保证语义清晰。

## 二、结果一致性

- 手动检查返回 `available` 时：
  - 弹确认框
  - 同时保证 `latest` 已写入 `UpdateContext`
  - 保证 `UpdateBanner` 可见
- 手动检查返回 `up-to-date` 时：
  - 不显示 Banner
  - 只显示 toast

## 测试策略

## 一、WebGUI

至少补这些测试：

### `ActionButtons`

- 渲染版本号右侧检查更新图标
- `isChecking` 时图标按钮 disabled / loading
- 点击图标时调用 `checkForUpdates`

### `UpdateContext`

- `checkForUpdates` 返回 `up-to-date` 时，显示“已是最新版” toast
- `checkForUpdates` 返回 `available` 时，打开确认流程
- 用户确认后调用 `installUpdate(version)`
- `checkForUpdates` reject 时，显示失败 toast

## 二、VSCode 插件

### `UpdateService`

- `checkForUpdates()` 返回 `available`
- `checkForUpdates()` 返回 `up-to-date`
- 手动检查会立刻调用 checker，而不是依赖轮询

### `IdeBridgeServer`

- `checkForUpdates` roundtrip 返回正确结果

## 影响范围

### WebGUI

- `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`
- `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- `packages/opencode/webgui/src/state/UpdateContext.tsx`
- 对应测试文件

### VSCode 插件

- `hosts/vscode-plugin/src/update/UpdateService.ts`
- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- `hosts/vscode-plugin/src/ui/WebviewController.ts`
- 对应测试文件

## 风险与约束

1. **确认框不要和现有 Banner 竞争主导权**：确认框只在手动检查有更新时出现；Banner 负责后续持续状态展示
2. **强制实时检查需要考虑 GitHub 失败**：失败只提示 toast，不应破坏现有更新状态
3. **UI 改动应保持轻量**：版本号行仍应是信息区，而不是新的重操作区

## 成功标准

1. 用户能在右上角菜单版本号右侧找到“检查更新”图标
2. 点击后立即触发实时检查
3. 无更新时明确提示“已是最新版”
4. 有更新时弹确认，确认后进入现有更新流程
5. `UpdateBanner` 仍然保留并承接后续状态
6. 更新相关 WebGUI / VSCode 测试通过
