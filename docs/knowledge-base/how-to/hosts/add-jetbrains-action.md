# 新增 JetBrains 右键 action

适用：在 JetBrains 插件里新增 Project View 或 Editor 右键 action。

## 先确认入口

1. 打开 [context-insertion](../../reference/business/context-insertion.md) 或 [host-actions](../../reference/business/host-actions.md)。
2. 查 [hosts-jetbrains-plugin 仓库参考](../../reference/repositories/hosts-jetbrains-plugin.md) 的 action / `plugin.xml` 注册约定。
3. 对照 [CONVENTIONS](../../../../CONVENTIONS.md) 的通用 Kotlin/宿主约定。

## 新增 Kotlin action

1. 在 `hosts/jetbrains-plugin/src/main/kotlin/**/opencode/actions/` 新增 action。
2. 先复用现有 action 的构造、`update` 可见性和 `actionPerformed` 模式。
3. Project View 相关能力参考 `ProjectAddToContextAction` / `ProjectPastePathAction`。
4. Editor 相关能力参考 `EditorAddToContextAction` / `EditorAddLinesToContextAction`。
5. 路径插入或 WebGUI 通信优先复用现有 `PathInserter` / `IdeBridge`。

## 同步 plugin.xml

1. 打开 `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`。
2. 增加对应 `<action>` 声明。
3. 设置 action id、class、text、description。
4. 放到正确 group，例如 project view popup 或 editor popup。
5. 需要快捷键时，同步 `<keyboard-shortcut>`。

## 选择测试层级

1. 纯 Kotlin、纯 JVM、Swing/AWT、lambda 注入或 mock 能隔离的逻辑，放 `src/unitTest/kotlin/`。
2. 需要真实 IntelliJ sandbox、`ApplicationManager`、ToolWindow、JCEF、VFS 或 editor 打开流程的测试，放 `src/test/kotlin/`。
3. 不要为了“一条命令跑完”把轻量测试塞进 `test`。
4. 混合场景拆成 `unitTest` 和 `test` 两条验证。

## 写测试

1. 优先给 action 的路径解析、可见性条件或 payload 组装写 `unitTest`。
2. 只在必须验证 IDE 平台生命周期时写 `test`。
3. 覆盖无 project、无 selection、目录/文件混选等边界。
4. 如果 action 只转发到 WebGUI，测试 payload 即可，不必启动 JCEF。
5. 如果 action 修改文件或 IDE 状态，先确认失败路径不会静默吞掉错误。

## 手动检查

1. 在支持的 JetBrains IDE 中打开 OpenCode tool window。
2. 在 Project View 或 Editor 右键菜单触发新增 action。
3. 确认 WebGUI 输入框或目标能力收到数据。
4. 如果依赖 JCEF 或真实 ToolWindow，记录 IDE 版本与结果。

> 待运行时核验：action group、菜单位置和快捷键冲突需在 IDE 中确认。

## 验证

Working directory: `hosts/jetbrains-plugin`

```powershell
./gradlew.bat unitTest --no-daemon --console=plain
./gradlew.bat build --no-daemon --console=plain
```

如果新增了必须跑 sandbox 的测试，再按具体类名运行 `test`，仍追加 `--no-daemon --console=plain`。

如果出现 daemon 卡住或 Windows 文件锁：

```powershell
./gradlew.bat --stop
```

## 收尾

1. 更新相关 [business 文档](../../reference/business/)。
2. 如果 VSCode 也需要同等入口，同步补 [新增 VSCode 右键命令](add-vscode-command.md)。
3. 如果 action 需要新 bridge 消息，按 [新增 IDE bridge 消息](../frontend/add-ide-bridge-message.md) 处理。
