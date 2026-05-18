// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"

const originalArgv = [...process.argv]
const originalOverride = process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE

type ProxyListener = (...args: unknown[]) => void

type ProxyStub = {
  on: (event: string, cb: ProxyListener) => void
}

type ProxyConfig = {
  target?: string
  configure?: (proxy: ProxyStub) => void
}

afterEach(() => {
  process.argv = [...originalArgv]
  if (typeof originalOverride === "string") process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE = originalOverride
  else delete process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE
  vi.resetModules()
  vi.doUnmock("./dev/discoverBackend")
})

describe("vite config", () => {
  it("在 serve 模式下会代理 generated-image 路由到后端", async () => {
    process.argv = ["node", "vite"]

    vi.doMock("./dev/discoverBackend", () => ({
      BackendDiscoveryError: class BackendDiscoveryError extends Error {
        attempts = []
      },
      discoverBackend: vi.fn(async () => ({
        url: "http://127.0.0.1:4300",
        port: 4300,
        probe: "http://127.0.0.1:4300/global/config",
      })),
    }))

    const { default: config } = await import("./vite.config")
    const proxy = config.server?.proxy as Record<string, { target: string }>

    expect(proxy["/generated-image"]?.target).toBe("http://127.0.0.1:4300")
    expect(proxy["/app/generated-image"]?.target).toBe("http://127.0.0.1:4300")
  })

  it("在 serve 模式下存在目录 override 时会为代理请求注入 x-opencode-directory", async () => {
    process.argv = ["node", "vite"]
    process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE = "D:/demo/other-project"

    vi.doMock("./dev/discoverBackend", () => ({
      BackendDiscoveryError: class BackendDiscoveryError extends Error {
        attempts = []
      },
      discoverBackend: vi.fn(async () => ({
        url: "http://127.0.0.1:4300",
        port: 4300,
        probe: "http://127.0.0.1:4300/global/config",
      })),
    }))

    const { default: config } = await import("./vite.config")
    const proxy = config.server?.proxy as Record<string, ProxyConfig>
    const handlers = new Map<string, ProxyListener>()

    proxy["/event"]?.configure?.({
      on(event, cb) {
        handlers.set(event, cb)
      },
    })

    const setHeader = vi.fn()
    handlers.get("proxyReq")?.({ setHeader })

    expect(setHeader).toHaveBeenCalledWith("x-opencode-directory", "D:/demo/other-project")
  })

  it("在 serve 模式下未设置目录 override 时不会注入目录 header", async () => {
    process.argv = ["node", "vite"]
    delete process.env.OPENCODE_DEV_DIRECTORY_OVERRIDE

    vi.doMock("./dev/discoverBackend", () => ({
      BackendDiscoveryError: class BackendDiscoveryError extends Error {
        attempts = []
      },
      discoverBackend: vi.fn(async () => ({
        url: "http://127.0.0.1:4300",
        port: 4300,
        probe: "http://127.0.0.1:4300/global/config",
      })),
    }))

    const { default: config } = await import("./vite.config")
    const proxy = config.server?.proxy as Record<string, ProxyConfig>
    const handlers = new Map<string, ProxyListener>()

    proxy["/generated-image"]?.configure?.({
      on(event, cb) {
        handlers.set(event, cb)
      },
    })

    expect(handlers.has("proxyReq")).toBe(false)
  })
})
