# JetBrains 空 Marketplace 更新结果视为最新版设计

**日期**: 2026-05-07
**状态**: 设计已确认

## 概述

当前 JetBrains 插件的“检查更新”在 Marketplace 查询结果为空时，会向前端返回失败，最终让 WebGUI 弹出“检查更新失败，请稍后重试”。

结合本机安装包、IDE 日志与 JetBrains Marketplace 公开接口的实际结果，可以确认当前问题的关键不在于“当前版本为空”，而在于：

1. 本机安装包已经是合法的 Marketplace 渠道包，且版本号、插件 ID、vendor 都存在
2. JetBrains IDE 的 `MarketplaceRequests` 已经对 `caiqy.opencode-ui` 发起了查询
3. JetBrains Marketplace 的公开查询结果当前可能返回空列表或不可公开可见结果
4. 现有更新检查实现把这类“无可用更新结果”升级成了异常，而不是“已是最新版”

本次改动目标是收敛这个语义：

- **仅当 Marketplace 明确返回空结果 / 无兼容更新时，视为当前已是最新版**
- **网络错误、SSL 错误、超时、真实元数据损坏等情况仍然视为检查失败**

## 目标

1. JetBrains Marketplace 查询结果为空时，手动检查更新显示“已是最新版”
2. 保持真实异常仍走失败路径，不把网络问题误判成最新版
3. 保持现有前端 `UpdateContext` 的提示语义不回归
4. 通过单元测试覆盖“空结果视为最新版”和“异常仍报错”两类分支

## 不在范围内

- 不修改更新入口 UI
- 不新增“审核中”专用状态或提示文案
- 不修改前端 5 秒 timeout 配置
- 不修改安装更新流程
- 不处理 Marketplace 审核状态识别
- 不处理 JetBrains 平台缓存或同步延迟

## 当前现状与根因

### 1. 当前桥接行为

- `packages/opencode/webgui/src/state/UpdateContext.tsx`
  - `checkForUpdates()` 在 bridge request reject 时统一提示“检查更新失败，请稍后重试”
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - `checkForUpdates` 调用 `session.updateService.checkForUpdates()`
  - 若后端抛错，则 reply error：`checkForUpdates failed: ...`

因此，只要 JetBrains 更新服务把某个分支解释成异常，前端就一定会看到失败 toast。

### 2. 当前更新服务行为

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`
  - `checkForUpdates()` 在 marketplace 渠道下调用 `latestProvider()`
  - `latestProvider()` 最终依赖 `loadLatestMarketplaceUpdate(...)`
  - 该链路会通过反射调用 JetBrains 的 Marketplace 查询 API

现有逻辑已正确处理一种“无更新”情况：

- `MarketplaceLookup.NoUpdate` -> `null` -> `CheckForUpdatesResult.UpToDate`

但实际问题在于：

- 某些 Marketplace 返回“空 / 不公开可见 / 无可用 descriptor”的情况，没有稳定落入 `NoUpdate`
- 这些场景会在 strict fallback 中继续尝试 metadata / descriptor 解析
- 最终被升级成异常，而不是“无更新”

### 3. 已确认的外部证据

本次排查已确认：

1. 本机安装的 `opencode-plugin-26.5.700.jar` 内含：
   - `<id>caiqy.opencode-ui</id>`
   - `<version>26.5.700</version>`
   - `<vendor>Caiqy</vendor>`
   - `distribution.channel=marketplace`
2. `idea.log` 中可见：
   - `MarketplaceRequests - Looking for the last compatible plugin updates for:`
   - `[caiqy.opencode-ui]`
3. 公开接口调用：
   - `https://plugins.jetbrains.com/plugins/list?pluginId=31519` 返回空 `plugin-repository`
   - `https://plugins.jetbrains.com/api/searchPlugins?search=caiqy.opencode-ui` 返回空结果

这说明当前更接近“Marketplace 没有返回可用更新结果”，而不是“当前版本为空”。

## 方案比较

### 方案 A：仅空结果算最新版，真实异常仍报错（采用）

做法：

- 把 JetBrains Marketplace 明确返回的空结果、无兼容更新结果统一归类为 `MarketplaceLookup.NoUpdate`
- 让 `checkForUpdates()` 返回 `CheckForUpdatesResult.UpToDate(currentVersion)`
- 保持网络、SSL、超时、结构损坏等情况继续抛错

优点：

- 精确符合本次需求
- 不掩盖真实故障
- 前端无需新增状态与文案
- 改动面最小，主要集中在 JetBrains 更新服务语义整理

缺点：

- 如果 JetBrains 后续继续用“空结果”表示审核中，也会被显示为“已是最新版”

### 方案 B：所有查不到都算最新版

不采用原因：

- 会吞掉网络故障、SSL 失败、超时等真实错误
- 用户会在网络异常时被误导为已经最新
- 失去后续诊断能力

### 方案 C：新增 `pending-review` 或 `unavailable` 状态

不采用原因：

- 需要扩展 bridge 协议与前端状态机
- 当前没有足够稳定的证据可以可靠区分“空结果”和“审核中”
- 超出本次最小修复范围

## 最终设计

## 一、语义边界

本次明确采用以下规则：

### 视为“已是最新版”

仅限于 JetBrains Marketplace **明确没有返回可用更新** 的情况，例如：

1. `getLastCompatiblePluginUpdateModel(...)` 返回 `null`
2. legacy `getLastCompatiblePluginUpdate(...)` 返回 `null`
3. `loadLastCompatiblePluginUpdate(...)` 返回空列表
4. strict fallback 中“首个兼容更新项不存在”

