import { describe, expect, it, vi } from "vitest"
import { createDropCoordinator } from "./dropCoordinator"

describe("createDropCoordinator", () => {
  it("同一时间窗口内相同文件只插入一次", () => {
    let now = 1000
    const focus = vi.fn()
    const insertPaths = vi.fn()
    const pastePath = vi.fn()
    const coordinator = createDropCoordinator({ focus, insertPaths, pastePath, now: () => now, dedupeMs: 1000 })

    expect(coordinator.consume({ files: ["C:/repo/a.ts"] })).toBe(true)
    now = 1100
    expect(coordinator.consume({ files: ["C:/repo/a.ts"] })).toBe(false)

    expect(focus).toHaveBeenCalledOnce()
    expect(insertPaths).toHaveBeenCalledOnce()
    expect(insertPaths).toHaveBeenCalledWith(["C:/repo/a.ts"])
    expect(pastePath).not.toHaveBeenCalled()
  })

  it("时间窗口外同一路径可以再次插入", () => {
    let now = 1000
    const insertPaths = vi.fn()
    const coordinator = createDropCoordinator({ insertPaths, pastePath: vi.fn(), now: () => now, dedupeMs: 1000 })

    expect(coordinator.consume({ files: ["C:/repo/a.ts"] })).toBe(true)
    now = 2500
    expect(coordinator.consume({ files: ["C:/repo/a.ts"] })).toBe(true)

    expect(insertPaths).toHaveBeenCalledTimes(2)
  })

  it("Windows 路径分隔符不同也会视为同一个文件", () => {
    let now = 1000
    const insertPaths = vi.fn()
    const coordinator = createDropCoordinator({ insertPaths, pastePath: vi.fn(), now: () => now, dedupeMs: 1000 })

    expect(coordinator.consume({ files: ["C:/repo/a.ts"] })).toBe(true)
    now = 1100
    expect(coordinator.consume({ files: ["C:\\repo\\a.ts"] })).toBe(false)

    expect(insertPaths).toHaveBeenCalledOnce()
  })

  it("文件和目录通过各自 sink 插入，并过滤批次内重复项", () => {
    const focus = vi.fn()
    const insertPaths = vi.fn()
    const pastePath = vi.fn()
    const coordinator = createDropCoordinator({ focus, insertPaths, pastePath, now: () => 1000 })

    expect(
      coordinator.consume({
        files: ["C:/repo/a.ts", "C:/repo/a.ts", "C:/repo/b.ts"],
        directories: ["C:/repo/dir", "C:/repo/dir"],
      }),
    ).toBe(true)

    expect(focus).toHaveBeenCalledOnce()
    expect(insertPaths).toHaveBeenCalledWith(["C:/repo/a.ts", "C:/repo/b.ts"])
    expect(pastePath).toHaveBeenCalledOnce()
    expect(pastePath).toHaveBeenCalledWith("C:/repo/dir")
  })
})
