# WebGUI Markdown 文本选区稳定性设计

## 问题

已完成加载的复杂 Markdown 消息在鼠标拖选时，选区高亮可能突然扩展到全部内容或完全消失。正文布局没有变化，但复制目标无法稳定选中。

## 根因

`MessageRow` 会因悬停状态等界面状态变化重新渲染。`MarkdownRenderer` 当前在每次渲染时调用 `createMarkdownComponents` 或 `createInlineComponents`，生成一组新的 React 组件函数。

React 将新的函数引用视为新的组件类型，因此卸载并重建 Markdown 的段落、列表、行内代码等 DOM 节点。浏览器 Selection Range 绑定的是节点实例；节点被替换后，选区端点可能退化到共同祖先或被清空，即使可见文字完全相同。

## 方案

在 `MarkdownRenderer` 内使用 React `useMemo` 缓存 Markdown 组件映射。仅当以下实际渲染输入变化时重新创建映射：

- `inline`
- `tone`
- 当前项目目录

相同内容因父组件状态刷新而重新渲染时，Markdown 组件类型和已有 DOM 节点保持稳定。正文内容真的变化时，React 仍按正常规则更新文本。

不保存、重建或拦截全局 Selection Range。稳定节点即可消除本问题的根因，避免维护易错的文本偏移映射。

## 验证

在现有 `MarkdownRenderer` 测试中增加一个复杂 Markdown 回归用例：

1. 渲染包含列表与行内代码的正文。
2. 记录可选文本及行内代码的 DOM 节点。
3. 使用相同属性重新渲染。
4. 断言节点仍是原节点且仍连接在文档中。

该测试在当前实现下应因节点被替换而失败，在缓存组件映射后通过。用例还会从普通列表文本到行内代码创建真实 DOM Selection Range，并断言相同属性重渲染后选中文本不变、两个端点仍连接文档。随后从 `packages/opencode/webgui` 运行 `bun run test:run -- src/components/MarkdownRenderer.test.tsx` 与 `bun run build`。

## 边界

本次只保证内容不变时的选区稳定。正在流式生成且 Markdown 结构确实变化的当前正文仍可能需要更新 DOM，不在本次范围内。
