import { describe, it, expect, beforeEach, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen, waitFor } from "../test/test-utils"

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
})
