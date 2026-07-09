---
comet_change: sync-opencode-webgui
role: technical-design
canonical_spec: openspec
---

# 同步 opencode 并保护 WebGUI 的技术设计

## 背景

本 change 将 `ide-plugin` 分支同步到上游 `opencode/dev`，同时保留本 fork 的 IDE-hosted WebGUI。主要风险不只是 merge 冲突，而是上游 server、SDK、event 合同变化后，WebGUI 的 state provider、SDK wrapper 和 IDE bridge 出现静默退化。

需要保护的运行链路是：

1. WebGUI state provider 调用 `sdkClient` 和 bridge helper。
2. `sdkClient` 调用生成的 SDK 方法，或调用本 fork 补充的 endpoint wrapper。
3. opencode server 返回 REST response，并通过 `/event` 推送 SSE message。
4. `SessionContext`、`MessagesContext` 和 bridge 代码把这些 response 转成 session、message、permission、question、provider/model、project/path 和 file reload 行为。

## 构建阶段方案

默认 merge target 是 `opencode/dev`，除非用户在 build 开始前指定其他 ref。合并方式使用普通 `git merge`，保留真实 ancestry，方便后续继续跟进上游。

merge 前先记录当前 baseline commit，并 fetch 上游 refs。随后检查 `ide-plugin..opencode/dev` 的差异热点；不预先建设大型兼容框架。热点检查范围：

- `packages/opencode` 的 server route、生成的 SDK/schema、event definition、session/config/provider/project/path 模块和 build script。
- `packages/opencode/webgui` 的 SDK wrapper、API event type、state provider、message render、permission/question UI path 和 `ideBridge`。
- `hosts/vscode-plugin` 与 `hosts/jetbrains-plugin` 的 bridge hosting、storage/reload 行为、asset embedding 和 packaging 假设。

完成热点检查后，将 `opencode/dev` merge 到 `ide-plugin`。能同时保留双方行为的冲突直接解决；如果上游引入了更好的共享结构，就把本 fork 的 WebGUI 或 IDE bridge 适配挂到新结构上，而不是为了保留旧形状而保留旧形状。

遇到以下情况必须先停下来让用户选择：

- 上游删除或改变 WebGUI 仍依赖的 endpoint/event shape，且小型 adapter 无法保留行为。
- 冲突迫使实现者在上游行为和 IDE bridge 行为之间二选一。
- packaging 变化导致某个 host build 与另一个 host 或上游 opencode output 不兼容。

## WebGUI 兼容审计

冲突解决后，先审计 merge 后的真实代码，再做更宽泛的整理。审计本身就是本 change 的兼容合同。

SDK/API 检查：

- `sdk.session.*` 仍支持列出、创建、更新、删除、选择 session，并发送 prompt。
- `sdk.config.*`、provider/model/agent/variant 加载和持久化 selection fallback 仍可用。
- `sdk.project.*` 与 `sdk.path.*` 仍能加载 WebGUI startup 需要的 project/path context。
- permission 和 question 的 reply/reject route 仍匹配 server 合同。

SSE 检查：

- `/event` 仍按预期认证并维持连接生命周期。
- `message.*`、`session.*`、`permission.*` 和 `question.*` event 仍能映射到 `SessionContext` 与 `MessagesContext`，且没有被上游 payload shape 变化破坏。
- file/edit/tool-result event 仍携带足够 path 数据，用于 host reload 行为。

IDE bridge 检查：

- bridge token 和 URL handling 仍能在 VSCode 与 JetBrains host 中初始化。
- host bridge 可用时，`storageGet` 与 `storageSet` 仍作为 state persistence 路径。
- `write`、`edit`、`apply_patch` tool part 影响文件后，WebGUI 仍发送 `reloadPath`。
- server restart 或 reconnect 期间，bridge reconnect 与 host restart/update flow 仍可容忍中断。

优先把兼容逻辑放在现有 SDK wrapper 或 event translation 代码里。只有多个 call site 都需要同一种 translation 时，才新增独立兼容层。

## 验证策略

采用用户确认的“尽量全量”策略。具体命令由 merge 后仓库脚本决定，但进入 verify 前必须覆盖以下 evidence：

- opencode package：可用的 typecheck、test 和 build。
- WebGUI：typecheck/test/build，以及覆盖 session workflow、streamed message、provider/model selection、permission/question handling 和 IDE bridge path 的定向检查。
- VSCode host：compile/package，或仓库已有的最接近 packaging check。
- JetBrains host：Gradle test/buildPlugin，或仓库已有的最接近 plugin packaging check；Windows 下遵守本仓库的 Gradle 命令约定。

如果上游改变 script 或 build layout，导致某个验证命令失效，则换成仓库支持的最近等价命令，并记录替换原因。除非工具不可用或用户批准，不降级为“只重跑失败点”。

## 完成证据

build 阶段完成需要满足：

1. `opencode/dev` 已 merge 到 `ide-plugin`，或用户已批准其他 target。
2. merge conflict 已解决，且没有未经用户批准的产品取舍。
3. 已基于 merge 后代码记录 WebGUI compatibility audit。
4. 如需兼容修复，修复只限于受影响 call path。
5. 已记录实际可运行的全量验证 evidence，包括任何跳过命令及其原因。

## Spec Patch

无。
