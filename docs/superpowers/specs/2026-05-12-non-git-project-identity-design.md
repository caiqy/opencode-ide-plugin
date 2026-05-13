# non-git 项目身份与 worktree 语义重构设计

## 背景

当前 `Project.fromDirectory()` 在找不到 `.git` 时，会把普通目录项目退化为：

- `project.id = ProjectID.global`
- `worktree = "/"`
- `sandbox = "/"`

这带来两个层面的语义耦合：

1. **身份耦合**：所有 non-git 目录共享同一个 `global` 项目身份。
2. **路径耦合**：`"/"` 被当作 non-git 项目的假根哨兵，而不是真实项目根。

该设计会导致：

- `generate_image` 等依赖 `Instance.worktree` 的项目内产物被写到错误位置。
- generated-image 读取路由与实际项目目录脱节。
- 配置向上发现可能越过当前目录，继续扫到盘符根级 `.opencode`。
- 不同 non-git 目录的 session 共享同一个 `project_id = global`，导致项目归属与展示失真。

## 目标

- 为每个 non-git 目录建立**独立且稳定**的项目身份。
- 让 non-git 项目的 `worktree` / `sandbox` 与真实目录一致。
- 修复所有依赖 `Instance.worktree` 的项目内产物落点问题。
- 迁移历史 `project_id = global` 的 non-git session，避免会话丢失或错挂。
- 清理基于 `worktree === "/"` 的 non-git 哨兵判断。

## 非目标

- 不改变 git / git worktree 项目的身份生成规则。
- 不改造 `ProjectID.global` 在真正全局控制面语义中的用途。
- 不在本次设计中引入“外部聚合展示的 non-git 项目分组”能力。

## 当前问题总结

### 1. non-git 目录共享 `ProjectID.global`

`packages/opencode/src/project/project.ts` 在 `!dotgit` 时直接返回 `ProjectID.global`。这意味着所有 non-git 目录在持久化层被当作同一个项目。

### 2. `worktree = "/"` 是假根哨兵

`packages/opencode/src/project/instance.ts`、`packages/opencode/src/lsp/lsp.ts` 等位置把 `worktree === "/"` 当作 non-git 判定信号，而不是把它当作真实目录。

### 3. 路径语义与身份语义分裂

如果只把 non-git 的 `worktree` 改成真实目录，但继续保留 `ProjectID.global`，会变成：

- 身份上仍是共享 global
- 路径上却像独立项目

这会让 project 表中的 `global.worktree` 漂移成“最后一次打开的 non-git 目录”，造成 session/project 关联失真。

## 方案比较

### 方案 A（选中）：彻底去掉 `ProjectID.global` 作为 non-git 身份

#### 做法

- non-git 目录不再返回 `ProjectID.global`。
- 为每个 non-git 目录生成稳定 `ProjectID`。
- `worktree = directory`。
- `sandbox = directory`。

#### 优点

- 身份、路径、产物根目录完全一致。
- non-git 会话按目录彻底隔离。
- 后续维护最清晰，不再依赖 `"/"` 哨兵。

#### 缺点

- 改动面最大。
- 需要处理历史 `project_id = global` session 迁移。

### 方案 B：保留 `ProjectID.global` 但 non-git 不再使用它

这是一个过渡性方案：逻辑上更温和，但系统中会长期并存 legacy `global` 与新 non-git 身份，复杂度更高。

### 方案 C：继续保留共享 global，仅靠额外 directory 维度补丁隔离

不推荐。它会继续保留“身份共享、路径独立”的分裂语义，只是堆更多补丁。

## 最终设计

### 1. non-git 项目身份模型

#### 核心规则

- `Project.fromDirectory(directory)` 在找不到 `.git` 时，不再返回 `ProjectID.global`。
- 改为返回基于目录稳定派生的 `ProjectID`。

#### 建议 ID 形式

使用规范化后的绝对路径派生稳定 id，例如：

- `local_<hash(normalized_directory)>`

要求：

- 同一目录多次打开得到同一个 id。
- 不同目录得到不同 id。
- 与 git 项目当前的 commit-root 派生 id 不冲突。
- Windows 下路径大小写、分隔符、尾部斜杠需统一规范化后再 hash。

### 2. non-git `worktree` / `sandbox` 语义

在 non-git 场景下：

- `worktree = directory`
- `sandbox = directory`

这样 non-git 项目的根目录即为当前目录本身，所有依赖 `Instance.worktree` 的项目内行为都会自然落到该目录下的 `.opencode/`。

### 3. `ProjectID.global` 的新定位

`ProjectID.global` 不再由 `Project.fromDirectory()` 用于普通 non-git 项目发现。

它仅保留给真正的全局控制面/兼容语义使用，不再承担“所有 non-git 项目的共享桶”职责。

## 历史数据迁移

### 迁移目标

把历史上：

- `project_id = global`

且实际属于普通 non-git 目录的 session，迁移到按目录稳定生成的新 `ProjectID`。

### 迁移依据

按 session 自身记录的：

- `session.directory`

重新归属，而不是按当前打开目录猜测。

### 一次性 migration 逻辑

1. 扫描 `session` 表中所有 `project_id = global` 的记录。
2. 按 `session.directory` 分组。
3. 对每个目录：
   - 生成稳定 non-git `ProjectID`
   - 在 `project` 表插入/更新对应记录
   - 将该目录下的 session 全部改到新 `project_id`

### 运行时兜底

除了数据库 migration，保留运行时兜底逻辑：

- 当 `fromDirectory(directory)` 解析出新的 non-git project 时
- 如果该目录下仍存在 legacy `project_id = global` session
- 运行时自动把这批 session 迁移到新的目录级 `ProjectID`

