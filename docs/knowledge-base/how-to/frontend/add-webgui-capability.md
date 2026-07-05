# 给 WebGUI 加一个新能力

适用：在 `packages/opencode/webgui` 增加组件、hook、状态或 WebGUI 调用后端能力。

## 先定位能力

1. 先查 [能力总索引](../../reference/capabilities-index.md)，确认这是新增能力还是已有能力的扩展。
2. 打开相关业务文档，例如：
   - [session-chat](../../reference/business/session-chat.md)
   - [message-input](../../reference/business/message-input.md)
   - [status-panel](../../reference/business/status-panel.md)
   - [scoped-storage](../../reference/business/scoped-storage.md)
   - [settings-panel](../../reference/business/settings-panel.md)
3. 如果没有对应业务文档，先在索引中新增能力条目，再补 `reference/business/*.md`。
4. 对照 [CONVENTIONS](../../../../CONVENTIONS.md) 的 WebGUI 命名、导入和错误处理约定。

## 判断状态归属

1. 先问：这个状态是否属于 opencode 后端配置？
2. 属于后端配置时，走 opencode config / API，不要只存在浏览器本地。
3. 属于 UI 偏好、草稿、tab、主题或宿主 workspace 状态时，使用 scoped storage。
4. scoped storage 相关能力见 [scoped-storage](../../reference/business/scoped-storage.md)。
5. 只在当前运行期需要、刷新后可丢失的状态，才放 mem scope 或 React state。

## 按现有分层落代码

1. 组件放到 `src/components/**`，文件名用 PascalCase。
2. hook 放到 `src/hooks/**` 或组件局部目录，使用 `use` 前缀。
3. repo 放到 `src/state/repo/**`，命名为 `xxxRepo.ts`。
4. 纯工具函数放到 `src/lib/**` 或能力局部目录。
5. API 调用优先复用现有 SDK client，不手写重复 fetch 封装。
6. 错误展示按 [CONVENTIONS](../../../../CONVENTIONS.md)：SDK `{ data, error }`，UI 用 `useToast()` 或现有错误边界。
7. UI 文案保持现有中文固定文案，不新增 i18n 层。

## 写实现

1. 从最靠近入口的现有组件或 context 开始改。
2. 能放在一个函数里的逻辑先放一个函数里。
3. 只在逻辑被复用或能明显简化调用点时抽 helper。
4. 新增持久化时，同步考虑 browser 模式和 IDE bridge 模式。
5. 涉及 host 能力时，另按 [新增 IDE bridge 消息](add-ide-bridge-message.md) 评估三端。

## 写测试

1. 在同目录或相近目录新增 `*.test.ts` / `*.test.tsx`。
2. 覆盖新增分支、状态归属和回归风险最高的一条用户路径。
3. React 组件测试沿用现有 vitest / testing-library 写法。
4. 如果只能运行时确认 UI 行为，记录：

> 待运行时核验：在 `/app` 中打开对应入口，执行新增能力的主路径。

## 验证

Working directory: `packages/opencode/webgui`

```powershell
bun typecheck
bun test:run
bun build
```

UI 行为受影响时，按 `specs/000-existing-capabilities/validation.md` 追加手动检查：打开 `/app`、创建 session、发送 prompt、检查相关入口。

## 收尾

1. 更新 [能力总索引](../../reference/capabilities-index.md)。
2. 更新或新增对应 [business 文档](../../reference/business/)。
3. 如果改到上游适配点，补看 [upstream-compatibility](../../reference/business/upstream-compatibility.md)。
4. final summary 记录命令、工作目录、PASS/FAIL/SKIPPED。
5. 运行时未核验的 UI 路径保留 `待运行时核验` 标记。
6. 不把临时调试入口、mock 数据或一次性实验代码留下。
7. 如果新增能力会影响宿主插件，同步补 hosts how-to 或 business 链接。
