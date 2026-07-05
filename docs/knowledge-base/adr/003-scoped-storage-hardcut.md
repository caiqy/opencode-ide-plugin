# ADR 003: scoped storage 硬切

## 状态

已接受。

## 背景

WebGUI 长期积累过多条 UI 状态持久化路径。
历史路径包括 `uiGetState` / `uiSetState`、聚合 `sdk.kv`、旧 global state 和组件内局部存储。
这些路径对 project、workspace 和全局状态的边界定义不一致。

IDE 插件场景会频繁切换项目目录。
如果 UI key 只按全局维度保存，tabs、drafts、selection、theme 和 provider/model 偏好都可能串项目。
non-git 临时目录尤其容易被归到同一个 global project。

架构已经要求请求携带 `directory` 或 `x-opencode-directory`。
后端也通过 Instance/workspace 维持目录隔离。
前端 UI 状态需要匹配这个隔离模型。

scoped storage 将状态明确分为 `global`、`workspace` 和 `mem`。
业务 repo 只按需要选择作用域。
这让状态归属成为代码契约，而不是调用方临时约定。

## 决策

UI 状态全部迁移到 scoped storage。
采用硬切策略，不做 fallback、不迁移旧 key、不双写旧路径。

新代码必须通过 scoped storage 或基于它的 repo 读写 UI 状态。
旧的 `uiGetState` / `uiSetState`、聚合 `sdk.kv` 和旧 global state 不再作为新状态入口。

需要跨项目共享的偏好放在 `global`。
与当前项目目录绑定的 tabs、drafts、selection 等状态放在 `workspace`。
只在当前页面生命周期内存在的状态放在 `mem`。

non-git 目录隔离是本决策的延伸。
非 Git 普通目录必须按真实目录派生稳定 project id，不能重新合并到 global。

## 后果

存量用户旧 key 数据不迁移。
换 key 后首次加载会使用默认值。
这是有意接受的代价，用来避免继续保留多路径读写。

代码删除了 fallback 和双写复杂度。
状态串项目的问题更容易定位，因为每个 repo 都应声明自己的作用域。

短期会出现部分 UI 偏好重置。
长期收益是状态模型统一，新增能力不再猜测应该写哪个旧入口。

上游同步或重构 WebGUI 状态时，必须保留 scoped storage 的作用域边界。
尤其要防止 non-git 目录重新退回全局身份。
验证时应覆盖至少两个不同目录，其中一个最好是 non-git 普通目录。

## 相关

- [scoped-storage](../reference/business/scoped-storage.md)
- [project-identity](../reference/business/project-identity.md)
