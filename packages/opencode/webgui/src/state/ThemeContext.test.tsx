import { describe, it, expect, beforeEach, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { act, render, screen, waitFor } from "../test/test-utils"

vi.mock("../lib/ideBridge", () => {
  return {
    ideBridge: {
      isInstalled: vi.fn(),
      request: vi.fn(),
    },
  }
})

import { ThemeProvider, useTheme } from "./ThemeContext"
import { ideBridge } from "../lib/ideBridge"

function Probe() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div>
      <div data-testid="theme">{theme}</div>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  )
}

describe("ThemeContext host storage sync", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove("dark")
    vi.resetAllMocks()
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
  })

  it("默认主题为暗色（无 host/local 存储时）", async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    await screen.findByText("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("在 IDE 环境会从 host storage 恢复主题", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        return {
          ok: true,
          result: {
            "oc-webgui-theme": "dark",
          },
        }
      }
      return { ok: true }
    })

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    await screen.findByText("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(ideBridge.request).toHaveBeenCalledWith("storageGet", {
      keys: ["oc-webgui-theme"],
    })
  })

  it("在 IDE 环境切换主题会同步到 host storage", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        return {
          ok: true,
          result: {},
        }
      }
      return { ok: true }
    })

    const user = userEvent.setup()

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    await screen.findByTestId("theme")
    await user.click(screen.getByText("toggle"))

    await waitFor(() => {
      expect(ideBridge.request).toHaveBeenCalledWith("storageSet", {
        key: "oc-webgui-theme",
        value: "dark",
      })
    })
  })

  it("在 IDE 环境切换主题不应触发重复 host 恢复覆盖用户选择", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)

    const deferred = <T,>() => {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((res) => {
        resolve = res
      })
      return { promise, resolve }
    }

    let getCalls = 0
    const secondGet = deferred<{ ok: true; result: Record<string, unknown> }>()

    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        getCalls += 1
        if (getCalls === 1) {
          return {
            ok: true,
            result: {
              "oc-webgui-theme": "light",
            },
          }
        }
        return secondGet.promise
      }
      return { ok: true }
    })

    const user = userEvent.setup()

    try {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      )

      await screen.findByText("light")
      await user.click(screen.getByText("toggle"))
      await screen.findByText("dark")

      // 若 ThemeContext 错误地在每次 setTheme 变化后重复同步 host，这里会触发第二次 storageGet。
      await act(async () => {
        await Promise.resolve()
      })

      expect(getCalls).toBe(1)
      expect(screen.getByTestId("theme")).toHaveTextContent("dark")
    } finally {
      // 防止悬挂的 await 影响其它测试
      secondGet.resolve({ ok: true, result: { "oc-webgui-theme": "light" } })
    }
  })
})
