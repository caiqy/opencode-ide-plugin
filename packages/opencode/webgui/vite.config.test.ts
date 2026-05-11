// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"

const originalArgv = [...process.argv]

afterEach(() => {
  process.argv = [...originalArgv]
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
})
