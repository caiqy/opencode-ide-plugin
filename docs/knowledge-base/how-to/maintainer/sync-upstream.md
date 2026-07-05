# 合并 opencode 上游

适用：把 upstream opencode 变更合进 IDE fork，并保留下游 WebGUI/IDE 适配。

## 先读风险清单

1. 打开 [upstream-compatibility](../../reference/business/upstream-compatibility.md)（同步风险总览、下游适配点、高风险文件、同步后最低验证）。
3. 打开 `specs/000-existing-capabilities/regression-matrix.md`。
4. 打开 `specs/000-existing-capabilities/validation.md`。

## 识别重叠文件

1. 先列出 upstream merge 涉及的文件。
2. 与 [upstream-compatibility](../../reference/business/upstream-compatibility.md) 的“下游适配点”和“高风险文件”对照。
3. 命中这些区域时，按高风险处理：
   - `/app` 本地 WebGUI 挂载
   - config overlay / patch
   - MCP enable / tool-enable
   - Skill permission overlay
   - Agent 配置热重载
   - Provider / Anthropic SSE 兼容补丁
   - stream timeout auto-retry
   - IDE 附件处理
   - generated image 项目文件
   - 工具安全边界
   - 前台读取优先于后台 diff
   - non-git project identity

## 处理冲突

1. 默认优先同时保留 upstream 逻辑和 IDE fork 适配。
2. 不要直接用上游版本覆盖 fork 适配点。
3. 不要把 fork 旧逻辑整块压过上游新逻辑。
4. 如果两边无法共存，停下让维护者选择，不自行二选一。
5. 冲突解决后，把受影响能力映射到 [能力总索引](../../reference/capabilities-index.md) 的业务文档。

## 最低验证清单

按 [upstream-compatibility](../../reference/business/upstream-compatibility.md) 的“同步后最低验证”逐项检查：

1. `/app` 路由仍存在且顺序正确。
2. WebGUI 能打开、SSE 能连接。
3. IDE bridge 参数能注入并连接。
4. scoped storage 可读写。
5. MCP/Skill 开关仍能显示并调用。
6. 插件内写文件后 IDE 能刷新。
7. `@文件` mention 对文本/PDF/图片/其他二进制分流符合 IDE 场景预期。
8. 切换当前会话时，首屏消息/历史扫描/当前会话 diff 不被后台 diff 抢占。
9. `generate_image` 仍能生成项目内图片附件，并能编辑 readonly/frozen image input array。
10. generated-image 路由和 Markdown/tool attachment 预览都带当前实例目录上下文。
11. VSCode `OPENCODE_UI_VERSION` 与 JetBrains `getExtensionVersion` 仍来自宿主真实版本。
12. JetBrains 空 Marketplace 查询结果不会保留旧 cached update。

## 命令验证

按变更范围从 `specs/000-existing-capabilities/validation.md` 选择命令。

Cross-Client Smoke：

```powershell
# packages/opencode
bun typecheck

# packages/opencode/webgui
bun test:run
bun build

# hosts/vscode-plugin
pnpm run compile

# hosts/jetbrains-plugin
./gradlew.bat unitTest --no-daemon --console=plain
```

如果改到对应 package 的完整行为，升级到该 package 的完整 baseline 命令。

> 待运行时核验：bridge/backend 行为变化后，至少启动一个 IDE host 做手动检查。

## 收尾

1. 在 final summary 里按 validation evidence 格式记录命令和手动场景。
2. 如果发现新的长期适配点，更新 [upstream-compatibility](../../reference/business/upstream-compatibility.md) 和 [packages-opencode 仓库参考](../../reference/repositories/packages-opencode.md)。
3. 如果能力边界变化，更新 [能力总索引](../../reference/capabilities-index.md) 和对应 business 文档。
