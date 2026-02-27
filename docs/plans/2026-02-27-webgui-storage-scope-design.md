# 存储作用域

统一 WebGUI 三域存储与硬切策略。

---

## 说明背景

近期作用域退化为全局后，出现了跨项目串数据问题。  
本次方案统一为三类 scope，并把桥接协议收敛为单一通道。

---

## 明确目标

- ScopedStore 固定支持 `global | workspace | mem`。
- 所有 scope 都有内存镜像，先读写 cache 再走对应后端。
- `global/workspace` 后端为 IDE storage，`mem` 后端为 host 会话内存。
- bridge 仅保留 `storageGet/storageSet`，且 `scope` 显式包含 `mem`。
- 退役 `uiGetState/uiSetState`，不再作为独立状态通道。
- 维持硬切：不读取旧 key、不 fallback、不双写、不迁移。

---

## 划分作用域

### Global

- 用于跨工作区共享配置。
- 典型资源：`theme`、`model`（仅 `recent/favorite`）。

### Workspace

- 用于当前工作区可恢复状态。
- 典型资源：`last_selection`、`tabs`、`drafts`、`draft_session`。

### Mem

- 用于宿主会话内纯瞬态状态，生命周期随 host session 结束。
- 当前阶段允许无固定业务 key，只保留能力与协议位。

---

## 统一命名

命名规范：`opencode:webgui:<scope>:<resource>:v<major>`。  
约束规则：`resource` 名称在不同 scope 间不得复用，禁止跨域同名 key。

当前 key 清单：

- `opencode:webgui:global:theme:v1`
- `opencode:webgui:global:model:v1`
- `opencode:webgui:workspace:last_selection:v1`
- `opencode:webgui:workspace:tabs:v1`
- `opencode:webgui:workspace:drafts:v1`
- `opencode:webgui:workspace:draft_session:v1`

说明：`mem` scope 现阶段无强制业务 key，仅在确认为“纯瞬态、无需跨重启保留”的场景再落地。

---

## 约定结构

### `opencode:webgui:global:model:v1`

```json
{
  "favorite": [],
  "recent": []
}
```

### `opencode:webgui:workspace:last_selection:v1`

```json
{
  "agent": "",
  "provider_id": "",
  "model_id": "",
  "variant": "",
  "agent_model_map": {},
  "updated_at": 0
}
```

### `opencode:webgui:workspace:tabs:v1`

```json
{
  "open_tabs": [],
  "active_tab": ""
}
```

### `opencode:webgui:workspace:drafts:v1`

`session_id -> draft_text` 映射表。  
键为 `session_id`，值为当前草稿文本。

### `opencode:webgui:workspace:draft_session:v1`

值类型：`string | null`。  
语义：当前草稿会话 ID，`null` 表示无激活草稿会话。

---

## 约束行为

- 切换 agent 时，必须通过 `agent_model_map` 恢复模型。
- 收到 `session.deleted` 时，必须同步清理 `drafts` 与 `tabs` 引用。
- 若删除命中当前激活项，必须立即修正 `active_tab`。
- current session 的可恢复真源是 `workspace:tabs:v1.active_tab`。
- `sessionID` 不再单独建立 mem key，统一归并到 `workspace:tabs:v1.active_tab`。

---

## 收敛宿主

宿主统一采用单一存储协议：`storageGet/storageSet(scope, key...)`。  
`scope` 仅允许 `global | workspace | mem`，不再存在独立的 UI 状态通道。

- VSCode：`global/workspace` 路由至 `globalState/workspaceState`，`mem` 路由至 host 会话内存映射。
- JetBrains：`global/workspace` 路由至应用级/项目级 `PropertiesComponent`，`mem` 路由至 host 会话内存映射。
- `uiGetState/uiSetState` 完全退役，不允许新代码继续调用。

---

## 补全退役清单

### Webgui

