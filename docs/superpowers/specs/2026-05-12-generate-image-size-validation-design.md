# `generate_image` 尺寸约束修正规格

## 背景

当前 `generate_image` 的 OpenAI-compatible adapter 会对 `gpt-image-*` 的 `size` 做一层本地预检，但现有规则只覆盖了以下约束：

- 宽高必须大于 0
- 宽高必须是 16 的倍数
- 最长边必须小于等于 3840
- 长宽比必须不超过 3:1

实际运行中，`512x512` 会通过本地预检，但随后被 provider 拒绝，并返回：

`Invalid size '512x512'. Requested resolution is below the current minimum pixel budget.`

通过 OpenAI 官方文档核对后，`gpt-image-2` 的 `size` 还存在一个当前实现遗漏的硬约束：**总像素必须位于 `655360..8294400` 区间内**。

## 目标

- 修正 `generate_image` 对 `gpt-image-*` 尺寸的前置校验，使其与官方文档一致。
- 保留“任意合法尺寸”能力，不把支持范围收窄为固定白名单尺寸。
- 在发起 provider 请求前给出清晰、本地化一致的错误提示，减少无效请求。
- 补齐测试，防止后续回归。

## 非目标

- 不把 `gpt-image-*` 尺寸能力改成固定推荐尺寸白名单。
- 不修改 `auto` 的现有行为；`auto` 继续透传给 provider。
- 不扩展到非 `gpt-image-*` 模型的尺寸规则推断。
- 不改造 `image_generation` 的 Responses provider tool 注入链路。

## 官方约束对齐

对 `gpt-image-*` 的 `WIDTHxHEIGHT` 尺寸字符串，继续要求满足以下全部条件：

1. 宽高都必须大于 0。
2. 宽高都必须是 16 的倍数。
3. 最长边必须小于等于 3840。
4. 长边与短边比例必须不超过 3:1。
5. **总像素 `width * height` 必须大于等于 `655360`，且小于等于 `8294400`。**

`auto` 仍然直接放行，不做像素预算判断。

## 方案选择

本次采用“补齐官方约束”的方案：

- 继续允许任意满足约束的自定义尺寸，例如 `1280x1024`。
- 明确拒绝 `512x512` 这类虽然格式合法、但低于最小像素预算的尺寸。
- 同样拒绝高于最大像素预算的尺寸。

不采用固定白名单方案，因为官方文档明确允许更广泛的合法尺寸；若改成白名单，会错误限制本来可用的尺寸组合。

## 代码设计

### 1. Adapter 预检逻辑

修改 `packages/opencode/src/tool/generate-image/openai-compatible.ts` 中的 `validateSize(size, model)`：

- 保留现有 `gpt-image-*` gating，不影响其他模型。
- 在现有宽高、倍数、最长边、长宽比校验之后，新增总像素区间校验。
- 校验顺序保持“便于理解”的风格：先格式，再几何，再像素预算。

建议新增两个直接、稳定的报错：

- `size total pixels must be >= 655360 for gpt-image models`
- `size total pixels must be <= 8294400 for gpt-image models`

这样可以保持与现有错误风格一致，例如：

- `size width and height must be multiples of 16`
- `size longest edge must be <= 3840`

### 2. 工具参数说明

更新 `packages/opencode/src/tool/generate-image.ts` 中 `size` 参数的 description，使其不再只说“when supported by the model”，而是对 `gpt-image-*` 的关键约束给出明示。

说明应明确表达：

- 可使用 `auto` 或 `WIDTHxHEIGHT`
- 对 `gpt-image-*`，宽高必须是 16 的倍数
- 最长边必须 `<= 3840`
- 长宽比必须 `<= 3:1`
- 总像素必须位于 `655360..8294400`

### 3. 工具文本说明

更新 `packages/opencode/src/tool/generate-image.txt`，补充一条简短但足够清晰的尺寸提示，让模型和用户都更容易理解：

- `gpt-image-*` 支持 `auto` 或满足官方约束的 `WIDTHxHEIGHT`
- `512x512` 这类低于最小像素预算的尺寸不应再被暗示为可用

不需要在说明里列出完整推荐尺寸白名单，只需讲清楚规则即可。

## 测试设计

主要补充 `packages/opencode/test/tool/generate-image-openai-compatible.test.ts`：

1. **最小像素预算失败**
   - 例如 `512x512`
   - 断言在 provider 请求发出前失败
   - 断言错误文案匹配最小像素预算提示

2. **低于最小像素预算的非方图失败**
   - 选择一个仍为 16 倍数、但总像素不足的尺寸
   - 用于证明不是只特判 `512x512`

3. **高于最大像素预算失败**
   - 选择一个满足其他几何约束、但总像素超限的尺寸
   - 断言同样在 provider 请求前失败

4. **合法自定义尺寸继续通过**
   - 例如 `1280x1024`
   - 用于证明本次修正没有把能力收窄成白名单

必要时同步调整参数相关快照或说明性测试，但不应扩大到无关模块。

## 兼容性与风险

### 兼容性

- `auto` 不受影响。
- 非 `gpt-image-*` 模型不受影响。
- 已经使用合法自定义尺寸的调用不受影响。

### 风险

- 如果未来某个 `gpt-image-*` 模型调整像素预算，当前硬编码区间需要同步更新。
- 若第三方 OpenAI-compatible 服务声称支持 `gpt-image-*` 命名，但实际规则不同，本地预检可能比对方更严格；不过当前目标是以官方模型文档为准。

## 成功标准

- `512x512` 对 `gpt-image-*` 在本地直接失败，不再发出无效 provider 请求。
- 合法自定义尺寸仍然可通过。
- 工具参数说明与文本说明不再暗示 `512x512` 这类尺寸是可用的。
- 相关测试通过，并覆盖最小/最大像素预算边界。

## 实施范围

- `packages/opencode/src/tool/generate-image/openai-compatible.ts`
- `packages/opencode/src/tool/generate-image.ts`
- `packages/opencode/src/tool/generate-image.txt`
- `packages/opencode/test/tool/generate-image-openai-compatible.test.ts`

如参数说明快照因 description 变化而更新，可连带调整对应测试产物，但不扩展到本次范围之外。
