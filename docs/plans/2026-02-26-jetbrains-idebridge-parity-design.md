# JetBrains IdeBridge 功能补齐设计

## 背景

对比 VSCode 和 JetBrains 的 IdeBridge 实现，JetBrains 端缺失 5 个前端活跃使用的消息类型，导致复制按钮无效、主题/模型选择不持久、UI 状态丢失等问题。

## 缺失消息对照

| 消息类型         | VSCode | JetBrains | 前端调用位置                                                            |
| ---------------- | ------ | --------- | ----------------------------------------------------------------------- |
| `clipboardWrite` | ✅     | ❌        | `clipboard.ts` — 复制代码块、分享链接                                   |
| `storageGet`     | ✅     | ❌        | `ThemeContext`, `ModelSelector`, `SessionContext`, `lastSelectionStore` |
| `storageSet`     | ✅     | ❌        | 同上                                                                    |
| `uiGetState`     | ✅     | ❌        | `ideBridge.ts` — 获取 UI 状态                                           |
| `uiSetState`     | ✅     | ❌        | `ideBridge.ts` — 保存 UI 状态                                           |

注：`ensureAndOpenFile` 已在本次之前补齐。

## 设计

### 1. clipboardWrite

用 AWT `Toolkit.getDefaultToolkit().systemClipboard` 写入纯文本。不依赖 IntelliJ 特有 API，轻量直接。

收到 `clipboardWrite` 消息后，从 `payload.text` 取文本，写入系统剪贴板，回复 ok。

### 2. storageGet / storageSet

用 `PropertiesComponent.getInstance()` 实现应用级 KV 存储，语义与 VSCode `context.globalState` 一致。

所有 key 加 `opencode.` 前缀避免冲突。

- `storageGet`：接收 `payload.keys` 数组，逐个查询，回复 `{ replyTo, ok, result: { key: value } }`。注意回复用 `result` 字段（非 `payload`），与 VSCode 端格式一致。
- `storageSet`：接收 `payload.key` 和 `payload.value`，写入后回复 ok。

### 3. uiGetState / uiSetState

在 `Session` 数据类中增加 `var uiState: Any? = null` 字段，内存级存储，生命周期跟随 session。

- `uiGetState`：回复 `{ replyTo, ok, payload: { state: session.uiState } }`。
- `uiSetState`：将 `payload.state` 存入 `session.uiState`，回复 ok。

session 销毁时状态自然清除，无需额外清理。

## 改动范围

仅 `IdeBridge.kt` 一个文件：

- `Session` 数据类增加 `uiState` 字段
- `handleSend` 的 `when` 块增加 5 个 case
- 新增 `import`：`java.awt.Toolkit`、`java.awt.datatransfer.StringSelection`、`com.intellij.ide.util.PropertiesComponent`
