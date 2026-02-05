import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { sdk } from "../lib/api/sdkClient"
import { __resetSlashSearchCache, useSlashSearch } from "./useSlashSearch"

describe("useSlashSearch", () => {
  beforeEach(() => {
    __resetSlashSearchCache()
    vi.restoreAllMocks()
  })

  it("loads commands/skills only once across unmount/remount", async () => {
    const list = vi.spyOn(sdk.command, "list").mockResolvedValue({
      data: [{ name: "init", description: "init", source: "command" }],
      error: null,
    } as any)
    const skills = vi.spyOn(sdk.app, "skills").mockResolvedValue({
      data: [{ name: "brainstorming", description: "design" }],
      error: null,
    })

    const a = renderHook(() => useSlashSearch(""))
    await waitFor(() => {
      expect(a.result.current.isLoading).toBe(false)
    })
    expect(list).toHaveBeenCalledTimes(1)
    expect(skills).toHaveBeenCalledTimes(1)
    a.unmount()

    const b = renderHook(() => useSlashSearch(""))
    await waitFor(() => {
      expect(b.result.current.isLoading).toBe(false)
    })
    expect(list).toHaveBeenCalledTimes(1)
    expect(skills).toHaveBeenCalledTimes(1)
  })

  it("surfaces an error when skills endpoint returns an error", async () => {
    vi.spyOn(sdk.command, "list").mockResolvedValue({ data: [], error: null } as any)
    vi.spyOn(sdk.app, "skills").mockResolvedValue({
      data: null,
      error: { message: "boom" },
    })

    const { result } = renderHook(() => useSlashSearch(""))
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.error?.message).toBe("boom")
  })
})
