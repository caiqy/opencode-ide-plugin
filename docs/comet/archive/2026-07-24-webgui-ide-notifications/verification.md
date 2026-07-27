# Acceptance evidence

<!-- comet-native:acceptance-evidence:start -->
[
  {
    "acceptance_id": "acceptance-303e6179c0a9d131757c519700deabb2d49438eb1c656ba7de0719cc22b3e7ff",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideNotifications.test.ts",
      "packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx"
    ]
  },
  {
    "acceptance_id": "acceptance-4cc2eca18eb5a5a1916b357c0a277ab7a72201373cc0b728573e61380a7e12fc",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideNotifications.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-614a71038cbb730de7a833e75a8a6f290942815828fdcbf8787205676b84645c",
    "evidence_refs": [
      "hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt",
      "hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml",
      "hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt",
      "hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts"
    ]
  },
  {
    "acceptance_id": "acceptance-61cb4b3e26fa2221a2bc28dcda2ce4f526c36a44a9e4ec307f76148b1fd26a12",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideNotifications.test.ts",
      "packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx"
    ]
  },
  {
    "acceptance_id": "acceptance-7e72996de4757beff2e9e2b0e9e8585b1eca7497690c2e78ace06bab196c0414",
    "evidence_refs": [
      "packages/opencode/webgui/src/lib/ideNotifications.test.ts"
    ]
  }
]
<!-- comet-native:acceptance-evidence:end -->

# Commands and results

- `packages/opencode/webgui: bun run test:run src/lib/ideNotifications.test.ts src/state/MessagesContext.questions.test.tsx`：通过，2 个文件、15 项测试全部通过。
- `packages/opencode/webgui: bun run build`：通过，TypeScript project build 与 Vite production build 成功；仅有既有 chunk size 警告。
- `packages/opencode/webgui: bun x eslint src/lib/ideNotifications.ts src/lib/ideNotifications.test.ts`：通过，无输出。
- `hosts/vscode-plugin: bun run compile`：通过，扩展源码与测试 TypeScript 编译成功。
- `hosts/vscode-plugin: bun -e <IdeBridgeServer showNotification HTTP smoke>`：通过，真实 bridge server 返回 204，并把 `Agent finished` / `Finished working.` 原样映射到 handler。
- `hosts/jetbrains-plugin: PowerShell XML Load + notificationGroup lookup`：通过，plugin.xml 可解析且存在 `OpenCode Notifications` group。
- `git diff --check`：通过，无空白错误；仅报告 Windows 工作树 LF/CRLF 转换警告。
- Runtime 恢复检查：`native-snapshot.js`、`native-build-evidence.js`、`native-verification-scope.js` 均恢复到修改前 SHA-256，临时备份数量为 0。

# Skipped checks

- `hosts/jetbrains-plugin: .\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"` 未完成。默认 Java 8 在 Gradle 配置阶段失败；本机 JDK 17 重试未产生测试结果，JBR 25 与 Gradle 8.13 不兼容，且本机没有项目要求的 Java 21。未将该项记为通过。
- `hosts/vscode-plugin: bun x vscode-test --grep "IdeBridgeServer showNotification"` 未产生 Mocha 测试结果：VS Code 1.74 extension host 以 Windows code 3221225477 崩溃。已用通过的 TypeScript 编译和真实 HTTP bridge smoke 覆盖协议执行路径，未将 GUI host 测试记为通过。
- WebGUI 全仓 ESLint 未作为通过项：现有代码基线有 683 个与本次无关的问题；只对新增独立通知模块执行了定向 ESLint。

# Spec consistency

实现只在 IDE bridge 存在时处理实时 `busy/retry -> idle` 和 `permission.asked`，按实时状态或 request ID 去重，前台当前会话抑制，普通网页版无回退通知。VS Code 与 JetBrains 使用同一 bridge title/body，host 均校验空 payload。没有新增依赖、设置、生成代码或 Server/Protocol API。

# Known limitations and risks

- JetBrains Notification API 的运行测试受本机 Java 21 缺失限制；Kotlin 测试已添加但未执行，当前证据为源码映射审查与 plugin.xml 解析。
- VS Code 1.74 GUI 测试宿主在本机崩溃；真实 HTTP bridge smoke 已覆盖 handler 路由，但未验证 VS Code toast 的最终视觉呈现。
- Comet 对本仓库规模需要临时提高 baseline/implementation evidence 容量；所有全局 Runtime 临时修改均已恢复，产品仓库不包含这些修改。

# Conclusion

基于可运行测试、构建、编译、HTTP bridge smoke 和静态检查，产品实现满足目标规格。平台宿主受限项已明确记录，未伪报通过。
