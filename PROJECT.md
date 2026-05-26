## Project

**OpenCode IDE Plugin**

基于开源 opencode 项目的 IDE 插件，提供 WebGUI 前端界面 + VSCode/JetBrains 插件包装，让开发者在 IDE 内直接使用 opencode 的 AI 编码能力，与上游原有的 TUI 终端界面并存。

**核心价值：** 上游合并后构建通过且功能不退化——在持续跟进 opencode 上游更新的同时，保证 webgui 和 IDE 插件始终可用。

### 约束

- **上游兼容**: 合并时尽量同时保留上游和 webgui 的逻辑，需要二选一时提出方案让用户选择
- **技术栈**: 前端 React 19 + Vite + Tailwind，VSCode 用 TypeScript，JetBrains 用 Kotlin
- **包管理**: 根目录用 Bun，VSCode 插件用 pnpm，JetBrains 用 Gradle
