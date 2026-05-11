import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fileUtils from "./fileUtils"

describe("getGeneratedImageUrl", () => {
  it("正确编码 relativePath 和 directory 到专用图片路由", () => {
    expect(fileUtils.getGeneratedImageUrl("generated images/foo bar?#.png", "/repo/sub dir")).toBe(
      "/generated-image?path=generated+images%2Ffoo+bar%3F%23.png&directory=%2Frepo%2Fsub+dir",
    )
  })
})

describe("sanitizeFilename", () => {
  it("替换非法字符并保留可用文件名", () => {
    expect(fileUtils.sanitizeFilename(' report<>:"/\\|?*.png ')).toBe("report---------.png")
  })

  it("trim 后为空时回退到默认文件名", () => {
    expect(fileUtils.sanitizeFilename("   ")).toBe("image.png")
  })
})

describe("dataUrlToBlob", () => {
  it("返回正确的 type 和 size", () => {
    const blob = fileUtils.dataUrlToBlob("data:text/plain;base64,aGVsbG8=")

    expect(blob.type).toBe("text/plain")
    expect(blob.size).toBe(5)
  })

  it("支持带参数的 data URL", () => {
    const blob = fileUtils.dataUrlToBlob("data:text/plain;charset=utf-8;base64,aGVsbG8=")

    expect(blob.type).toBe("text/plain")
    expect(blob.size).toBe(5)
  })

  it("允许空 payload 并返回空 Blob", () => {
    const blob = fileUtils.dataUrlToBlob("data:text/plain;base64,")

    expect(blob.type).toBe("text/plain")
    expect(blob.size).toBe(0)
  })

  it("无效 data URL 时抛错", () => {
    expect(() => fileUtils.dataUrlToBlob("https://example.com/image.png")).toThrowError("Invalid data URL")
  })

  it("非法 base64 时也统一抛 Invalid data URL", () => {
    expect(() => fileUtils.dataUrlToBlob("data:image/png;base64,%%%")).toThrowError("Invalid data URL")
  })
})

describe("downloadUrl", () => {
  const createObjectURL = vi.fn(() => "blob:mock-url")
  const revokeObjectURL = vi.fn()
  let click: ReturnType<typeof vi.fn>
  let lastDownload = ""
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL
  let originalClick: typeof HTMLAnchorElement.prototype.click

  beforeEach(() => {
    vi.useFakeTimers()
    lastDownload = ""
    click = vi.fn(function (this: HTMLAnchorElement) {
      lastDownload = this.download
    })
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL
    originalClick = HTMLAnchorElement.prototype.click

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: click,
    })
  })

  afterEach(() => {
    document.body.innerHTML = ""
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    })
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: originalClick,
    })
    vi.useRealTimers()
  })

  it("带参数的 data URL 会创建 object URL、延迟释放，且下载文件名会被清洗", () => {
    fileUtils.downloadUrl("data:text/plain;charset=utf-8;base64,aGVsbG8=", "bad:name.png")

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(lastDownload).toBe("bad-name.png")
    expect(document.body.querySelector("a")).toBeNull()

    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.runAllTimers()

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url")
  })

  it("普通 URL 直接下载，且下载文件名会被清洗", () => {
    fileUtils.downloadUrl("https://example.com/image.png", "remote:name.png")

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
    expect(lastDownload).toBe("remote-name.png")
    expect(document.body.querySelector("a")).toBeNull()
  })
})
