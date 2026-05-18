# WebGUI 测试环境项目路径覆盖设计

## 背景

当前 `.vscode/launch.json` 中的后端调试命令使用 `bun run --cwd packages/opencode ...` 启动，导致后端实例默认目录落在 `packages/opencode`。WebGUI 状态面板中的“路径”来自后端 `/path` 接口返回的 `directory` / `worktree`，因此测试环境会错误显示并绑定到 `D:\Caiqy\Projects\Github\opencode-ide-plugin\packages\opencode`，而不是仓库根目录。

用户希望：

- 默认调试当前仓库根目录
- 仅在测试环境中，允许手动覆盖为其他项目路径
- 正式 `build` / 打包 / 发版不引入这套覆盖逻辑

## 目标

1. 修正默认后端实例目录为 VSCode workspace 根目录。
2. 为 WebGUI dev 测试链路增加可选的项目路径覆盖能力。
3. 未填写覆盖路径时，保持默认仓库根目录行为。
4. `vite build` 与正式产物不受影响。

## 非目标

- 不修改生产构建时的请求路由行为。
- 不为正式运行时增加新的 URL 参数约定。
- 不引入多项目持久化配置或复杂项目选择器。

## 方案对比

### 方案 A（采用）

- 后端 launch 从 workspace 根目录启动，修正默认实例目录。
- WebGUI dev 通过 launch 输入一个可选的“项目路径覆盖”变量。
- Vite dev proxy 在变量存在时，为转发到后端的请求追加 `x-opencode-directory` 请求头。
- 该逻辑仅在 `vite serve` 生效，`vite build` 不启用。

优点：改动集中、风险低、满足“默认正确 + 测试可覆盖 + 正式不受影响”。

### 方案 B（不采用）

- 直接通过修改后端进程 cwd 切换项目。

缺点：源码开发时容易让相对路径、工具链与当前仓库解耦，不稳定。

### 方案 C（不采用）

- 通过浏览器 URL 参数统一驱动所有 API/SSE 请求目录。

缺点：会扩散到前端请求层与 SSE 层，超出本次“测试环境最小改动”范围。

## 设计

### 1. launch.json 调整

保留现有两个调试入口，但调整职责：

- `Backend: source web 4300`
  - 从 workspace 根目录启动
  - 命令改为直接执行 `packages/opencode/src/index.ts`
  - 不再使用 `--cwd packages/opencode`
- `WebGUI: dev`
  - 保持从 `packages/opencode/webgui` 启动 Vite dev
  - 增加一个可选环境变量用于传入测试目录覆盖值

### 2. 覆盖值传递

- 新增一个 launch 输入变量，默认值为 `${workspaceFolder}`。
- 用户需要调试其他项目时，可在启动前改成目标绝对路径。
- 如果输入为空字符串，则视为未覆盖。

建议变量语义：`OPENCODE_DEV_DIRECTORY_OVERRIDE`。

### 3. Vite dev proxy 行为

仅在 `vite.config.ts` 的 `serve` 分支中：

- 读取 `process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE`
- 若存在非空值：
  - 在所有代理到后端的请求上注入 `x-opencode-directory: <override>`
- 若不存在：
  - 不注入该头，后端继续按默认实例目录工作

由于后端实例中间件已支持 `x-opencode-directory`，无需修改后端路由协议。

### 4. 正式环境边界

- `vite build` 不读取、不注入目录覆盖头。
- 正式打包、发版、内嵌 WebGUI 产物不包含该测试逻辑。

## 数据流

### 默认调试当前仓库

1. 后端从 workspace 根目录启动。
2. 请求未携带覆盖头。
3. 后端使用 `process.cwd()` 作为默认目录。
4. `/path` 返回仓库根目录。

### 调试其他项目

1. 用户在 WebGUI dev 启动前输入目标项目绝对路径。
2. Vite dev proxy 为请求注入 `x-opencode-directory`。
3. 后端实例中间件优先读取该 header。
4. `/path`、会话、SSE 等实例请求都绑定到目标项目。

## 错误处理

- 若覆盖路径无效，后端维持现有错误行为，不在本次新增前端兜底 UI。
- 若覆盖值为空，按默认仓库根目录行为处理。

## 验证

1. 使用默认值启动：状态面板“路径”应为仓库根目录。
2. 使用其他绝对路径启动 WebGUI dev：状态面板“路径”应切换到目标项目。
3. 不修改正式 `build` 输出。
4. 现有 Vite 配置测试与受影响测试保持通过。

## 实施范围

- `.vscode/launch.json`
- `packages/opencode/webgui/vite.config.ts`
- 可能新增/调整对应测试

## 风险

- 若 dev proxy 头注入写法不当，可能影响 `/event` 等长连接请求，需要覆盖 SSE 路径。
- 若 launch 输入变量配置不兼容 VSCode `node-terminal`，需要退回到固定 env + 手工修改值的方案。

## 回退策略

- 回退 `launch.json` 到现状。
- 去掉 `vite.config.ts` 中的 dev-only header 注入逻辑。
