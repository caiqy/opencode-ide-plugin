import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ProviderSettingsTab } from "./ProviderSettingsTab"

const mocks = vi.hoisted(() => ({
  configUpdate: vi.fn(),
  configReplace: vi.fn(),
  configProviders: vi.fn(),
  configProviderModels: vi.fn(),
}))

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    global: {
      config: {
        update: (...args: unknown[]) => mocks.configUpdate(...args),
        replace: (...args: unknown[]) => mocks.configReplace(...args),
      },
    },
    config: {
      providers: (...args: unknown[]) => mocks.configProviders(...args),
      providerModels: (...args: unknown[]) => mocks.configProviderModels(...args),
    },
  },
}))

vi.mock("../../lib/ideBridge", () => ({
  ideBridge: { request: vi.fn() },
}))

const formData = {
  provider: {
    openai: {
      options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-1234567890abcdef" },
      whitelist: ["gpt-4.1"],
    },
  },
}

describe("ProviderSettingsTab", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mocks.configUpdate.mockResolvedValue({ data: formData, error: null })
    mocks.configReplace.mockResolvedValue({ data: formData, error: null })
    mocks.configProviders.mockResolvedValue({
      data: {
        providers: [{ id: "openai", name: "OpenAI", models: { "gpt-4.1": { name: "GPT 4.1" } } }],
        default: {},
      },
      error: null,
    })
    mocks.configProviderModels.mockResolvedValue({
      data: {
        providerID: "openai",
        models: [
          { id: "gpt-4.1", name: "GPT 4.1", status: "active" },
          { id: "gpt-4.1-mini", name: "GPT 4.1 Mini", status: "active" },
        ],
      },
      error: null,
    })
  })

  it("展示配置更新区域和 Provider 列表", async () => {
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    expect(screen.getByText("配置更新")).toBeInTheDocument()
    expect(
      screen.getByDisplayValue(
        "https://raw.githubusercontent.com/caiqy/opencode-ide-plugin/refs/heads/ide-plugin/samples/opencode.jsonc",
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /覆盖/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /合并/ })).not.toBeChecked()
    expect(screen.getByText("openai")).toBeInTheDocument()
    expect(screen.getByText("https://api.openai.com/v1")).toBeInTheDocument()
    expect(screen.getByText("sk-1…cdef")).toBeInTheDocument()
    expect(mocks.configProviderModels).not.toHaveBeenCalled()
  })

  it("编辑 Provider 后保存并显示重启提示", async () => {
    const user = userEvent.setup()
    const setFormData = vi.fn()
    const onReloadConfig = vi.fn()
    render(<ProviderSettingsTab formData={formData} setFormData={setFormData} onReloadConfig={onReloadConfig} />)

    await user.click(within(screen.getByText("openai").closest("tr")!).getByRole("button", { name: "编辑" }))
    expect(screen.getByDisplayValue("openai")).toBeDisabled()
    await user.clear(screen.getByLabelText("接口地址"))
    await user.type(screen.getByLabelText("接口地址"), "https://proxy.example.com/v1")
    await user.clear(screen.getByLabelText("API 密钥"))
    await user.type(screen.getByLabelText("API 密钥"), "new-key")
    await user.type(screen.getByPlaceholderText(/选择或输入模型/), "gpt-4.1-mini")
    await user.click(screen.getByRole("button", { name: "添加模型" }))
    await user.click(screen.getByRole("button", { name: "保存 Provider" }))

    await waitFor(() => {
      expect(mocks.configUpdate).toHaveBeenCalledWith({
        body: {
          provider: {
            openai: {
              options: { baseURL: "https://proxy.example.com/v1", apiKey: "new-key" },
              whitelist: ["gpt-4.1", "gpt-4.1-mini"],
            },
          },
        },
      })
    })
    expect(mocks.configReplace).not.toHaveBeenCalled()
    expect(setFormData).toHaveBeenCalledWith(formData)
    expect(onReloadConfig).toHaveBeenCalledWith(formData)
    expect(screen.getByText("Provider 设置已保存")).toBeInTheDocument()
  })

  it("编辑 Provider 只 PATCH provider 配置", async () => {
    const user = userEvent.setup()
    const anthropic = { options: { apiKey: "anthropic-key" }, whitelist: ["claude-sonnet-4-5"] }
    render(
      <ProviderSettingsTab
        formData={{
          ...formData,
          username: "local-user",
          snapshot: true,
          provider: { ...formData.provider, anthropic },
        }}
        setFormData={vi.fn()}
        onReloadConfig={vi.fn()}
      />,
    )

    await user.click(within(screen.getByText("openai").closest("tr")!).getByRole("button", { name: "编辑" }))
    await user.clear(screen.getByLabelText("接口地址"))
    await user.type(screen.getByLabelText("接口地址"), "https://proxy.example.com/v1")
    await user.click(screen.getByRole("button", { name: "保存 Provider" }))

    await waitFor(() => {
      expect(mocks.configUpdate).toHaveBeenCalledWith({
        body: {
          provider: {
            openai: {
              options: { baseURL: "https://proxy.example.com/v1", apiKey: "sk-1234567890abcdef" },
              whitelist: ["gpt-4.1"],
            },
            anthropic,
          },
        },
      })
    })
  })

  it("模型白名单使用自绘候选列表且不再渲染 datalist", async () => {
    const user = userEvent.setup()
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    expect(document.querySelector("datalist")).toBeNull()
    await user.click(screen.getByPlaceholderText(/选择或输入模型/))

    expect(await screen.findByRole("listbox", { name: "模型候选" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /gpt-4\.1$/ })).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: /gpt-4\.1-mini/ })).toBeInTheDocument()
  })

  it("可以从模型候选列表选择并添加 whitelist 外模型", async () => {
    const user = userEvent.setup()
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.click(screen.getByPlaceholderText(/选择或输入模型/))
    await user.click(await screen.findByRole("option", { name: /gpt-4\.1-mini/ }))
    await user.click(screen.getByRole("button", { name: "添加模型" }))

    expect(screen.getByDisplayValue("gpt-4.1-mini")).toBeInTheDocument()
  })

  it("模型候选为空时仍可手动添加输入值", async () => {
    const user = userEvent.setup()
    mocks.configProviderModels.mockResolvedValue({ data: { providerID: "openai", models: [] }, error: null })
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.type(screen.getByPlaceholderText(/选择或输入模型/), "custom-model")
    expect(screen.getByText("没有匹配的候选，可直接添加当前输入")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "添加模型" }))

    expect(screen.getByDisplayValue("custom-model")).toBeInTheDocument()
  })

  it("删除白名单模型", async () => {
    const user = userEvent.setup()
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    const row = screen.getByDisplayValue("gpt-4.1").closest("tr")!
    await user.click(within(row).getByRole("button", { name: "删除" }))

    expect(screen.queryByDisplayValue("gpt-4.1")).not.toBeInTheDocument()
  })

  it("覆盖更新会下载 JSONC 并保留本地同名 provider 的 baseURL/apiKey", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `{
          // remote config
          "provider": {
            "openai": { "options": { "baseURL": "https://remote.example.com/v1", "apiKey": "remote-key" }, "whitelist": ["remote"] },
            "anthropic": { "options": { "apiKey": "anthropic-key" } }
          }
        }`,
      })),
    )
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "更新配置" }))

    await waitFor(() => {
      expect(mocks.configReplace).toHaveBeenCalledWith({
        body: {
          provider: {
            openai: {
              options: { baseURL: "https://api.openai.com/v1", apiKey: "sk-1234567890abcdef" },
              whitelist: ["remote"],
            },
            anthropic: { options: { apiKey: "anthropic-key" } },
          },
        },
      })
    })
    expect(mocks.configUpdate).not.toHaveBeenCalled()
  })

  it("合并更新会下载 JSONC 并保留本地同名 provider 的 baseURL/apiKey", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `{
          "username": "remote-user",
          "provider": {
            "openai": { "options": { "baseURL": "https://remote.example.com/v1", "apiKey": "remote-key", "timeout": 2000 }, "whitelist": ["remote"] },
            "anthropic": { "options": { "apiKey": "anthropic-key" } }
          }
        }`,
      })),
    )
    render(
      <ProviderSettingsTab
        formData={{ ...formData, username: "local-user" }}
        setFormData={vi.fn()}
        onReloadConfig={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("radio", { name: /合并/ }))
    await user.click(screen.getByRole("button", { name: "更新配置" }))

    await waitFor(() => {
      expect(mocks.configUpdate).toHaveBeenCalledWith({
        body: {
          username: "remote-user",
          provider: {
            openai: {
              options: {
                baseURL: "https://api.openai.com/v1",
                apiKey: "sk-1234567890abcdef",
                timeout: 2000,
              },
              whitelist: ["remote"],
            },
            anthropic: { options: { apiKey: "anthropic-key" } },
          },
        },
      })
    })
    expect(mocks.configReplace).not.toHaveBeenCalled()
  })

  it("下载失败时显示错误且不保存", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 })),
    )
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "更新配置" }))

    expect(await screen.findByText("配置下载失败：HTTP 404")).toBeInTheDocument()
    expect(mocks.configUpdate).not.toHaveBeenCalled()
    expect(mocks.configReplace).not.toHaveBeenCalled()
  })

  it("网络异常时显示下载失败且不保存", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("Network down"))),
    )
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "更新配置" }))

    expect(await screen.findByText("配置下载失败：Network down")).toBeInTheDocument()
    expect(mocks.configUpdate).not.toHaveBeenCalled()
    expect(mocks.configReplace).not.toHaveBeenCalled()
  })

  it("远程 JSONC 解析失败时显示错误且不保存", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `{ "provider": {`,
      })),
    )
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "更新配置" }))

    expect(await screen.findByText("配置解析失败")).toBeInTheDocument()
    expect(mocks.configUpdate).not.toHaveBeenCalled()
    expect(mocks.configReplace).not.toHaveBeenCalled()
  })

  it("远程配置不是对象时显示解析错误且不保存", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `["not-config"]`,
      })),
    )
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "更新配置" }))

    expect(await screen.findByText("配置解析失败")).toBeInTheDocument()
    expect(mocks.configUpdate).not.toHaveBeenCalled()
    expect(mocks.configReplace).not.toHaveBeenCalled()
  })

  it("远程 provider 字段不是对象时显示解析错误且不保存", async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => `{ "provider": "bad" }`,
      })),
    )
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "更新配置" }))

    expect(await screen.findByText("配置解析失败")).toBeInTheDocument()
    expect(mocks.configUpdate).not.toHaveBeenCalled()
    expect(mocks.configReplace).not.toHaveBeenCalled()
  })

  it("保存中禁用编辑输入和操作按钮", async () => {
    const user = userEvent.setup()
    let resolveSave: (value: { data: typeof formData; error: null }) => void = () => {}
    mocks.configUpdate.mockReturnValue(new Promise((resolve) => (resolveSave = resolve)))
    render(<ProviderSettingsTab formData={formData} setFormData={vi.fn()} onReloadConfig={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "编辑" }))
    await user.click(screen.getByRole("button", { name: "保存 Provider" }))

    await waitFor(() => expect(screen.getByLabelText("接口地址")).toBeDisabled())
    expect(screen.getByLabelText("API 密钥")).toBeDisabled()
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "返回列表" })).toBeDisabled()

    resolveSave({ data: formData, error: null })
    await screen.findByText("Provider 设置已保存")
  })
})
