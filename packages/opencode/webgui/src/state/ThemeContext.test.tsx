import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen, waitFor } from "../test/test-utils"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(() => false),
    request: vi.fn(),
  },
}))

vi.mock("./globalState", () => ({
  globalStateGetJSON: vi.fn(),
  globalStateSetJSON: vi.fn(),
}))

import { ThemeProvider, useTheme } from "./ThemeContext"
import { globalStateGetJSON, globalStateSetJSON } from "./globalState"

function Probe() {
  const theme = useTheme()
  return (
    <div>
      <div data-testid="theme">{theme.theme}</div>
      <button onClick={theme.toggleTheme}>toggle</button>
    </div>
  )
}

describe("ThemeContext", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    document.documentElement.classList.remove("dark")
    vi.mocked(globalStateGetJSON).mockResolvedValue("dark")
    vi.mocked(globalStateSetJSON).mockResolvedValue({ ok: true })
  })

  it("默认主题为 dark", async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    await screen.findByText("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("会从 globalState 恢复主题", async () => {
    vi.mocked(globalStateGetJSON).mockResolvedValue("light")

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    await screen.findByText("light")
    expect(globalStateGetJSON).toHaveBeenCalledWith("opencode:webgui:theme:v1", "dark")
  })

  it("切换主题会写入 globalState 且不触碰 localStorage", async () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem")
    const setSpy = vi.spyOn(Storage.prototype, "setItem")
    const user = userEvent.setup()

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    await screen.findByTestId("theme")
    await user.click(screen.getByText("toggle"))

    await waitFor(() => {
      expect(globalStateSetJSON).toHaveBeenCalledWith("opencode:webgui:theme:v1", "light")
    })
    expect(getSpy).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })
})
