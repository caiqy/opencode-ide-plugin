import { describe, expect, it } from "vitest"
import { isUnsupportedForwardedSystemFileDrop, isUnsupportedNativeSystemFileDrop } from "./dropUnsupported"

describe("dropUnsupported", () => {
  it("原生 drop 只有 Files 且没有解析路径时判定为系统文件管理器不支持", () => {
    expect(isUnsupportedNativeSystemFileDrop({ types: ["Files"], paths: [] })).toBe(true)
  })

  it("原生 drop 已解析出路径时不提示不支持", () => {
    expect(isUnsupportedNativeSystemFileDrop({ types: ["Files"], paths: ["C:/repo/a.ts"] })).toBe(false)
  })

  it("原生 drop 带 uri-list 时不提示不支持", () => {
    expect(isUnsupportedNativeSystemFileDrop({ types: ["Files", "text/uri-list"], paths: [] })).toBe(false)
  })

  it("wrapper 转发的 drop 只有 Files 且没有 uri-list 时判定为系统文件管理器不支持", () => {
    expect(
      isUnsupportedForwardedSystemFileDrop({
        dataTransfer: { types: ["Files"], data: { Files: "" } },
      }),
    ).toBe(true)
  })
})
