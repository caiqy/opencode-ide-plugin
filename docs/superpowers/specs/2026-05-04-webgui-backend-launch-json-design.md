# WebGUI 本地开发 backend launch.json 设计

> 日期：2026-05-04
> 状态：待审阅

## 概述

在现有 `.vscode/launch.json` 基础上，追加一个专门用于本仓库本地开发的 backend 启动配置，让开发者可以在 VSCode 中一键以**源码方式**启动 opencode backend，同时避开自己日常使用中的默认 `4096` 端口。

本次新增的 backend 配置固定使用 `4300`，以减少与开发者平时运行的 opencode 实例发生冲突的概率，并避开当前 Windows 机器上的系统排除端口范围。

## 目标

1. 在 VSCode 中提供一个可点击的 backend 启动入口。
2. 启动方式为**源码直接运行**，而不是使用历史构建产物。
3. 端口固定为 `4300`，避开常见的 `4096` 冲突。
4. 与现有 `WebGUI: dev` 配置并存，保持职责清晰。

## 非目标

- 不自动启动前端。
- 不新增 compound 配置。
- 不改为 Bun attach / inspector 调试。
- 不自动探测空闲端口。

## 方案

在 `.vscode/launch.json` 中追加第二个 `node-terminal` 配置：

- 名称：`Backend: source web 4300`
- 类型：`node-terminal`
- 请求：`launch`
- 命令：

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs
```

## 代码来源说明

该配置启动的是当前工作区里的源码：

- 入口：`packages/opencode/src/index.ts`
- 运行方式：`bun run --conditions=browser ...`

因此它使用的是**当前源码状态**，不是某次历史 build 的产物，也不是已安装的全局 `opencode` 二进制。

## 选择理由

- `node-terminal` 最稳定，最接近开发者平时手动在终端执行命令的方式。
- `--print-logs` 能直接把后端日志打印到 VSCode 终端，便于排查。
- 固定 `4300` 比继续使用 `4096` 更适合当前开发场景。

## 不采用的方案

### 方案 A：继续使用 4096

不采用，因为用户已明确说明 `4096` 会和自己日常开发使用的 opencode 冲突。

### 方案 B：自动寻找空闲端口

不采用，因为这会引入额外复杂度，也不利于和前端/浏览器访问地址形成稳定约定。

### 方案 C：只提供 backend 配置，不与 WebGUI dev 并存

不采用，因为当前 `.vscode/launch.json` 已经承载了 WebGUI dev 启动入口，把两个本地开发常用入口放在一起更实用。

## 文件边界

### 修改

- `.vscode/launch.json`

### 不修改

- `.vscode/launch.example.json`
- `.vscode/settings.example.json`
- 任何 `package.json` script

## 验证方式

1. 在 VSCode 打开“运行和调试”。
2. 选择 `Backend: source web 4300`。
3. 点击启动。
4. 确认终端执行：

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4300 --print-logs
```

5. 确认日志中出现本地服务启动信息，且未因 `4096` 冲突失败。

## 结论

本次采用“在正式 `.vscode/launch.json` 中追加一个 `4300` 端口的源码 backend 启动配置”的最小方案，既满足一键启动需求，也明确避开默认端口冲突与系统排除端口范围，同时保持与现有 WebGUI dev 配置的边界清晰。
