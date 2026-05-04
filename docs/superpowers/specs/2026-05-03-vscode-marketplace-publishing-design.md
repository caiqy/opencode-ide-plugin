# Release 工作流中的 VSCode Marketplace 自动发布设计

## 目标

在现有 `.github/workflows/release.yml` 中新增 Visual Studio Marketplace 自动发布能力，使 VSCode 扩展在 tag release 或手动 release 时，除了继续产出 GitHub Release `.vsix` 资产外，还会自动把同一批 VSCode 平台包发布到 VSCode 默认扩展商店。

## 约束

- 只发布到 **Visual Studio Marketplace**，不包含 Open VSX。
- 不拆分新的主发布入口，继续复用现有 `release.yml`。
- VSCode Marketplace 发布失败时，整个 `Release` workflow 必须失败。
- 继续复用 `build-vscode` 已构建好的 5 个平台定向 `.vsix`，发布 job 不重新打包。
- 继续使用当前扩展身份：
  - `publisher: caiqy`
  - `name: opencode-ui`
- 继续发布 5 个平台定向包：
  - `win32-x64`
  - `darwin-x64`
  - `darwin-arm64`
  - `linux-x64`
  - `linux-arm64`
- 正式版与预发布版分流：普通版本发布为正式版；带 `-` 的 release 按 pre-release 发布。

## 当前现状

- `.github/workflows/release.yml` 已负责：
  - `preflight`：计算版本、`vscode_version`、`prerelease`
  - `build-vscode`：构建 5 个平台定向 `.vsix`
  - `release`：把 VSCode `.vsix` 和 JetBrains `.zip` 上传到 GitHub Release
- 现有 VSCode 产物已经是平台定向包，使用 `vsce package --target <platform>` 构建。
- 仓库中存在旧的 `.github/workflows/publish-vscode.yml`，但它仍引用过时的 `./sdks/vscode` 路径，不应作为本次实现基础。
- 当前最接近本次需求的已落地模式，是 `release.yml` 中已实现的 `publish-jetbrains-marketplace` job。

## 方案对比

### 方案 A：在现有 `release.yml` 中新增 `publish-vscode-marketplace` job（采用）

做法：

- 新增独立 job：`publish-vscode-marketplace`
- 依赖 `preflight` 与 `build-vscode`
- 下载 `build-vscode` 产出的 5 个 `.vsix` artifact
- 直接调用 `vsce publish --packagePath ...` 发布到 Visual Studio Marketplace

优点：

- 改动最小
- 完全复用现有构建产物
- 与 JetBrains Marketplace 发布结构一致
- 不需要恢复旧的 `publish-vscode.yml`

缺点：

- `release` job 仍可能先成功创建 GitHub Release，随后 Marketplace 发布才失败

### 方案 B：把 VSCode Marketplace 发布设为 `release` job 前置依赖（不采用）

不采用原因：

- 会改变当前 release 主链路顺序
- 会扩大本次改动面
- 若要保持严格一致，通常还需要同步调整 JetBrains Marketplace 的依赖关系

### 方案 C：修复并复用旧的 `publish-vscode.yml`（不采用）

不采用原因：

- 旧 workflow 已与当前仓库结构脱节
- 会引入双入口维护成本
- 与当前已确定的“接入现有 `release.yml`”目标不一致

## 最终设计

### 一、整体架构

在 `.github/workflows/release.yml` 中新增并行 job：

```text
preflight
  ├─ build-vscode
  │    └─ publish-vscode-marketplace
  ├─ build-jetbrains
  │    └─ publish-jetbrains-marketplace
  └─ release
```

其中：

- `build-vscode` 继续只负责构建 5 个平台定向 `.vsix`
- `publish-vscode-marketplace` 只负责把这 5 个现成 `.vsix` 发布到 Visual Studio Marketplace
- `release` 继续只负责 GitHub Release 资产汇总与上传

`publish-vscode-marketplace` 不负责：

- 重新编译后端二进制
- 重新打包 `.vsix`
- 发布 Open VSX
- 创建 GitHub Release

### 二、版本与发布语义

继续复用 `preflight` 已输出的：

- `version`
- `vscode_version`
- `prerelease`

设计要求：

- `build-vscode` 继续把 `vscode_version` 注入 `hosts/vscode-plugin/package.json`
- `publish-vscode-marketplace` 不再自行推导 VSCode 版本，只消费 `preflight.outputs.vscode_version`
- 正式版：不带 `--pre-release`
- 预发布版：带 `--pre-release`

由于 Visual Studio Marketplace 的 pre-release 机制要求扩展版本本身仍是 Marketplace 可接受的普通版本格式，因此发布 job 必须增加一条显式校验：

- `vscode_version` 必须匹配 `major.minor.patch` 数字三段格式

若不满足，发布前直接失败，而不是尝试上传非法版本。

### 三、平台包策略

继续发布以下 5 个平台定向包：

- `win32-x64`
- `darwin-x64`
- `darwin-arm64`
- `linux-x64`
- `linux-arm64`

本次不新增通用 fallback 包。

原因：

- 当前仓库已经明确采用“每个平台一个定向 `.vsix`，每包只带本平台二进制”的策略
- 若再引入通用包，会改变当前分发语义和资源内容，不符合本次最小变更目标

