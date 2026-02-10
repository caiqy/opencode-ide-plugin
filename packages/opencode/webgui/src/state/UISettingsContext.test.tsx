import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { UISettingsProvider, useUISettings } from "./UISettingsContext"

function wrapper(props: { children: ReactNode }) {
  return <UISettingsProvider>{props.children}</UISettingsProvider>
}

describe("UISettingsContext", () => {
  it("provides context without error", () => {
    const { result } = renderHook(() => useUISettings(), { wrapper })
    expect(result.current).toBeDefined()
  })
})
