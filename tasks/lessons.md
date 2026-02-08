# 经验教训

## 1. 仓库架构：「插件」≠「App」

**犯错场景**：用户说「插件」时，错误地修改了 `packages/app/`。

**正确理解**：

| 用户说的                      | 实际指的                       | 代码位置                    | 技术栈      |
| ----------------------------- | ------------------------------ | --------------------------- | ----------- |
| 插件 / VSCode 插件 / IDE 插件 | VSCode webview 内嵌的前端      | `packages/opencode/webgui/` | **React**   |
| App / Web / Desktop           | OpenCode 官方 Web/Desktop 前端 | `packages/app/`             | **SolidJS** |

**关键区分点**：

- `packages/opencode/webgui/` — React，用 `useRef` / `useEffect` / `useState`
- `packages/app/` — SolidJS，用 `createSignal` / `createEffect` / `createStore`

**规则**：除非用户明确提到 `packages/app` 或 SolidJS 前端，否则「插件」一律指 `packages/opencode/webgui/`。动手前先确认目标目录。

## 2. Windows 长路径是 worktree + monorepo 的天敌

**犯错场景**：在 `.worktrees/merge-upstream-20260207` 下执行 `bun install`，8 个包因路径超 260 字符限制链接失败。

**具体表现**：

- `ENOENT: failed to link package: @octokit/plugin-rest-endpoint-methods@17.0.0 (copyfile)`
- `ENOENT: failed to symlink dependencies for package: ... (symlink)`

**规则**：

- Windows 上 worktree 名称尽量短（如 `merge-up` 而非 `merge-upstream-20260207`）
- 或直接在主仓库操作，避免 worktree 额外路径深度
- 主仓库 `node_modules` 完好时，可通过 **junction 共享 `node_modules`** 绕过（`New-Item -ItemType Junction`）
- **不要用 junction 替代工作目录本身**——bun workspace 解析会穿透 junction 到真实路径，导致所有 workspace symlink 失败

## 3. Windows 上 `rm -rf` 删不掉深层 node_modules

**犯错场景**：`git worktree remove` 和 bash `rm -rf` 均因 `Filename too long` 失败。

**规则**：Windows 上清理深层 `node_modules` 目录，用 **PowerShell**：

```powershell
Remove-Item -Recurse -Force 'path\to\.worktrees'
```

不要依赖 bash 的 `rm -rf`。

## 4. bash 工具中 `cmd /c` 和 `cmd.exe /c` 不可靠

**犯错场景**：尝试用 `cmd /c "subst W: ..."` 和 `cmd.exe /c echo hi` 执行 Windows 命令，输出只有版本头，实际命令未执行。

**规则**：

- 本环境的 bash 工具底层是 Git Bash，`cmd /c` 行为不可预测
- 需要 Windows 原生命令时用 **PowerShell**：`powershell -NoProfile -Command "..."`
- `subst` 盘符映射在 Git Bash 中不可见，不要依赖

## 5. 打包脚本可能依赖不存在的包管理器

**犯错场景**：`build_vscode.bat` 内部调用 `pnpm run compile`，但环境只有 npm/bun，编译步骤静默失败。

**规则**：

- 打包前先确认脚本依赖的包管理器（pnpm/npm/bun）是否可用
- 不确定时**跳过脚本，手动分步执行**：
  ```bash
  npm run compile:production          # 编译
  # 手动复制二进制到 resources/bin/
  npx -y @vscode/vsce package --no-dependencies --out "xxx.vsix"  # 打包
  ```

## 6. `bun run --cwd` 构建只能在依赖完整的目录执行

**犯错场景**：worktree 的 `node_modules` 链接不完整，`bun run --cwd packages/opencode script/build.ts --single` 报 `preload not found "@opentui/solid/preload"`。

**规则**：

- opencode 构建依赖根 `node_modules` 中的 workspace 链接完整
- 如果 worktree 依赖有问题，**在主仓库构建二进制，再复制产物到 worktree 的插件目录**
- 构建命令：`bun run --cwd packages/opencode script/build.ts --single`（`--single` 只构建当前平台）
