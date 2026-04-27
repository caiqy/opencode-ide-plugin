# 设置、更新与中文本地化

这一页记录 WebGUI 中偏插件产品体验的能力：设置面板、VSCode 更新流、中文本地化。它们大多不是 opencode 底层核心能力，而是本 fork 为 IDE 使用场景补齐的界面和宿主交互。

## 设置面板

关键文件：

- `packages/opencode/webgui/src/components/SettingsPanel/index.tsx`
- `packages/opencode/webgui/src/components/SettingsPanel/hooks/useSettingsForm.ts`
- `packages/opencode/webgui/src/components/settings/GeneralTab.tsx`
- `packages/opencode/webgui/src/components/settings/AdvancedTab.tsx`
- `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.tsx`

职责：

- 读取和保存 opencode 全局配置。
- 展示工作目录、share、snapshot、自动更新等偏好。
- 管理快捷短语。
- 维护未保存变更提示。
- 打开配置文件时通过 IDE bridge 调用宿主文件打开能力。

边界：

- opencode 服务端 config 是底层真源。
- WebGUI 自身的 tabs/drafts/theme/model prefs 不写入 opencode config，而走 scoped storage。

## 快捷短语

关键文件：

- `packages/opencode/webgui/src/state/repo/quickPhraseRepo.ts`
- `packages/opencode/webgui/src/state/repo/quickPhrasePreset.ts`
- `packages/opencode/webgui/src/state/repo/quickPhraseEvent.ts`
- `packages/opencode/webgui/src/components/settings/QuickPhrasesTab.tsx`
- `packages/opencode/webgui/src/components/MessageInput/QuickPhraseBar.tsx`

快捷短语由 preset 和 custom 合并得到。用户可隐藏 preset、调整排序、编辑 custom，并为每条短语选择执行模式：填入输入框、确认后发送或双击发送。`quickPhraseEvent` 用于设置页保存后通知输入区刷新，避免用户必须重载 WebGUI 才能看到变化。

## 模型、Provider 与主题偏好

关键文件：

- `packages/opencode/webgui/src/components/ModelSelector.tsx`
- `packages/opencode/webgui/src/components/AgentSelector.tsx`
- `packages/opencode/webgui/src/components/VariantSelector.tsx`
- `packages/opencode/webgui/src/state/repo/modelPrefsRepo.ts`
- `packages/opencode/webgui/src/state/ProvidersContext.tsx`
- `packages/opencode/webgui/src/state/ThemeContext.tsx`
- `packages/opencode/webgui/src/state/repo/themeRepo.ts`

能力：

- `ModelSelector` 支持 provider/model 搜索、recent/favorite、可用性展示。
- `AgentSelector` 与 `VariantSelector` 参与会话选择恢复链路。
- `modelPrefsRepo` 保存 recent/favorite，并避免并发写覆盖用户最新选择。
- `ProvidersContext` 在 Provider 配置变化后用 dirty flag 通知输入区和 selector 重新拉取 provider/model。
- `ThemeContext` 从 `themeRepo` hydration 后切换 DOM `dark` class，并与 IDE/webview 主题保持一致。

## 全局通知

关键文件：

- `packages/opencode/webgui/src/state/ToastContext.tsx`
- `packages/opencode/webgui/src/components/Toast.tsx`
- `packages/opencode/webgui/src/components/ConfirmModal.tsx`

Toast 是 WebGUI 的全局用户反馈通道：创建会话失败、保存设置失败、更新状态、打开文件失败、附件解析失败、scoped storage 写入失败等都会走这里。ConfirmModal 则服务删除、关闭、危险操作确认。两者属于产品体验层，不应把错误只留在 console 或 SDK 返回值中。

## VSCode 更新流

关键文件：

- WebGUI：`packages/opencode/webgui/src/state/UpdateContext.tsx`
- WebGUI：`packages/opencode/webgui/src/components/UpdateBanner.tsx`
- VSCode：`hosts/vscode-plugin/src/update/`
- VSCode bridge：`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- VSCode webview：`hosts/vscode-plugin/src/ui/WebviewController.ts`

职责划分：

- VSCode 插件后台检查 GitHub Release、下载 `.vsix`、安装更新。
- WebGUI 只展示更新状态、触发检查、触发安装、忽略指定版本。
- 更新状态通过 IDE Bridge 请求和 SSE 推送同步。

Bridge 请求：

- `getExtensionVersion`
- `getUpdateInfo`
- `checkForUpdates`
- `installUpdate`

Host 推送：

- `updateAvailable`
- `downloading`
- `installing`
- `success`
- `error`

JetBrains 当前没有同等更新 API，WebGUI 在 JetBrains 下应视为能力退化。

## 重启入口

WebGUI 通过 `restartHost` 请求宿主执行重启：

- VSCode：`workbench.action.reloadWindow`，`restartMode = "window"`。
- JetBrains：`ApplicationManager.getApplication().restart()`，`restartMode = "ide"`。

UI 应根据 `restartMode` 展示合适文案，避免把 VSCode reload window 与 JetBrains restart IDE 混为一谈。

## 中文本地化

WebGUI 固定中文，不引入 i18n，也不提供语言切换。

本地化范围：

- 按钮、标题、placeholder、tooltip、aria-label。
- Toast 和错误提示。
- 设置页和状态面板。
- 工具展示层的中文名。

约束：

- 专有名词和协议名保留英文，例如 MCP、LSP、Provider、SDK、WebGUI、VSCode、JetBrains。
- 未收录工具可回退原始 tool id。
- 中文化不应改变底层数据结构或协议字段。

## 维护注意点

- 新增设置项时先判断是真 opencode config，还是 WebGUI scoped storage。
- 新增更新相关 UI 时，不要绕过 `UpdateContext` 新建第二套状态机。
- 新增文案时保持中文风格一致，避免中英混杂但保留必要专有名词。