- `src/lib/ideBridge.ts`
  - 旧点位：`getState/setState`、quiet 分支、`onopen` 初始拉取、`opencode:ui-bridge-state` 事件派发。
  - 替换方案：统一改为 `storageGet/storageSet`，按资源 key 分读写并移除 UI 状态事件通道。
  - 最终动作：删除 `getState/setState` 与事件派发，改造 `onopen` 为按 key hydrate。
- `src/state/uiBridgeState.ts`
  - 旧点位：`uiBridgeHydrate/uiBridgeEnable/uiBridgeUpdate/uiBridgeUpdateDraft/uiBridgeUpdateTabs/uiBridgeUpdateDraftSessionId/uiBridgeSubscribe/uiBridgeSubscribeSelector/uiBridgeDraft/uiBridgeTabs/uiBridgeRestoreDraftSessionId`。
  - 替换方案：按资源拆到 `workspace:last_selection/tabs/drafts/draft_session` 与 scoped store 订阅能力。
  - 最终动作：删除整个 `uiBridgeState.ts` 文件与全部导出 API。
- `src/main.tsx`
  - 旧点位：`opencode:ui-bridge-state` 监听、`uiBridgeHydrate/uiBridgeEnable/uiBridgeRestoreDraftSessionId`。
  - 替换方案：应用启动时直接读取 scoped keys，并由 store 初始化动作接管 hydrate。
  - 最终动作：删除事件监听与 `uiBridge*` 系列入口，改造为 store 初始化流程。
- `src/App.tsx`
  - 旧点位：bridge selections 订阅与 `draftSessionId` 相关调用。
  - 替换方案：改为订阅 `workspace:last_selection`、`workspace:tabs`、`workspace:draft_session`。
  - 最终动作：删除 bridge selections/draftSessionId 依赖，改造为 scoped store 读取。
- `src/components/MessageInput/EditorToolbar.tsx`、`src/components/CompactHeader/SessionDropdown.tsx`、`src/state/useSessionActivation.ts`、`src/components/MessageInput/index.tsx`、`src/components/MessageInput/hooks/useMessageInput.ts`
  - 旧点位：直接调用 `uiBridgeUpdate*` 系列 API。
  - 替换方案：改为写入 scoped store 对应 key。
  - 最终动作：替换全部调用并移除 `uiBridgeState` 依赖。
- `src/state/globalState.ts`
  - 旧点位：`globalStateGet/globalStateSet/globalStateGetJSON/globalStateSetJSON`。
  - 替换方案：统一为 `scopedStateGet/scopedStateSet`（显式 scope）。
  - 最终动作：删除旧 API 导出与旧命名调用点。
- `src/state/lastSelectionStore.ts`
  - 旧点位：直连 `ideBridge.request("storageGet"/"storageSet")`。
  - 替换方案：并入 scoped store 的 `workspace:last_selection` 资源。
  - 最终动作：删除文件与直连请求。

### Hosts/vscode

- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
  - 旧点位：`uiGetState/uiSetState` case 与 `kv.get/kv.update/model.get/model.update` case。
  - 替换方案：仅保留 `storageGet/storageSet` 分支并支持 `global|workspace|mem`。
  - 最终动作：删除上述历史 case。
- `hosts/vscode-plugin/src/ui/WebviewController.ts`
  - 旧点位：UI state options/handlers 透传。
  - 替换方案：只透传 storage 协议参数与响应。
  - 最终动作：删除 UI state 透传字段，改造为 scoped storage 透传。
- `hosts/vscode-plugin/src/ui/WebviewManager.ts` 与 `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`
  - 旧点位：`uiState` 持有与注入。
  - 替换方案：改为 host 会话内 `mem` map 与 IDE storage 路由，不维护聚合 `uiState`。
  - 最终动作：删除 `uiState` 字段与初始化链路。

### Hosts/jetbrains

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - 旧点位：`Session.uiState`、`uiGetState/uiSetState` case、`kv.get/kv.update/model.get/model.update` case。
  - 替换方案：统一走 scoped storage 路由，`mem` 使用 Session 内存映射。
  - 最终动作：删除上述历史字段/分支，仅保留 `storageGet/storageSet`。

---

