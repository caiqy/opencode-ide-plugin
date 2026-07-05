本文回答：为什么 WebGUI UI 状态要收敛到 scoped storage，以及 non-git 目录为什么必须按目录派生 project id。

# 状态与存储模型：把“用户偏好”和“项目恢复”分开

WebGUI 的状态不是一种东西。

有些状态属于 opencode 后端，例如 session、message、provider config、agent 执行结果。

有些状态只是 WebGUI 工作台体验，例如主题、打开的 tab、输入草稿、最近选择的 provider/model/agent/variant。

如果后者随意落在 localStorage、宿主 state 或后端 config 里，就会出现两个问题。

第一，不同项目之间容易串状态。

第二，组件会开始直接拼 key、决定存哪里，久了以后没有人知道某个偏好到底归谁管。

scoped storage 的设计目的，是把 WebGUI 自己的 UI 状态收敛到一个明确边界。

这个边界分成 `global`、`workspace`、`mem` 三类 scope。

`global` 表示跨工作区共享的用户偏好。

主题、模型 recent/favorite、快捷短语、更新忽略版本适合放这里。

用户换项目时一般仍希望这些偏好存在。

`workspace` 表示当前项目的可恢复工作台状态。

tabs、drafts、draft session、last selection 属于这一层。

这些状态和项目上下文绑定，换一个目录不应该复用。

`mem` 表示宿主 session 内的瞬态状态。

它适合只在当前 IDE 会话中存在，不承诺跨重启恢复。

分层之后，React 组件不直接访问宿主存储。

组件和 Context 调用 repo；repo 表达资源语义；`scopedStorage` 负责 scope、key 和 bridge fallback；IDE Bridge 再落到 VSCode 或 JetBrains 的宿主存储。

这条链路看起来多一层，但它减少了更大的混乱：组件不需要知道 VSCode 的 `globalState/workspaceState`，也不需要知道 JetBrains 的 `PropertiesComponent`。

repo 层的意义不是抽象“为了好看”，而是给状态一个单一真源。

`tabsRepo` 只表示 WebGUI 工作台打开了哪些 session tab，不删除真实 session。

`draftRepo` 保存输入草稿和可复用 draft session id。

`selectionRepo` 保存 provider/model/agent/variant 的 workspace 最近选择。

这些语义如果散在组件里，后续很难判断一个保存动作是 UI 恢复还是业务数据修改。

non-git 目录隔离是这个模型里最容易低估的点。

IDE 用户经常直接打开一个普通临时目录，而不是 Git 仓库。

如果所有 non-git 目录都坍缩到 `ProjectID.global` 和同一个 workspace 边界，那么 A 目录的 tabs、drafts、selection 会出现在 B 目录里。

这不是简单的显示 bug，而是上下文污染。

用户可能把一个项目的草稿、文件上下文或模型选择带到另一个完全无关的目录。

因此 non-git 普通目录必须按目录派生稳定 project id。

同一个目录重复打开，应恢复同一组 workspace 状态。

不同目录即使都没有 Git，也必须得到不同的 project id。

当前 reference 记录了代码层面的规则：路径归一化后生成 `local_` id，legacy global session 会在运行时迁移。

状态 key 的统一形态是 `opencode:webgui:<scope>:<resource>:v<major>`。

版本号出现在 key 里，是为了让未来结构变化有明确切换点。

但当前策略是硬切，不读取旧 key，不 fallback，不双写，不迁移。

这听起来激进，但它服务于一个维护目标：不要让新状态模型背上多个历史路径。

旧的 `uiGetState/uiSetState`、聚合 `sdk.kv`、旧 global state 如果继续 fallback，会让每个状态读取都变成“到底谁赢”的问题。

硬切让问题暴露得早，也让新代码只有一个方向：`storageGet/storageSet`，显式传 `scope`、`key`、`value`。

这种策略的代价是旧 UI 状态不会被悄悄带过来。

但这些状态主要是 UI 恢复和偏好，不是 session 真数据。

在“少量偏好重设”和“长期维护多套存储路径”之间，当前项目选择了前者。

浏览器开发模式下，bridge 不可用时 `scopedStorage` 会回退到内存缓存；这只是为了让 WebGUI 能在浏览器里跑起来，不是长期持久化承诺。

维护时新增 UI 状态，第一问应该是 scope，而不是 key 名：跨项目共享才是 global，跟项目恢复相关就是 workspace，只在当前宿主会话有效才是 mem。

第二问是有没有现有 repo 能承接语义；如果组件直接调用 `ideBridge.request("storageSet")`，基本就是绕过了模型边界。

更细的 key、repo 和宿主实现见 [scoped-storage reference](../reference/business/scoped-storage.md)。

non-git project id 规则见 [project-identity reference](../reference/business/project-identity.md)。

深度文件清单见 [scoped-storage reference](../reference/business/scoped-storage.md) 与 [packages-opencode 仓库参考](../reference/repositories/packages-opencode.md) 的 WebGUI 模块矩阵。