这些都统一收敛为：

- `MarketplaceLookup.NoUpdate`
- `CheckForUpdatesResult.UpToDate(currentVersion)`

### 仍然视为“检查失败”

以下情况继续保留异常语义：

1. Marketplace 网络错误
2. SSL 握手失败
3. 请求超时 / 读取超时
4. JetBrains API 反射入口不存在
5. 已拿到更新 model，但版本字段缺失
6. metadata / descriptor 结构损坏，无法判定是否存在可用更新

这类情况仍通过 bridge error 传递给前端，继续显示：

- `检查更新失败，请稍后重试`

## 二、JetBrains 更新服务设计

修改位置：

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/update/PluginUpdateService.kt`

### 调整目标

让“空结果”尽早在 update service 内部被识别为正常无更新，而不是继续下钻到 metadata 解析并抛错。

### 设计要点

1. 保持 `MarketplaceLookup` 的 `NoUpdate` / `Available` 二元结构不变
2. 优先把 JetBrains API 返回的 `null` 与空列表稳定映射成 `NoUpdate`
3. 只有在“理论上已经拿到可用更新对象，但对象结构异常”时，才保留异常

### 行为细则

#### modern API

- 若 `getLastCompatiblePluginUpdateModel(...)` 返回非空：
  - 视为 `Available`
- 若返回空：
  - 不直接报错
  - 允许继续进入 strict fallback 做兼容判断

#### strict fallback

- 若 `getLastCompatiblePluginUpdate(...)` 返回 `null`：
  - 直接视为 `NoUpdate`
- 若 `loadLastCompatiblePluginUpdate(...)` 返回空列表：
  - 直接视为 `NoUpdate`
- 若 strict fallback 无法找到“列表接口 / descriptor loader 反射方法”：
  - 仍是异常，因为这是平台 API 兼容性问题
- 若已取到某个候选更新对象，但 `loadPluginDescriptor(...)` 返回 `null`：
  - 本次按“空结果”处理，收敛为 `NoUpdate`
  - 因为这类场景当前更接近“Marketplace 不提供对外可用更新描述”，而不是网络故障

### 保持不变的异常

以下行为不改：

- `updateVersionProvider(update) == null` 仍抛 `Marketplace update version missing`
- 反射调用内部真实抛出的网络 / SSL / timeout 异常仍向上抛

## 三、Bridge 与前端设计

### Bridge

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- 不改协议结构

最终仍维持：

1. 后端返回 `CheckForUpdatesResult.UpToDate` -> bridge reply success
2. 后端抛错 -> bridge reply error

### WebGUI

- `packages/opencode/webgui/src/state/UpdateContext.tsx`
- 不改状态机与提示文案

因此最终用户可见行为是：

1. 空 Marketplace 结果 -> `已是最新版`
2. 真实异常 -> `检查更新失败，请稍后重试`

## 四、测试设计

### JetBrains 单测

主要在：

- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/update/PluginUpdateServiceTest.kt`

新增或调整覆盖：

1. **空列表返回最新版**
   - `marketplaceLookup = { MarketplaceLookup.NoUpdate }`
   - 断言 `checkForUpdates()` 返回 `UpToDate`
2. **descriptor 缺失按无更新处理**
   - 模拟 strict fallback 候选存在但 descriptor 最终为空
   - 断言收敛为 `UpToDate`
3. **网络异常仍抛错**
   - Marketplace lookup 抛 `IllegalStateException("marketplace unavailable")`
   - 断言仍抛异常
4. **版本字段缺失仍抛错**
   - update model 存在但 version 为 `null`
   - 断言仍抛 `Marketplace update version missing`

### Bridge 测试

如有必要，在：

- `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

补一条：

1. `checkForUpdates` 在无更新时通过 bridge 返回 `status = "up-to-date"`

### 前端测试

前端已有相关覆盖：

- `UpdateContext.test.tsx` 已覆盖 `up-to-date` -> `已是最新版`
- `UpdateContext.test.tsx` 已覆盖 request reject -> 失败 toast

本次原则上不需要新增前端测试，除非 bridge 层结果结构有变化。

## 五、风险与缓解

### 风险 1：把某些真实损坏 descriptor 误判成无更新

如果 JetBrains 某些平台版本在存在更新时也返回 `descriptor = null`，本次改动可能会把它当成无更新。

缓解：

- 仅把“候选缺失 / descriptor 缺失”收敛为无更新
- 保留“版本字段缺失”与网络异常为错误
- 用单测明确锁定边界

### 风险 2：不同 IDE 版本的反射路径行为不一致

JetBrains Marketplace API 在不同版本上方法名与行为可能不同。

缓解：

- 不扩大反射面
- 仅调整已有 fallback 的空结果语义
- 保持反射入口缺失时继续报错，避免静默吞掉平台兼容问题

## 六、验收标准

满足以下条件即视为完成：

1. Marketplace 空结果时，JetBrains 插件手动检查更新显示“已是最新版”
2. Marketplace 网络 / SSL / timeout 异常时，仍显示“检查更新失败，请稍后重试”
3. JetBrains 单测覆盖“空结果是最新版”和“异常仍报错”
4. 现有 `UpdateContext` 前端测试语义不回归

## 七、实现摘要

本次实现应是一个最小语义修正：

- 不改前端
- 不改 bridge 协议
- 只修正 JetBrains 更新服务对 Marketplace 空结果的解释

核心原则是：

> **只有空结果算最新版；真实异常仍然算失败。**
