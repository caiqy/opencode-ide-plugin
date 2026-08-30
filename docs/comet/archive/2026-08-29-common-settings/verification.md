---
generated_from_state_version: 20
---

# Verification

## Current result

- Result: **Passed**
- Assurance: **skill-coordinated**
- Goal cycle: 1
- Iteration: 5
- Verifier attempt: 1
- Completed: 2026-08-29T09:33:10.445Z
- Summary: 独立审阅 brief、spec、实现源码及已有测试后，A1-A26 全部满足；重点确认 IDE Bridge 页面中的自动更新 checkbox 在 bridge 可用时可编辑，保存写入宿主全局存储并立即更新自动检查调度。

## Acceptance

| ID | Result | Source | Criterion | Reason |
| --- | --- | --- | --- | --- |
| A1 | passed | brief.md | A1：设置面板展示可访问的“常用设置”入口，打开后可看到本需求全部配置项。 | 常用设置为首个标签并展示全部目标配置项。 |
| A2 | passed | brief.md | A2：每个配置项始终显示中文说明，说明包含用途、默认值和关键影响，不依赖悬停才能读取。 | 各配置项均有始终可见的中文说明。 |
| A3 | passed | brief.md | A3：未显式配置时，自动更新控件与实际更新行为均按最终确认的对象默认开启；保存后对应配置生效。 | IDE Bridge 页面检测到 bridge 参数后控件可编辑；保存通过宿主存储，并立即切换 UpdateService 调度状态。 |
| A4 | passed | brief.md | A4：未显式配置时，文件快照控件为关闭，后续会话不记录文件快照；开启并保存后，后续会话恢复快照记录。 | snapshot 默认关闭，运行时和界面默认一致，保存写入全局配置。 |
| A5 | passed | brief.md | A5：搜索模式只提供“原生搜索”和“OpenAI 搜索”，未显式配置时选择 OpenAI 搜索；OpenAI 模式显示模型选择器并默认选择 `openai/gpt-5.6-luna`；模型未配置或无可用凭据时阻止保存并显示明确提示。 | 仅提供原生搜索和 OpenAI 搜索，默认 OpenAI 并使用指定模型。 |
| A6 | passed | brief.md | A6：网页搜索并行限制接受 1–10 的整数，未显式配置时为 3，后续网页搜索调用受保存值限制。 | 网页搜索并行数默认 3，校验范围为 1–10，运行时消费配置。 |
| A7 | passed | brief.md | A7：子任务并行限制接受 1–10 的整数，未显式配置时为 3，后续子任务执行受保存值限制。 | 子任务并行数默认 3，校验范围为 1–10，运行时消费配置。 |
| A8 | passed | brief.md | A8：错误重试上限接受 0–100 的整数，未显式配置时为 10；0 禁用错误重试，保存值限制后续模型请求的自动重试次数。 | 重试上限默认 10，校验范围为 0–100，运行时消费配置。 |
| A9 | passed | brief.md | A9：保存失败时不误报成功，关闭存在未保存修改的面板仍执行现有确认流程。 | 保存异常进入错误状态，不显示成功；未保存关闭继续使用确认弹窗。 |
| A10 | passed | specs/common-settings/spec.md | 设置面板把“常用设置”作为标签栏第一项，打开设置时默认进入该页。页面只展示自动更新、文件快照、搜索模式、OpenAI 搜索模型、网页搜索并行数、子任务并行数和错误重试上限，不展示现有常规页中的用户名、分享模式或工作目录。 | 常用设置位于首项并展示全部目标字段，旧常规字段未展示。 |
| A11 | passed | specs/common-settings/spec.md | 每个配置项显示中文名称、可编辑控件和始终可见的详细说明。说明至少解释该配置控制的行为、未显式配置时的默认值，以及关闭或调整后最重要的影响。 | 每个字段都有可编辑控件和可见中文说明。 |
| A12 | passed | specs/common-settings/spec.md | 页面通过现有全局配置读取和保存流程工作。所有本文所列默认值同时是字段缺失时的实际运行时默认值，界面不得显示与运行时不同的缺省状态。保存成功后以服务端返回配置刷新表单基线；保存失败时保留编辑内容并显示失败，不得误报成功。关闭未保存表单继续沿用现有确认行为。 | 使用全局配置读写流程，成功后刷新表单基线，失败保留编辑内容。 |
| A13 | passed | specs/common-settings/spec.md | 数值输入为空、小数或越界时，页面保留用户输入，在对应字段下显示合法范围，并阻止保存；不得自动取整、截断到边界或恢复默认值。 | 空值、小数和越界输入保留原值并显示字段错误，阻止保存。 |
| A14 | passed | specs/common-settings/spec.md | 自动更新使用布尔开关，未显式配置时默认开启。该开关只控制 IDE 插件的 GitHub Release 定时检查及插件安装流程；关闭后插件不执行自动定时检查。OpenCode 后端自身的 `autoupdate` 配置不由此开关读取或修改。 | IDE 插件自动更新独立使用宿主存储，默认开启，不读取后端 autoupdate。 |
| A15 | passed | specs/common-settings/spec.md | 文件快照使用布尔开关，未显式配置时默认关闭。关闭时，后续会话不记录文件状态快照，依赖快照的文件撤销或恢复能力不可用；开启后，后续会话恢复快照记录。 | 文件快照界面与运行时均默认关闭，配置保存后影响后续会话。 |
| A16 | passed | specs/common-settings/spec.md | 搜索模式使用二选一控件，只提供“原生搜索”和“OpenAI 搜索”，未显式配置时默认选择“OpenAI 搜索”。“原生搜索”沿用现有 Exa/Parallel 路径；“OpenAI 搜索”调用 OpenAI `/alpha/search` 路径。 | 搜索模式为二选一，原生路径和 OpenAI alpha-search 路径映射正确。 |
| A17 | passed | specs/common-settings/spec.md | 选择 OpenAI 搜索时显示 OpenAI 搜索模型选择器，只列出可用于该路径的 OpenAI 模型。未显式配置时默认模型为 `openai/gpt-5.6-luna`。所选模型未配置或没有可用凭据时，设置页阻止保存并显示明确提示，引导用户先完成 OpenAI 配置；不得静默回退原生搜索。 | OpenAI 模型选择器基于可用 provider 配置，模型或凭据不可用时显示错误并阻止保存。 |
| A18 | passed | specs/common-settings/spec.md | 用户从未保存过搜索设置时，运行时同样按默认值尝试 `openai/gpt-5.6-luna`。模型或凭据不可用时返回明确、可操作的配置错误，不执行 Exa/Parallel 回退。 | 未配置搜索时运行时默认尝试 openai/gpt-5.6-luna，失败不会回退原生搜索。 |
| A19 | passed | specs/common-settings/spec.md | 网页搜索并行数写入 `parallel_limit.websearch`，子任务并行数写入 `parallel_limit.subagent`。两者均只接受 1–10 的整数，未显式配置时均为 3。保存后的限制用于后续调用，正在执行的调用不受影响。 | parallel_limit.websearch 和 subagent 均写入正确字段并被后续执行消费。 |
| A20 | passed | specs/common-settings/spec.md | 错误重试上限写入 `provider_retry.max_retries`，只接受 0–100 的整数，未显式配置时为 10。该值表示首次请求失败后最多追加的自动重试次数；设置为 0 时禁用自动重试。保存后的限制用于后续模型请求，正在执行的请求不受影响。 | provider_retry.max_retries 写入正确字段，0 禁用重试，后续请求使用保存值。 |
| A21 | passed | specs/common-settings/spec.md | S1：设置面板可进入“常用设置”，并展示全部目标配置项。 | 设置面板可进入常用设置并展示完整目标配置。 |
| A22 | passed | specs/common-settings/spec.md | S2：每项均有始终可见的中文详细说明，覆盖用途、默认值和关键影响。 | 配置说明均为始终可见的中文文案，覆盖默认值和影响。 |
| A23 | passed | specs/common-settings/spec.md | S3：表单缺省状态与最终确认的实际运行时默认行为一致。 | 界面默认状态与运行时默认值一致。 |
| A24 | passed | specs/common-settings/spec.md | S4：数值项只接受各自范围内的整数；无效输入保留原值、显示行内提示并阻止保存，合法值可保存并被后续执行消费。 | 数值校验、错误显示、保存阻止和合法值保存逻辑完整。 |
| A25 | passed | specs/common-settings/spec.md | S5：保存失败和未保存关闭继续遵守现有错误及确认行为。 | 保存失败和未保存关闭行为符合现有错误及确认流程。 |
| A26 | passed | specs/common-settings/spec.md | S6：默认 OpenAI 模型不可用时，设置页阻止保存，运行时返回明确配置错误，二者均不回退原生搜索。 | 默认 OpenAI 模型不可用时界面阻止保存，运行时返回明确错误且不回退原生搜索。 |

