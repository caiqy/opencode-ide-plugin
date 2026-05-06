# WebGUI Scoped Storage Repo 化硬切设计

## 背景

现有改造已完成三域存储（`global/workspace/mem`）与 host scoped 协议落地，但架构层仍残留两类问题：

1. WebGUI 存在旧语义入口（`globalState*` 包装、`sdk.kv/model` 聚合），职责边界不清晰。
2. 业务层仍可绕过“资源真源”，增加回流风险。

本设计以“**不考虑改造成本**”为前提，目标是一次性达成可长期维护的分层架构。

---

## 目标与硬约束

### 目标

- 建立清晰分层：`UI -> Domain Repos -> Scoped Storage Infra -> IDE Bridge`。
- 删除旧接口与聚合语义，业务代码仅通过资源仓储（Repo）访问状态。
- 保留 IDE 桥梁多能力（文件、链接、剪贴板等），但存储子协议严格硬切。

### 硬约束（必须满足）

- 不读取旧 key。
- 仅禁止 legacy fallback；允许并要求新真源之间按既定优先级恢复。
- 不做双写。
- 不做迁移。
- 删除并禁止：
  - `globalStateGet/globalStateSet/globalStateGetJSON/globalStateSetJSON`
  - `sdk.kv` / `sdk.model`
  - host legacy storage message：`uiGetState/uiSetState/kv.get/kv.update/model.get/model.update`

---

## 架构设计

```text
UI / Context / Hooks
        ↓
Domain Repositories
(themeRepo / tabsRepo / selectionRepo / modelPrefsRepo / draftRepo)
        ↓
scopedStorage (infra)
        ↓
ideBridge (transport)
```

### 分层职责

#### 1) Scoped Storage Infra（技术层）

建议模块：`scopedStorage.ts`（或 `state/scopedStorage.ts`）

仅提供：

- `get(scope, keys)`
- `set(scope, key, value)`
- `getJSON/setJSON`
- cache / 写失败节流（纯技术性）

禁止：

- 业务 key 常量
- 业务字段拼装
- 业务恢复优先级逻辑

#### 2) Domain Repositories（语义层）

- `themeRepo`（global）
- `modelPrefsRepo`（global:model，仅 recent/favorite）
- `selectionRepo`（workspace:last_selection，含 variant）
- `tabsRepo`（workspace:tabs）
- `draftRepo`（workspace:drafts / workspace:draft_session）

每个 Repo 负责：

- 固定 key + scope + schema
- 业务读写契约（load/save/activate）
- 必要的数据校验

#### 3) UI/Application 层

UI 与 Context 只调用 Repo，不直接接触 key/scope/bridge message。

---

## 真源定义与不变量

### 真源

- `opencode:webgui:global:model:v1`：仅 `{ recent, favorite }`
- `opencode:webgui:workspace:last_selection:v1`：`agent/provider_id/model_id/variant/agent_model_map/updated_at`
- `opencode:webgui:workspace:tabs:v1`：`open_tabs/active_tab`
- `opencode:webgui:workspace:drafts:v1`：`session_id -> draft_text`
- `opencode:webgui:workspace:draft_session:v1`：`string | null`

### 恢复优先级（仅限新真源）

恢复链路固定为：

1. `workspace:last_selection`
2. `global:model.recent`
3. `config.model`
4. providers 首个可用模型

说明：禁止回退到任何 legacy key 或 legacy 协议，但允许在上述新真源内按顺序恢复。

### 会话切换一致性与回滚契约

所有会话切换入口（CommandPalette/Header/Tabs）必须统一调用：
`tabsRepo.activate(sessionId) -> switchSession(sessionId)`。

一致性契约：

1. 成功路径：`active_tab === currentSession.id`。
2. 失败路径：若 `switchSession(sessionId)` 失败，必须把 `active_tab` 回滚到切换前会话 id，`currentSession` 保持原值不变。
3. 若回滚失败，必须上报错误并进入显式异常态，禁止继续以“不一致状态”运行。

### session.deleted 清理约束

收到 `session.deleted` 后必须同步清理三类状态：

1. `tabs.open_tabs` 删除该 `session_id`。
2. 若 `tabs.active_tab` 指向该会话，重选剩余 tab（无剩余则置空）。
3. `drafts[session_id]` 删除。
4. 若 `draft_session === session_id`，则置为 `null`。

清理完成后仍需满足：`active_tab` 与 `currentSession` 一致。

### 不变量

1. `variant` 只能存在 `workspace:last_selection`。
2. `recent/favorite` 只能存在 `global:model`。
3. `active_tab` 的“激活语义”统一由 `tabsRepo.activateTab(sessionId)` 入口驱动；`open_tabs` 持久化流程仅允许做必要一致性校正，不承担跨入口切换编排。
4. 所有会话切换入口（CommandPalette/Header/Tabs）统一调用：
   `tabsRepo.activate(sessionId) -> switchSession(sessionId)`。

---

