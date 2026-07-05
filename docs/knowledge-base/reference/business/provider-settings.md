# 能力：Provider 设置页

> **象限**：Reference（能力参考）
> **能力编号**：E2（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：**新增**（2026-06-06 `feat(webgui): add provider settings`，早于此的基线 `overview.md` 未收录）

## 代码真源

| 角色 | 文件 |
|------|------|
| 设置页组件 | `packages/opencode/webgui/src/components/settings/ProviderSettingsTab.tsx` |
| 纯逻辑工具 | `packages/opencode/webgui/src/components/settings/providerSettingsUtils.ts` |
| 挂载点 | `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`（`activeTab === "provider"`，默认 tab） |
| 配置读写 | `packages/opencode/webgui/src/lib/api/sdkClient.ts`（`sdk.global.config`） |

> 命名交叉核验（Step 5）：`ProviderSettingsTab` 是设置面板 `TabType` 里的 `"provider"` 分支，`SettingsPanel/index.tsx` 第 24 行 `useState<TabType>("provider")` 确认它是**默认打开的 tab**。

## 意图

让用户在 IDE WebGUI 内集中查看/编辑 Provider 的接口地址、API 密钥与模型白名单，减少手动改配置文件的成本。这是本 fork 为 IDE 场景补的产品化设置层，opencode 全局 config 仍是底层真源。

## 行为契约

- 从远程配置**覆盖**或**合并**更新 Provider：
  - **覆盖更新**会真正替换全局配置，但**保留同名 Provider 的本地接口地址与 API 密钥**——兼顾配置同步与本地密钥安全。
- 模型白名单用自绘下拉选择器，候选来自本地/内置模型目录，**不受当前白名单过滤影响**。
- 已加入白名单的模型自动从候选中排除；仍支持手动输入自定义模型，并过滤不可用的废弃模型。
- 保存只发送**实际变更的字段**（`SettingsPanel/index.tsx` 第 70-78 行的 diff patch），避免不必要的 Instance dispose。

## 边界与约束

- Provider 设置写的是 opencode 全局 config（`sdk.global.config.update`），不是 WebGUI scoped storage。
- 模型白名单的候选目录逻辑集中在 `providerSettingsUtils.ts`；`providerSettingsUtils.test.ts` 锁定其语义，改动候选/排除规则时先看测试。

## 运行时待核验

- [ ] 「覆盖更新保留本地 API key」在真实远程配置合并下的表现（`待运行时核验`：需要一次真实远程 config 覆盖）。
- [ ] 浏览器模式下 Provider 设置页是否隐藏——`GeneralTab`/`AdvancedTab` 已知在浏览器模式隐藏，Provider tab 的浏览器行为需实机确认。

## 相关

- 上游 Provider/Anthropic SSE 兼容补丁：[stream-error-recovery](stream-error-recovery.md)
- 设置面板壳层：[settings-panel](settings-panel.md)
- 模型选择器：[model-selection](model-selection.md)