## Checks

_No Runtime checks were recorded._

## Blockers

_None._

## Risks and skipped work

- 现有自动化测试未直接覆盖带真实 IDE Bridge URL 的 checkbox 点击流程；源码中的 iframe 参数、可编辑条件、宿主存储和调度切换链路一致。

## Previous iterations

| Goal cycle | Iteration | Attempt | Outcome | Unresolved | Summary | Completed |
| ---: | ---: | ---: | --- | --- | --- | --- |
| 1 | 1 | 1 | fail | A4, A5, A6, A8, A15, A18, A19, A20, A23, A24, A26 | 旧 OpenCode 路径和 UI 大体符合要求，但 Core V2 运行时仍保留相反或缺失的默认值与配置消费，不能通过。 | 2026-08-29T05:37:54.123Z |
| 1 | 2 | 1 | fail | A4, A6, A8, A15, A19, A20, A24 | Core 运行时默认值与消费逻辑已修复，但全局配置保存到 Core Location scope 的同步失效链路尚未闭合。 | 2026-08-29T06:07:05.587Z |
| 1 | 3 | 1 | fail | A4, A6, A8, A15, A19, A20, A24 | 同步 disposal 已修复响应时序，但 server 的 V2 独立 LocationServiceMap 尚未接入 disposer。 | 2026-08-29T06:17:23.904Z |
| 1 | 4 | 1 | pass | — | A1-A26 全部通过；OpenCode/Core typecheck、9 项配置与 registry 测试、134 项 Core 测试及 diff check 均通过。 | 2026-08-29T06:41:26.105Z |
| 1 | 4 | 1 | recovery | — | 自动更新开关在当前 IDE 页面被错误禁用，需要修复 bridge 能力识别或可编辑条件 | 2026-08-29T07:31:07.864Z |
| 1 | 5 | 1 | pass | — | 独立审阅 brief、spec、实现源码及已有测试后，A1-A26 全部满足；重点确认 IDE Bridge 页面中的自动更新 checkbox 在 bridge 可用时可编辑，保存写入宿主全局存储并立即更新自动检查调度。 | 2026-08-29T09:33:10.445Z |

## Conclusion

独立审阅 brief、spec、实现源码及已有测试后，A1-A26 全部满足；重点确认 IDE Bridge 页面中的自动更新 checkbox 在 bridge 可用时可编辑，保存写入宿主全局存储并立即更新自动检查调度。