## 建立改造矩阵

| 旧来源               | 旧 key/入口                                                                   | 新归属                                                           | 动作                                        |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| 主题偏好             | `ThemeContext.tsx` + `globalState`（`opencode:webgui:theme:v1`）              | `opencode:webgui:global:theme:v1`                                | 改造为 scoped global 读写                   |
| 全局模型偏好         | `sdkClient.ts`（`opencode:webgui:model:v1`）                                  | `opencode:webgui:global:model:v1`（仅 `recent/favorite`）        | 迁移并删除 `global:model.variant`           |
| 工作区当前选择       | `sdk.kv` 中 `webgui_agent/webgui_provider/webgui_model/agent_model`           | `opencode:webgui:workspace:last_selection:v1`                    | 下线 `kv` 选择字段，归并到 `last_selection` |
| 最近选择（host直连） | `lastSelectionStore.ts` 直连 `storageGet/Set`（`opencode_last_selection_v1`） | `opencode:webgui:workspace:last_selection:v1`                    | 并入 ScopedStore，移除直连 request          |
| 标签页               | `tabStore.ts` -> `sdk.kv` 中 `webgui_tabs`（存于 `opencode:webgui:kv:v1`）    | `opencode:webgui:workspace:tabs:v1`                              | 下线 `kv.webgui_tabs` 路径                  |
| 草稿集合             | `uiBridgeState.drafts`（经 `uiSetState` 写入 host 会话 `uiState`）            | `opencode:webgui:workspace:drafts:v1`                            | 拆出为 workspace 独立 key                   |
| 当前草稿会话         | `uiBridgeState.draftSessionId` + `opencode:webgui:draft_session:v1`           | `opencode:webgui:workspace:draft_session:v1`                     | 改造 key 命名并统一到 scoped workspace      |
| SDK 聚合             | `sdkClient.ts` 下 `kv` 聚合对象（`opencode:webgui:kv:v1`）                    | 按 `theme/model/last_selection/tabs/drafts/draft_session` 分 key | 下线聚合 `kv`，改为 scoped key API          |

---

## 对齐字段映射

| 历史字段                   | 新归属 key                                | 是否删除 | 行为说明                                |
| -------------------------- | ----------------------------------------- | -------- | --------------------------------------- |
| `v`                        | 无                                        | 是       | 仅用于旧桥接版本标识，硬切删除          |
| `sessionID`                | `workspace:tabs:v1.active_tab`            | 否       | current session 真源改为 `active_tab`   |
| `providerId`               | `workspace:last_selection:v1.provider_id` | 否       | 作为工作区最近模型选择                  |
| `modelId`                  | `workspace:last_selection:v1.model_id`    | 否       | 与 `provider_id` 成对恢复               |
| `agent`                    | `workspace:last_selection:v1.agent`       | 否       | 保留 agent 维度恢复                     |
| `variant`                  | `workspace:last_selection:v1.variant`     | 否       | 仅保留工作区当前选择                    |
| `openTabs`                 | `workspace:tabs:v1.open_tabs`             | 否       | 保留工作区会话列表                      |
| `activeTab`                | `workspace:tabs:v1.active_tab`            | 否       | 唯一激活会话来源                        |
| `drafts`                   | `workspace:drafts:v1`                     | 否       | 映射结构保持 `session_id -> draft_text` |
| `draftSessionId`           | `workspace:draft_session:v1`              | 否       | 独立管理当前草稿会话                    |
| `sessionId`(hydrate 输入)  | 无                                        | 是       | 历史兼容输入字段，硬切删除              |
| `providerID`(hydrate 输入) | 无                                        | 是       | 历史兼容输入字段，硬切删除              |
| `modelID`(hydrate 输入)    | 无                                        | 是       | 历史兼容输入字段，硬切删除              |
| `input`(hydrate 输入)      | 无                                        | 是       | 历史兼容输入字段，硬切删除              |

---

## 统一真源规则