## Host 协议设计（澄清）

`IdeBridgeServer.ts` 与 `JetBrains IdeBridge.kt` 是 UI↔IDE 总桥梁，允许保留非存储能力（如 `openFile/openUrl/reloadPath/clipboardWrite/ensureAndOpenFile`）。

但**存储子协议**必须严格为：

- `storageGet(scope, keys)`
- `storageSet(scope, key, value)`

并且 legacy storage message 一律 unsupported：

- `uiGetState/uiSetState`
- `kv.get/kv.update`
- `model.get/model.update`

---

## 删除/替换矩阵（最终版）

| 旧符号/旧路径                                | 最终动作             | 新归属                             |
| -------------------------------------------- | -------------------- | ---------------------------------- |
| `globalState*` 旧导出                        | 删除                 | `scopedStorage` + 各 Repo          |
| `sdk.kv` / `sdk.model`                       | 删除                 | `selectionRepo` / `modelPrefsRepo` |
| `uiBridgeState.ts`                           | 删除（已完成，保持） | `tabsRepo/selectionRepo/draftRepo` |
| `lastSelectionStore.ts`                      | 删除（已完成，保持） | `selectionRepo`                    |
| host `uiGetState/uiSetState/kv*/model*` case | 删除并拒绝           | `storageGet/storageSet`            |

---

## 测试与验收标准

### 1) 静态硬切门禁

静态门禁已落地为自动化测试：`packages/opencode/webgui/src/test/legacyStorageGate.test.ts`。

- 执行命令（在 `packages/opencode/webgui`）：`bun run test:run src/test/legacyStorageGate.test.ts`
- 扫描范围：
  - `packages/opencode/webgui/src`
  - `hosts/vscode-plugin/src`
  - `hosts/jetbrains-plugin/src`
- 仅扫描生产代码，排除：`src/test/**`（含 Kotlin `src/test`）、`src/unitTest/**`、`**/*.test.*`、`**/*.spec.*`、`**/__tests__/**`

门禁检索以下任一命中即失败：

- `globalStateGet|globalStateSet|globalStateGetJSON|globalStateSetJSON`
- `sdk.kv|sdk.model`
- `uiGetState|uiSetState|kv.get|kv.update|model.get|model.update`
- legacy keys（如 `opencode_webgui_state_v1`, `opencode_favorite_models_v1`）

### 2) Repo 行为测试

每个 Repo 必有 load/save（或 activate）用例，覆盖 schema 约束与 key/scope 正确性。

### 3) 入口一致性与回滚测试

会话切换入口（CommandPalette/Header/Tabs）需同时验证：

- 成功后 `currentSession.id === workspace:tabs.active_tab`
- `switchSession` 失败时，`active_tab/currentSession` 按契约回滚并恢复一致

### 4) Host 协议测试（双宿主）

- VSCode 与 JetBrains 都必须断言：
  - reject 写路径：`uiSetState`、`kv.update`、`model.update`
  - `global/workspace/mem` 三域路由正确

### 5) 删除事件清理测试

`session.deleted` 后必须验证：

- tabs 清理（`open_tabs`/`active_tab`）
- drafts 清理（`drafts`）
- `draft_session` 清空规则

### 6) 手工回归

- workspace 隔离（selection/tabs/drafts 不串）
- global 共享（theme/modelPrefs 一致）
- mem 非持久（host 会话结束后失效）

---

## 非目标

- 不保留任何 legacy 兼容行为。
- 不提供旧数据迁移。
- 不对历史偏好丢失做补救（属于硬切预期）。

---

## 决策记录

1. `globalState` 作为核心模块概念退役，改为 `scopedStorage + Repos`。
2. `sdk.kv/model` 在 UI 内部彻底移除，不再保留。
3. host 作为总桥梁继续承载非存储消息，但存储协议硬切且仅 scoped。

---

## 验收结论（2026-02-27）

本设计对应实现已按硬切目标完成并通过回归：

1. WebGUI 分层已收敛为 `UI -> Repo -> scopedStorage -> ideBridge`。
2. 旧接口语义已删除：`globalState*`、`sdk.kv`、`sdk.model`。
3. Host 存储协议硬切仅 `storageGet/storageSet(scope, ...)`，并在 VSCode/JetBrains 双宿主补齐 reject 与三域路由断言。
4. 关键一致性契约通过：
   - 会话切换成功一致性
   - 会话切换失败回滚
   - `session.deleted` 清理规则

验收命令结果摘要：

- `packages/opencode/webgui`: `bun run test:run src/test/legacyStorageGate.test.ts` ✅
- `packages/opencode/webgui`: `bun run test:run` ✅
- `hosts/vscode-plugin`: `pnpm run compile && pnpm exec vscode-test --run out/test/test/suite/ideBridgeServer.test.js` ✅
- `hosts/jetbrains-plugin`: `./gradlew unitTest --tests "paviko.opencode.ui.IdeBridgeStorageScopeTest"` ✅