### 四、Workflow 结构

新增 job：

```yaml
publish-vscode-marketplace:
  needs: [preflight, build-vscode]
```

job 步骤应包含：

1. Checkout
2. 安装 Node / pnpm（如果发布命令需要）
3. 安装 `@vscode/vsce`
4. 下载 `vscode-*` artifacts
5. 校验发布 secrets 和产物完整性
6. 逐个发布 5 个 `.vsix`

### 五、Artifact 来源与命名

发布 job 直接下载下列 artifacts：

- `vscode-win32-x64`
- `vscode-darwin-x64`
- `vscode-darwin-arm64`
- `vscode-linux-x64`
- `vscode-linux-arm64`

这些 artifacts 内部的文件已经是可上传的 `.vsix`，因此发布 job 不重新执行：

- `bun script/build.ts`
- TypeScript 编译
- `vsce package`

发布 job 只负责消费现成产物。

### 六、发布命令策略

发布命令使用 `vsce` 直接发布已有 `.vsix`：

- 正式版：`vsce publish --packagePath <vsix>`
- 预发布版：`vsce publish --pre-release --packagePath <vsix>`

每个平台 `.vsix` 单独执行一次 publish。

采用这种方式，而不是在发布时重新附加 `--target` 重新打包，原因是：

- 保证“测试过的包”和“发布出去的包”是同一份文件
- 降低发布阶段与构建阶段行为漂移风险

### 七、发布前校验

在真正执行 `vsce publish` 前，新增轻量防呆校验：

1. `VSCE_PAT` 必须存在
2. 5 个 `.vsix` 文件必须全部存在
3. 5 个平台目标必须完整覆盖预期集合
4. `hosts/vscode-plugin/package.json` 中的 `publisher` 与 `name` 必须分别仍为：
   - `caiqy`
   - `opencode-ui`
5. `.vsix` 内部 manifest 版本必须与 `preflight.outputs.vscode_version` 一致
6. `vscode_version` 必须满足 Marketplace 可接受的数字三段版本格式

这里的目标不是替代完整测试，而是阻止明显错误的包进入 Marketplace。

### 八、Secrets

本次只新增并使用一个 VSCode Marketplace 发布 secret：

- `VSCE_PAT`

本次明确不使用：

- `OPENVSX_TOKEN`

### 九、失败策略

只要任一平台 publish 失败：

- `publish-vscode-marketplace` job 失败
- 整个 `Release` workflow 失败

本次不做以下宽松策略：

- 某个平台失败后继续发布剩余平台
- 自动忽略 Marketplace 失败
- 自动回滚前面已成功发布的平台版本

## 风险与边界

### 风险 1：GitHub Release 可能先成功

由于本次采用并行结构：

- `release` job 可能先完成并创建 GitHub Release
- `publish-vscode-marketplace` 之后才失败

最终结果会是：

- workflow 失败
- 但 GitHub Release 可能已经存在

这是方案 A 的预期行为，不是实现缺陷。

### 风险 2：可能出现部分平台已发布

由于 5 个平台包是逐个 publish 的，可能出现：

- 前几个平台已成功发布
- 后续某个平台失败
- job 终止并失败

本次不引入自动回滚，原因是：

- `vsce` 不提供适合当前场景的安全事务式回滚模型
- 自动 unpublish 或回退风险更高
- 当前目标是先稳定打通自动发布主链路

### 风险 3：预发布版本格式不兼容

Visual Studio Marketplace 对 pre-release 版本格式有额外要求，因此实现必须：

- 始终以 `preflight.outputs.vscode_version` 为唯一版本来源
- 在发布前显式校验版本是否合法

## 验证方案

### 静态验证

- 校验 `release.yml` 的 YAML 结构合法
- 校验新增 job 的 `needs`、artifact 名、secret 名与现有构建输出一致

### 本地/脚本级验证

- 用脚本校验 5 个 artifact 名是否能正确匹配
- 校验 prerelease 条件下发布命令是否会正确附加 `--pre-release`
- 校验 `.vsix` manifest 版本是否与 `vscode_version` 一致

### 远端真实验证

至少验证两轮：

1. 正式版 tag
2. 预发布 tag

预期结果：

- 正式版进入 Visual Studio Marketplace 正式版本
- 预发布版进入 Visual Studio Marketplace pre-release 通道

## 成功标准

1. 推送 `v*` tag 或手动触发 `release.yml`
2. `build-vscode` 继续产出 5 个平台 `.vsix`
3. `publish-vscode-marketplace` 自动下载并发布这 5 个 `.vsix`
4. 正式版 / 预发布版行为符合 `preflight.outputs.prerelease`
5. 任一 Marketplace 发布失败会让整个 workflow 失败
6. 不影响现有 GitHub Release 产物逻辑
7. 不依赖旧的 `.github/workflows/publish-vscode.yml`

## 不在本次范围

- 发布 Open VSX
- 重新设计 VSCode 扩展的分包策略
- 引入通用 fallback `.vsix`
- 自动回滚已成功发布的平台包
- 重构旧的 `.github/workflows/publish-vscode.yml`
