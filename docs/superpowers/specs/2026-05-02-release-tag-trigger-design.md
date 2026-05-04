# Release Tag Trigger 设计

## 目标

让 `.github/workflows/release.yml` 支持通过推送 Git tag 自动触发发版，同时继续保留现有 `workflow_dispatch` 手动触发能力。自动触发后的产物范围保持不变，继续包含 VSCode `.vsix` 与 JetBrains/IDEA 插件 `.zip`，并统一上传到同一个 GitHub Release。

## 当前现状

- `release.yml` 目前只启用了 `workflow_dispatch`
- 文件顶部已经保留了被注释掉的 tag 触发样例：
  - `push.tags: ["v*"]`
- `preflight` job 已同时兼容两套版本来源：
  - 手动触发时使用 `github.event.inputs.version`
  - 非手动触发时使用 `GITHUB_REF#refs/tags/`
- `build-vscode` 已会构建多平台 VSCode 插件并上传 artifact
- `build-jetbrains` 已会构建多平台 JetBrains 插件并上传 artifact
- `release` job 已会汇总两类 artifact 并创建 GitHub Release

结论：当前流程主体已经具备“打包 VSCode + IDEA 插件并发版”的能力，缺失点仅为 `release.yml` 的 tag 触发入口未启用。

## 方案对比

### 方案 A：直接在现有 `release.yml` 启用 `push.tags: ["v*"]`（采用）

**做法**

- 保留现有 `workflow_dispatch`
- 新增 `push` 触发器并限制为 `v*` tag

**优点**

- 改动最小
- 完全复用现有 release 构建与上传逻辑
- 与当前 `preflight` 的版本解析逻辑天然匹配
- 满足“通过打 tag 来触发打包发版，包括 IDEA 插件”的需求

**缺点**

- 错误推送符合规则的 tag 时，也会触发 release workflow

### 方案 B：新增独立 tag release workflow（不采用）

**不采用原因**

- 会复制现有 release 逻辑
- 后续维护成本更高

### 方案 C：抽成 `workflow_call` 后由手动与 tag 入口复用（不采用）

**不采用原因**

- 对当前需求来说过重
- 会扩大本次改动面

## 最终设计

### 1. 触发策略

将 `release.yml` 的 `on` 配置调整为同时支持：

- `push.tags: ["v*"]`
- `workflow_dispatch`

其中 `v*` 是唯一新增的自动触发入口，示例：

- `v26.5.2`
- `v26.5.2-rc.1`

不新增额外分支触发，不改变其他 workflow 的职责。

### 2. 版本与 prerelease 语义

保持现有 `preflight` 中的版本规则不变：

- 手动触发：使用 `inputs.version`
- tag 触发：使用 `github.ref` 解析得到 tag 名
- 如果版本字符串包含 `-`，则视为 prerelease

因此：

- `v26.5.2` → 正式版
- `v26.5.2-rc.1` → prerelease

`Create Release` 继续使用解析出的完整 tag 名作为 `tag_name`，不改动 Release 命名、版本注入、artifact 重命名规则。

### 3. VSCode 与 JetBrains 产物行为

保持现有构建矩阵与上传逻辑不变：

- `build-vscode` 继续产出多平台 `.vsix`
- `build-jetbrains` 继续产出多平台 `.zip`
- `release` 继续将两类产物上传到同一个 GitHub Release

这意味着 tag 触发开启后，无需额外改造即可覆盖 IDEA 插件发版需求。

### 4. 改动范围

仅修改：

- `.github/workflows/release.yml`

明确不修改：

- `.github/workflows/publish.yml`
- `.github/workflows/publish-vscode.yml`
- `hosts/jetbrains-plugin/build.gradle.kts`
- VSCode / JetBrains 构建脚本与产物命名逻辑

## 风险与约束

### 风险

1. 符合 `v*` 规则的 tag 一旦被推送，就会触发发版流程
2. 手动触发与 tag 触发并存时，若对同一版本重复操作，可能产生重复发版尝试
3. 若 tag 不符合 `v*` 规则，则不会触发该 workflow

### 约束

- 本次不增加额外的 tag 校验保护逻辑
- 本次不重构 release 流程结构
- 本次不调整现有 artifact 内容、命名或上传位置

## 验证方案

### 静态验证

- 校验 `release.yml` 的 YAML 结构合法
- 确认 `on.push.tags` 与 `workflow_dispatch` 可同时存在

### 行为验证

重点确认以下路径仍然成立：

1. 手动触发仍可使用 `inputs.version`
2. tag 触发时，`preflight` 能正确解析 `refs/tags/<tag>`
3. `build-vscode` 与 `build-jetbrains` 都会继续执行
4. `release` job 继续汇总两类 artifact 创建同一个 Release

### 成功标准

执行：

```bash
git tag v26.5.2
git push origin v26.5.2
```

后，GitHub Actions 自动运行 `release.yml`，并最终产出：

- VSCode `.vsix`
- JetBrains/IDEA 插件 `.zip`
- 对应版本的 GitHub Release

## 实施说明

这是一次最小变更：仅启用现有 workflow 中已经预留的 tag 触发入口，不调整后续 build/release job 的职责分工。

## 备注

根据当前协作约束，本次先写入 spec 文件，不自动创建 git commit；如需我后续提交该文档或代码改动，再由你显式下达提交指令。
