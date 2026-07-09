# repowiki 智能更新设计

## 目标

以 `/understand --language zh` 生成的 knowledge graph 为事实基础，审查并更新 `docs/repowiki/` 文档。

## 策略

- **保持现有 8 专题结构**，不推倒重来
- **允许新增/合并话题**，如果 knowledge graph 揭示了现有文档未覆盖的重要架构视角
- **中文输出**（--language zh），使分析结果可直接嵌入 repowiki
- **两阶段执行**：先分析后更新

## 阶段一：knowledge graph 生成

运行 `/understand --language zh` 完整 7 阶段流程。

### 预期产出

- `knowledge-graph.json`：节点摘要、边关系、架构层次、导览步骤
- 仪表盘

### 关键配置

- `PROJECT_ROOT`: `D:\Caiqy\Projects\Github\opencode-ide-plugin`
- 语言：`zh`
- 排除：`node_modules/`, `.git/`, `dist/`, `build/`, `*.lock` 等

## 阶段二：repowiki 更新

### 审查维度

对每个 repowiki 文件 (01-08)：

| 维度         | 检查方法                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| 关键文件引用 | 对比 knowledge graph nodes 的 filePath，确认引用的文件仍然存在且路径正确 |
| 模块覆盖矩阵 | 对比 knowledge graph layers 和节点，检查是否有文件未归入任何专题         |
| 新功能/模式  | 对比 knowledge graph 中的新类/函数/模块，判断是否需要新增描述            |
| 交叉引用     | 检查专题文件间的相互引用是否仍然准确                                     |
| 维护注意点   | 根据 edges（imports/calls/depends_on）验证依赖关系描述是否正确           |

### 更新规则

- 保持现有风格（中文、关键文件列表、维护注意点）
- 追加新发现，不删除仍有用的内容
- 若发现新独立主题，提案新建专题文件
- README.md 的覆盖矩阵和阅读路线同步刷新

### 输出

每个 repowiki 文件的更新 diff。
