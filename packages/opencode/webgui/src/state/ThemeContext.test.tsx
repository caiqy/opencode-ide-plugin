import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen, waitFor } from "../test/test-utils"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(() => false),
    request: vi.fn(),
  },
}))

vi.mock("./repo/themeRepo", () => ({
  loadTheme: vi.fn(),
  saveTheme: vi.fn(),
}))

import { ThemeProvider, useTheme } from "./ThemeContext"
import { loadTheme, saveTheme } from "./repo/themeRepo"

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
    vi.mocked(loadTheme).mockResolvedValue("dark")
    vi.mocked(saveTheme).mockResolvedValue({ ok: true })
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

  it("会从 scoped global state 恢复主题", async () => {
    vi.mocked(loadTheme).mockResolvedValue("light")

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )

    await screen.findByText("light")
    expect(loadTheme).toHaveBeenCalledTimes(1)
  })

  it("切换主题会写入 scoped global state 且不触碰 localStorage", async () => {
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
      expect(saveTheme).toHaveBeenCalledWith("light")
    })
    expect(getSpy).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })
})