补充约束：由于当前 Bun/SQLite 环境无法在纯 SQL migration 中复现 `ProjectID.nonGit()` 的哈希算法，目录级 project 的创建与 session 改绑继续由运行时 / 启动期代码完成；数据库层只负责在最后一个 legacy `global` session 被改绑后清理孤立的 `project.id = global` 占位行，避免 `Project.list()` 与 `/project` 残留歧义项。

### 迁移要求

- 幂等：重复运行不会造成重复迁移或损坏数据。
- 只迁移 non-git 目录对应的 legacy session。
- 不影响现有 git 项目 session。

## 受影响模块与改动方向

### A. `project`

#### `packages/opencode/src/project/schema.ts`

- 保留 `ProjectID.global`
- 新增 non-git 稳定 `ProjectID` 派生 helper

#### `packages/opencode/src/project/project.ts`

- 重写 `!dotgit` fallback
- 为 non-git 返回目录级稳定 id
- 设置 `worktree = directory`、`sandbox = directory`
- 加入 legacy global session 迁移兜底

### B. `instance`

#### `packages/opencode/src/project/instance.ts`

- 去掉 `worktree === "/"` 特判
- `containsPath()` 直接依据真实 `directory` / `worktree` 工作
- 更新注释，不再把 `"/"` 描述为 non-git 哨兵

### C. `session`

#### `packages/opencode/src/session/session.ts`

- `list()`、`listGlobal()` 会自然受益于新的 project 关联
- 需要验证 legacy `global` session 迁移后，列表关联与展示不失真

#### 数据库 migration

- 新增迁移脚本，把 legacy global non-git session 拆到目录级项目下

### D. `config`

#### `packages/opencode/src/config/paths.ts`

- upward search 的 `stop = worktree` 逻辑保留
- 但由于 non-git `worktree = directory`，配置发现边界会收敛到当前目录

这意味着：

- 不再继续扫到盘符根级 `.opencode`
- 父目录继承行为是否保留，需要按最终产品策略明确；本设计默认收敛到当前 non-git 项目目录边界

### E. 项目内产物链路

以下模块主要依赖 `Instance.worktree`，本次无需特殊分叉，只需吃到新语义：

- `packages/opencode/src/tool/generate-image.ts`
- `packages/opencode/src/server/routes/instance/generated-image.ts`
- `packages/opencode/src/session/session.ts`（plans）
- `packages/opencode/src/snapshot/index.ts`

### F. 旧哨兵消费者

必须复核并改掉依赖 `worktree === "/"` 的判断：

- `packages/opencode/src/lsp/lsp.ts`
- `packages/opencode/src/plugin/install.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- 其他 grep 到的相关位置

这些地方需要改成基于更明确的语义判断，例如：

- `project.vcs`
- 新的 non-git / git helper

而不是继续靠路径哨兵值。

## 验证与回归测试

### 1. non-git 身份稳定性

- 同一 non-git 目录重复打开，得到相同 `ProjectID`
- 不同 non-git 目录得到不同 `ProjectID`
- `project.current`、`project.list`、session.project 关联正确

### 2. 历史 `global` session 迁移

- 不同目录的 legacy global session 被拆分到不同 project
- 相同目录的 legacy global session 归到同一个 project
- migration 幂等
- `listGlobal()` / `project.list()` 展示一致
- 若某个 `global` project 行已不再被任何 session 引用，`Project.list()` / `/project` 不应再返回它

### 3. 图片与项目内产物

#### non-git

- generated image 写入 `directory/.opencode/generated-images`
- `/generated-image` 读取成功
- edit 输入相对路径解析正确
- plans 路径位于当前 non-git 项目目录边界内

#### git

- 仍写入仓库根 `.opencode/generated-images`
- 从仓库子目录打开时，产物仍归仓库根

### 4. 配置发现边界

#### non-git

- 当前目录 `opencode.json`
- 当前目录 `.opencode/opencode.json`
- 不再继续扫到盘符根 `D:\.opencode`

#### git

- 仍在 worktree 边界内正常向上发现

### 5. 权限边界

- `Instance.containsPath()` 在 non-git 下正确区分目录内外
- `external_directory`、`read`、`write`、`edit`、`bash` 等工具行为不回归

### 6. LSP / watcher / plugin

- 删除 `"/"` 哨兵后，non-git 不被误判为 git 项目
- git 项目的 watcher、LSP root、plugin patch dir 保持原有语义

## 风险评估

### 高风险

- 历史 session 迁移正确性
- 配置发现边界变化
- legacy `global` 展示语义切换

### 中风险

- `worktree === "/"` 消费者遗漏
- non-git 下工具标题与相对路径展示变化

### 低风险

- 真正的 git / git worktree 项目
- generated-image 主链路（属于明确收益）

## 实施顺序建议

1. 先补测试：身份稳定性、non-git 图片路径、legacy global 迁移、配置边界
2. 改 non-git 身份模型与 `worktree/sandbox` 语义
3. 加入数据库 migration 与运行时兜底迁移
4. 清理所有 `"/"` 哨兵消费者
5. 运行全量相关回归测试

## 最终结论

本次重构应当把 non-git 项目从“共享 global 身份 + 假根哨兵路径”切换为“按目录稳定建模的真实项目”。

只改 `worktree` 而不改身份模型会导致语义继续分裂；因此本设计明确采用：

- **每个 non-git 目录都有独立稳定 `ProjectID`**
- **`worktree = directory`，`sandbox = directory`**
- **`ProjectID.global` 退出普通 non-git 项目发现流程**

这是唯一能同时统一身份、路径、产物、历史会话归属的方案。
