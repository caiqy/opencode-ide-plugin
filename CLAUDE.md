# Agent 指南（opencode-ide-plugin）

> 面向本仓库内的 agent 执行规范：优先可验证、小步提交、最小影响。

## 0. 仓库事实（必须先读）

- 工作目录：仓库根目录（`opencode-ide-plugin`）
- 根 `package.json` 的 `test` 会失败（`do not run tests from root`）
- 结论：**不要在仓库根目录运行 `bun test`**
- 自动可执行任务直接做；仅在缺信息/不可逆风险时询问
- 互不依赖步骤必须并行执行（搜索、读取、状态检查）

## 2. 快速启动与构建命令

- 安装依赖：`bun install`
- 全仓类型检查：`bun run typecheck`
- 根目录开发：`bun dev`
- Web 开发：`bun run dev:web`
- Core 开发：`bun run --cwd packages/opencode dev`
- App 构建：`bun run --cwd packages/app build`
- Core 构建：`bun run --cwd packages/opencode build`
- WebGUI 构建：`bun run --cwd packages/opencode/webgui build`

## 3. Lint / Test 命令（重点：单文件、单用例）

### 3.1 packages/opencode（Bun test）

- 全量：`bun run --cwd packages/opencode test`
- 单文件：`bun run --cwd packages/opencode test test/tool/read.test.ts`
- 单用例：`bun run --cwd packages/opencode test test/tool/read.test.ts -t "truncates by line count"`

### 3.2 packages/app 单测（Bun test + happydom）

- 全量：`bun run --cwd packages/app test:unit`
- 单文件：`bun run --cwd packages/app test:unit -- src/context/layout-scroll.test.ts`
- 单用例：`bun run --cwd packages/app test:unit -- src/context/layout-scroll.test.ts -t "session"`

### 3.3 packages/app E2E（Playwright）

- 全量：`bun run --cwd packages/app test:e2e`
- 单文件：`bun run --cwd packages/app test:e2e -- e2e/app/home.spec.ts`
- 单用例：`bun run --cwd packages/app test:e2e -- -g "home"`

### 3.4 packages/opencode/webgui（Vitest）

- Lint：`bun run --cwd packages/opencode/webgui lint`
- 全量：`bun run --cwd packages/opencode/webgui test:run`
- 单文件：`bun run --cwd packages/opencode/webgui test:run -- src/utils/validation.test.ts`
- 单用例：`bun run --cwd packages/opencode/webgui test:run -- src/utils/validation.test.ts -t "valid"`

## 4. 代码风格（必须遵循）

### Imports 与模块

- 使用 TypeScript ESM
- 本地模块优先相对路径；路径别名遵循包内现有模式
- 优先命名导入，删除未使用导入

### Formatting

- 遵循 Prettier：`semi: false`、`printWidth: 120`
- 保持文件既有风格，不做无关格式化噪音

### Types

- 能推断就不写冗余注解
- 避免 `any`，优先精确类型、联合类型、泛型约束
- 输入边界优先 Zod 校验

### 命名

- 变量/函数：简短且可读，必要时才多词
- 类型/组件/类：`PascalCase`
- 常量：`SCREAMING_SNAKE_CASE`

### 控制流与状态

- 优先 `const`，减少可变状态
- 优先早返回，尽量避免 `else`
- 优先 `map/filter/flatMap`，少写样板循环
- SolidJS 场景优先 `createStore`（避免堆叠 `createSignal`）

### 错误处理

- 非必要不写 `try/catch`
- 能在边界处理就不要在深层吞错
- 报错必须包含可行动上下文（路径、参数、边界条件）

## 5. 测试原则

- 测行为，不复制实现细节
- 能不 mock 就不 mock
- 一条测试只验证一个核心结果
- 先写失败用例，再写最小修复
- 修复后先跑最小受影响集合，再逐步扩大
- E2E 优先语义化定位与稳定选择器

## 6. Workflow Orchestration（引入文档）

### Plan Mode Default

- 非 trivial 任务（>=3 步或涉及架构）先进入 plan mode
- 执行偏航时立即停下重规划，不硬推
- 计划必须包含验证步骤，而非只列实现步骤

### Subagent Strategy

- 用子代理分担研究、探索、并行分析
- 复杂问题优先并行拆分，一子任务一代理

### Self-Improvement Loop