- 恢复优先级：`workspace:last_selection` 先于 `global:model.recent`，workspace 缺失时才回落到 global。
- `active_tab` 只从 `workspace:tabs:v1.active_tab` 恢复，禁止从其他字段推导。
- `draft_session` 只由 `workspace:draft_session:v1` 写入，禁止与 `tabs.active_tab` 双写联动。
- `provider_id/model_id/agent/variant` 的当前选择只写 `workspace:last_selection:v1`。
- `global:model:v1` 仅维护 `recent/favorite`，不再维护 `variant`。

---

## 修正 mem 验收

- 保留约束：`mem` scope 可暂时无固定业务 key。
- 若当前无 mem 业务 key，验收为“mem 路由可用但不参与业务恢复”。
- 若后续引入 mem key，新增验收为“webview reload 后仅恢复 host 会话内 mem 数据”。

---

## 新增移除矩阵

| 历史代码符号                                  | 替代方案                         | 动作             | 验收方式                                |
| --------------------------------------------- | -------------------------------- | ---------------- | --------------------------------------- |
| `uiGetState`                                  | `storageGet(scope,key)`          | 删除             | 全局检索无引用，桥接请求仅剩 storageGet |
| `uiSetState`                                  | `storageSet(scope,key,value)`    | 删除             | 全局检索无引用，桥接请求仅剩 storageSet |
| `getState/setState`(`ideBridge.ts`)           | ScopedStore 资源化 API           | 删除并改造调用方 | 启动与交互不再触发 UI state 事件        |
| `opencode:ui-bridge-state` 事件               | 启动阶段按 key hydrate           | 删除             | `main.tsx` 无监听，运行恢复正常         |
| `uiBridgeHydrate`                             | store 初始化 hydrate             | 删除             | 启动流程仅走 store 初始化入口           |
| `uiBridgeEnable`                              | 默认启用 scoped storage          | 删除             | 不再存在 bridge 开关逻辑                |
| `uiBridgeRestoreDraftSessionId`               | `workspace:draft_session:v1`     | 删除             | 草稿会话恢复仅读写 `draft_session` key  |
| `Session.uiState`(JetBrains)                  | Session mem map + scoped storage | 删除             | Kotlin 侧无 `uiState` 字段              |
| `uiState`(WebviewManager/ActivityBarProvider) | scoped storage 路由              | 删除             | VSCode 侧无 `uiState` 注入链路          |
| `uiBridgeUpdate*` / `uiBridgeSubscribe*`      | scoped store key 读写/订阅       | 删除             | 全局检索无 `uiBridgeState` 相关调用     |
| `globalStateGet/Set/JSON`                     | `scopedStateGet/scopedStateSet`  | 删除             | 全局检索无旧 API 调用与导出             |
| `kv.get/kv.update`(bridge case)               | `storageGet/storageSet(scope)`   | 删除             | hosts 侧无 `kv.*` case                  |
| `model.get/model.update`(bridge case)         | `storageGet/storageSet(scope)`   | 删除             | hosts 侧无 `model.*` case               |
| `sdkClient.ts` 的聚合 `kv`                    | 分资源 scoped key API            | 改造             | 调用点不再经由聚合 `kv` 字段            |

---

## 固定边界

- 不读取旧 key。
- 不做 fallback。
- 不做双写。
- 不做迁移。

升级后旧偏好丢失属于预期，不作为缺陷。

---

## 制定验收

- 切换项目不串数据：`last_selection`、`tabs`、`drafts` 全部隔离。
- 跨项目共享生效：`theme`、`model` 始终全局一致。
- `mem` 数据不落盘，且只在 host 会话内可见。
- 无 mem 业务 key 时，仅验证路由可用且不参与业务恢复。
- 引入 mem 业务 key 后，再验证 Webview reload 的会话内恢复。
- current session 恢复由 `workspace:tabs:v1.active_tab` 驱动。
- VSCode 与 JetBrains 均正确路由 `global/workspace/mem`。

---

## 评估风险

主要风险仍是硬切带来的历史偏好丢失。  
回滚仅支持代码回滚，不提供旧数据回填。
