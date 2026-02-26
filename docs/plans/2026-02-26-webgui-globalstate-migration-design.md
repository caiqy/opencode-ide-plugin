# 状态迁移

统一存储通道，降低状态分散风险。

---

## 1. 说明背景与问题

当前 webgui 运行时代码同时依赖 `localStorage` 与桥接状态，读写路径分散且行为不一致。  
一旦 WebView 上下文变化或 IDE 桥接能力受限，状态恢复与持久化体验会出现割裂。

本次已确认目标是把 `packages/opencode/webgui/src` 内使用 `localStorage` 的能力全部迁移到 `globalState` 语义下的统一适配层。  
历史键不做兼容兜底，不读、不写、不回填旧键。

---

## 2. 明确目标与非目标

**目标**

- 统一存储入口：新增 storage adapter，屏蔽 host `globalState` 与非 IDE 内存态差异。
- 业务改造范围：`SessionContext`、`ThemeContext`、`ModelSelector`、`uiBridgeState`、`sdkClient`。
- SDK API 保持不变：`sdk.model.get/update`、`sdk.kv.get/update` 仅替换底层实现。
- IDE 不可用时可运行：降级为内存 `Map`，会话内可读写，但不持久化。
- 写入失败可感知：提供轻提示，并做去重与节流。

**非目标**

- 不迁移 `packages/opencode/webgui/src` 之外代码。
- 不做历史数据迁移、回填、双写或灰度兼容。
- 不做 `sdkClient` 扩展重构，仅做底层替换。
- 不保留 `useLocalStorage` hook，本次直接删除。

---

## 3. 对比方案与推荐

### 方案 A（推荐）

新增统一 adapter 层，业务与 SDK 仅依赖 adapter 接口。  
IDE 场景走 host `globalState`，非 IDE 场景走内存 `Map`。

**优点**

- 改动集中，业务层改动小且一致。
- API 稳定，外部调用方无感。
- 非 IDE 降级路径清晰，便于测试。

**缺点**

- 需补齐 adapter 错误语义与通知机制。

### 方案 B（业务层直连 ideBridge）

各业务模块直接调用桥接接口并各自处理降级。  
可减少一层抽象，但会把存储细节扩散到多个模块。

**风险**

- 重复逻辑多，后续维护成本高。
- 错误处理口径不统一。

### 方案 C（保留 localStorage 兜底）

继续读取旧键并与新通道并存。  
短期迁移成本低，但与“彻底切断旧键”决策冲突。

**风险**

- 行为不可预测，长期技术债扩大。
- 难以确认单一真实数据源。

**结论**

采用方案 A。  
它最符合“统一入口、无历史兼容、最小业务扰动”的已确认决策。

---

## 4. 定义最终设计

### 架构分层

1. **Storage adapter 层**：提供 `get/set/remove` 与命名空间访问，封装 host 与内存后端。
2. **SDK façade 层**：`sdk.model.*`、`sdk.kv.*` 保持现有 API，仅改为调用 adapter。
3. **业务消费层**：`SessionContext`、`ThemeContext`、`ModelSelector`、`uiBridgeState`、`sdkClient` 通过 SDK 或 adapter 读写。

### 组件职责

- **host 后端**：优先使用 IDE 可用的 `globalState` 通道，负责跨重载持久化。
- **memory 后端**：`Map` 进程内存态，IDE 不可用时启用，不跨刷新保留。
- **adapter**：统一键规范、序列化、错误映射与失败上报。
- **notify 模块**：承接写失败轻提示，做去重节流。

### 改动边界

- 仅修改 `packages/opencode/webgui/src` 运行时代码与其直接测试。
- 不改协议层语义，不新增 `sdkClient` 对外接口。

---

## 5. 规范键名与数据模型

### 新键名规范

统一采用新前缀：`opencode:webgui:<domain>:<name>`。  
域内键名稳定、可读、可扩展，禁止继续写入任何旧格式键。

### 旧键彻底废弃

以下键族全部废弃，且本次不迁移不回填：

- `opencode_webgui_*`
- `opencode_favorite_models_v1`
- `oc-webgui-theme`
- `opencode_selected_*`

### 数据模型约束

- 值统一按 JSON 序列化存储，读取失败按“缺省值”处理。
- 每个键有明确默认值与版本字段（如需要），避免隐式结构推断。

---

## 6. 梳理数据流

### 启动读取

1. 初始化 adapter，探测 IDE bridge 可用性。
2. 可用则绑定 host `globalState` 后端，不可用则绑定 memory 后端。
3. 各业务模块通过 SDK/adapter 拉取键值，拿不到即使用默认值。

### 运行时写入

1. 业务状态变化后调用 `sdk.model.update` 或 `sdk.kv.update`。
2. SDK 转发到 adapter，adapter 写入当前后端并返回结果。
3. 写入成功仅更新本地状态，不触发额外提示。

### 非 IDE 降级

- `ideBridge` 不可用时仅写入内存 `Map`。
- 页面刷新或进程重建后状态丢失，属于预期行为。

---

## 7. 处理错误与提示

### 写失败处理

- adapter 写入失败时返回统一错误结果，不抛散到业务层。
- 业务层继续保留内存中的当前 UI 状态，避免交互中断。

### 轻提示策略

- 展示轻量 toast，例如“设置未保存，请稍后重试”。
- 同类错误按键名+错误类型去重，并在时间窗内节流（如 3 秒最多一次）。

### 观测建议

- 开发环境输出 debug 日志，生产环境仅保留必要告警。
- 不上报敏感值，仅上报键名与错误类别。

---

## 8. 规划测试计划

仅覆盖运行时路径，不做历史兼容测试。  
测试重点放在 adapter、SDK 转发与关键业务读写链路。

**必测用例**

- IDE 可用：启动读取成功，写入持久化成功。
- IDE 不可用：自动降级 memory，刷新后不保留。
- 写入失败：返回失败结果并触发一次轻提示。
- 去重节流：短时间连续失败不重复刷屏。
- 键名隔离：不会访问任何旧键模式。
- `useLocalStorage` 已删除：全仓运行时代码无该 hook 引用。
- `sdk.model.*`、`sdk.kv.*` API 形态不变且行为正确。

---

## 9. 拆解实施步骤与验收标准

### 实施步骤

1. 新建 storage adapter（host + memory）与统一错误类型。
2. 替换 `sdk.model.get/update`、`sdk.kv.get/update` 底层实现到 adapter。
3. 改造 `SessionContext`、`ThemeContext`、`ModelSelector`、`uiBridgeState`、`sdkClient` 的读写入口。
4. 删除 `useLocalStorage` hook 及其引用。
5. 补齐运行时测试并修正文档注释。

### 验收标准

- 运行时代码中不再出现 `localStorage` 读写。
- 旧键不被读取、不被写入、不被回填。
- IDE 可用时具备持久化，IDE 不可用时仅内存态。
- 写失败有轻提示且具备去重节流。
- SDK 相关 API 名称与调用方式保持不变。

---

## 10. 评估风险与回滚策略

### 主要风险

- 某些业务键默认值定义不完整，导致启动态异常。
- 降级路径遗漏会让非 IDE 场景出现空状态或报错。
- 提示节流配置不当可能造成用户感知不足或提示过多。

### 缓解措施

- 在 adapter 层集中定义键与默认值，并加启动自检。
- 用测试覆盖 IDE/非 IDE 双路径与失败路径。
- 先用保守节流参数上线，再依据反馈微调。

### 回滚策略

- 保留迁移前单分支快照，必要时整体回退本次改动。
- 回滚仅恢复新实现前状态，不引入旧键兼容逻辑。
