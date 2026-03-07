# Test preload 边界设计

## 说明背景

`packages/opencode/bunfig.toml` 通过 `[test].preload = ["./test/preload.ts"]` 在 `bun test` 进程启动时全局加载 `test/preload.ts`。当前讨论点是：Windows 下测试目录清理、`EBUSY` 兜底、SQLite WAL 相关删除抖动，是否应该放进这个全局入口。

已确认方向是：`test/preload.ts` 的角色应保持为“全局测试运行时初始化入口”。它不是“局部平台问题补丁收容层”。

---

## 明确目标

1. 明确 `test/preload.ts` 的长期架构定位。
2. 划清全局 bootstrap 与局部 cleanup 补丁的职责边界。
3. 给后续 Windows 清理实现提供推荐落点，避免继续扩大 preload 责任。
4. 保持本轮改动最小化，不把 Windows 清理混入 overflow / compaction 相关修改。

---

## 排除范围

1. 不在本文内直接实现 Windows 清理逻辑。
2. 不讨论所有测试夹具的完整重构，只定义推荐下沉方向。
3. 不把“短期兼容可行”误写成“长期架构推荐”。
4. 不改变 `bun test` 的 preload 机制本身。

---

## 收敛结论

`test/preload.ts` 应只承载“进程内、可等待、可推断、一次性”的测试运行时初始化。凡是依赖后台 detached 进程、跨进程延迟删除、退出后继续运行的清理动作，都不应放进这里。

Windows 下的 `EBUSY`、SQLite WAL 文件释放时序、临时目录删除抖动，本质上都属于局部资源生命周期问题。它们应由资源拥有者负责，而不是上浮到全局 preload 统一兜底。

---

## 划清职责

### preload.ts 应负责

1. XDG / HOME / managed config 的环境隔离。
2. 测试 cache / version 的预置。
3. provider 相关环境变量清理。
4. 全局日志初始化。
5. 其他明确属于测试进程启动阶段、且可同步或可等待完成的一次性初始化。

### preload.ts 不应负责

1. 后台 detached 清理任务。
2. 跨进程延迟删除。
3. 进程退出后继续运行的 cleanup。
4. 面向单个 fixture、单个 db、单个临时目录的局部资源释放补丁。
5. 仅为某个平台异常行为提供的模糊全局兜底。

---

## 采用方案

推荐把 `test/preload.ts` 继续保持为 bootstrap 入口，不承接本次 Windows 清理逻辑。

Windows 相关清理应按资源归属下沉：

1. 临时目录删除问题，下沉到 tmpdir fixture 或其 helper。
2. SQLite WAL / db 文件释放问题，下沉到 db 生命周期 helper。
3. 需要重试、延迟、fallback 的目录移除逻辑，下沉到独立 cleanup helper。

这样做有两个直接收益。第一，责任更清晰，问题能和具体资源模型绑定；第二，未来排查失败时能直接定位到 fixture 或 helper，而不是回到全局 preload 猜测副作用。

---

## 比较选项

### 方案 A：继续放在 preload.ts

优点是接入快，短期能集中兜底。缺点是会把全局入口变成平台补丁堆栈，并持续模糊资源所有权。

### 方案 B：下沉到资源拥有者（推荐）

优点是边界稳定，行为可测，失败定位直接。缺点是需要分别改动 tmpdir、db 或 cleanup helper，短期实现点位更分散。

### 方案 C：保留全局兼容层，但独立模块化

这是仅在短期无法完成下沉时的过渡方案。它必须独立抽模块、明确命名为 Windows fallback cleanup，并要求真正唯一的目录标识，避免误删或污染其它测试资源。

---

## 推进迁移

1. 先冻结 `test/preload.ts` 的职责，不再向其中加入新的局部清理补丁。
2. 识别当前 Windows 清理的真实资源拥有者，是 tmpdir、db，还是通用 cleanup 场景。
3. 把现有逻辑迁移到对应 fixture / helper，并在调用方显式接入。
4. 如果短期必须保留全局清理，先抽成独立模块并标记为临时兼容层。
5. 在后续窗口再逐步删除这层临时兼容，回收 preload 中的非 bootstrap 逻辑。

迁移顺序应服从“最小范围变更优先”。因此，本次不建议把 Windows 清理改动混入 overflow / compaction 这批修改。

---

## 定义验收

1. `test/preload.ts` 的文义和实现都保持为全局测试运行时 bootstrap。
2. 新增或迁移的 Windows 清理逻辑不直接驻留在 preload 主体中。
3. `EBUSY`、WAL、临时目录删除抖动等问题，能在对应资源 helper 层被表达和处理。
4. 如果存在短期全局兼容层，它必须是独立模块，命名明确，并使用真正唯一的目录标识。
5. 本轮 overflow / compaction 修改不混入新的 preload 全局清理职责。