- 任何用户纠正都要沉淀为“防再犯规则”
- 复盘后更新经验记录（如 `tasks/lessons.md`）

### Verification Before Done

- 没有证据就不宣称完成
- 必须用测试/日志/行为对比证明正确性

### Demand Elegance（平衡）

- 非 trivial 改动先问：是否存在更优雅方案
- 简单问题避免过度设计

### Autonomous Bug Fixing

- 收到 bug 报告先复现并修复，不把上下文切换成本转给用户
- 先看报错、日志、失败测试，再动手

## 7. 生成物与脚本

- 改动 `packages/opencode/src/server/server.ts` 后执行：`bun run ./script/generate.ts`
- 重建 JavaScript SDK：`./packages/sdk/js/script/build.ts`

## 8. VSCode 插件打包

### 8.1 仓库结构

本仓库包含两个 VSCode 扩展目标：

| 路径                  | 说明                                   |
| --------------------- | -------------------------------------- |
| `hosts/vscode-plugin` | **主扩展**（内嵌 opencode 后端二进制） |
| `sdks/vscode`         | SDK 扩展（独立，一般不需要手动打包）   |

### 8.2 构建依赖链

webgui 的改动需要经过完整链路才能体现在 VSIX 中：

```
packages/opencode/webgui (Vite build)
  → packages/opencode/webgui-dist/  (产物)
  → packages/opencode/src/webgui/embed.generated.ts  (base64 嵌入)
  → packages/opencode/dist/opencode-<platform>/bin/opencode(.exe)  (Bun compile)
  → hosts/vscode-plugin/resources/bin/<os>/<arch>/opencode(.exe)  (复制)
  → hosts/vscode-plugin/*.vsix  (vsce package)
```

### 8.3 一键打包（推荐）

**Windows：**

```bat
.\hosts\scripts\build_vscode.bat --production --skip-tests
```

**macOS / Linux：**

```bash
./hosts/scripts/build_vscode.sh --production --skip-tests
```

可用参数：

- `--production`：生产模式（不带 `--pre-release` 标记）
- `--skip-binaries`：跳过后端二进制编译（已有二进制时使用）
- `--skip-tests`：跳过测试
- `--package-only`：仅打包 VSIX（跳过编译和二进制构建）

### 8.4 手动分步打包（适合只改了 webgui 的场景）

当只修改了 webgui 前端代码，且已有其他平台二进制时，可以只重编当前平台：

```bash
# 1. 重编 opencode 二进制（含 webgui 嵌入），--single 只编译当前平台
bun script/build.ts --single --skip-install
# 工作目录：packages/opencode

# 2. 复制新二进制到插件目录（以 Windows 为例）
cp packages/opencode/dist/opencode-windows-x64/bin/opencode.exe \
   hosts/vscode-plugin/resources/bin/windows/amd64/opencode.exe

# 3. 安装插件依赖 & 编译 TypeScript
npm install          # 工作目录：hosts/vscode-plugin
npx tsc -p ./

# 4. 打包 VSIX
npx vsce package --no-dependencies --out opencode-vscode-dev.vsix
# 工作目录：hosts/vscode-plugin
```

> **注意**：`hosts/vscode-plugin` 使用 pnpm 作为 packageManager，但环境中 pnpm 不可用时 npm 也能正常工作。

### 8.5 二进制路径映射

`build.ts` 输出的 dist 目录名与插件 `resources/bin/` 下的路径映射：

| dist 目录名             | 插件路径                                   |
| ----------------------- | ------------------------------------------ |
| `opencode-windows-x64`  | `resources/bin/windows/amd64/opencode.exe` |
| `opencode-darwin-arm64` | `resources/bin/macos/arm64/opencode`       |
| `opencode-darwin-x64`   | `resources/bin/macos/amd64/opencode`       |
| `opencode-linux-x64`    | `resources/bin/linux/amd64/opencode`       |
| `opencode-linux-arm64`  | `resources/bin/linux/arm64/opencode`       |

### 8.6 安装测试

在 VS Code 中：`Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选择生成的 `.vsix` 文件。

产物位置：`hosts/vscode-plugin/opencode-vscode-*.vsix`

## 9. 交付前最小检查

- 仅修改与任务相关文件
- 受影响包 typecheck 通过
- 受影响测试（至少单文件级）通过
- 文档命令与路径可执行
- 未经用户明确要求，不主动创建 commit
