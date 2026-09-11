import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import type { ChangeEvent } from "react"
import type { LexicalEditor } from "lexical"
import { useFileAttachment } from "./useFileAttachment"
import { ideBridge } from "../../../lib/ideBridge"

const mocks = vi.hoisted(() => ({
  insertPaths: vi.fn(),
  pastePath: vi.fn(),
  insertAttachments: vi.fn(),
}))

function fileWithPath(name: string, type: string, path?: string) {
  const file = new File(["x"], name, { type })
  if (path) Object.defineProperty(file, "path", { value: path })
  return file
}

function changeEvent(files: File[]) {
  return {
    target: { files },
  } as unknown as ChangeEvent<HTMLInputElement>
}

function setup() {
  const editor = {
    update: vi.fn((fn: () => void) => fn()),
  } as unknown as LexicalEditor
  const hook = renderHook(() =>
    useFileAttachment(editor, mocks.insertPaths, mocks.pastePath, mocks.insertAttachments),
  )
  return hook.result.current
}

function selectFilesReply(paths: string[]) {
  return { type: "selectFiles", ok: true, result: { cancelled: false, paths } }
}

function readFilesReply(files: Array<{ path: string; base64?: string; error?: string }>) {
  return { type: "readFiles", ok: true, result: { files } }
}

describe("useFileAttachment", () => {
  beforeEach(() => {
    mocks.insertPaths.mockReset()
    mocks.pastePath.mockReset()
    mocks.insertAttachments.mockReset()
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(false)
  })

  it("纯浏览器下非图片文件有真实路径时作为完整文件路径插入", async () => {
    const { handleFileChange } = setup()
    const file = fileWithPath("notes.txt", "text/plain", "C:/repo/notes.txt")

    await act(async () => {
      await handleFileChange(changeEvent([file]))
    })

    expect(mocks.insertPaths).toHaveBeenCalledWith(["C:/repo/notes.txt"])
    expect(mocks.insertAttachments).not.toHaveBeenCalled()
  })

  it("纯浏览器下 PDF 有真实路径时作为完整路径插入", async () => {
    const { handleFileChange } = setup()
    const file = fileWithPath("doc.pdf", "application/pdf", "C:/repo/doc.pdf")

    await act(async () => {
      await handleFileChange(changeEvent([file]))
    })

    expect(mocks.insertPaths).toHaveBeenCalledWith(["C:/repo/doc.pdf"])
  })

  it("纯浏览器下二进制文件有真实路径时作为完整路径插入", async () => {
    const { handleFileChange } = setup()
    const file = fileWithPath("archive.zip", "application/zip", "C:/repo/archive.zip")

    await act(async () => {
      await handleFileChange(changeEvent([file]))
    })

    expect(mocks.insertPaths).toHaveBeenCalledWith(["C:/repo/archive.zip"])
  })

  it("纯浏览器下无物理路径时统一回退以文件名插入引用，不弹错", async () => {
    const { handleFileChange } = setup()
    const file = fileWithPath("Ventoy2Disk.exe", "application/x-msdownload")

    await act(async () => {
      await handleFileChange(changeEvent([file]))
    })

    expect(mocks.insertPaths).toHaveBeenCalledWith(["Ventoy2Disk.exe"])
  })

  it("纯浏览器下图片无物理路径时也转为图片附件", async () => {
    const { handleFileChange } = setup()
    const file = fileWithPath("photo.png", "image/png")

    await act(async () => {
      await handleFileChange(changeEvent([file]))
    })

    expect(mocks.insertAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ filename: "photo.png", mime: "image/png", url: expect.stringContaining("data:image/png") }),
    ])
    expect(mocks.insertPaths).not.toHaveBeenCalled()
  })

  it("纯浏览器下图片有物理路径时仍转为图片附件而非路径引用", async () => {
    const { handleFileChange } = setup()
    const file = fileWithPath("photo.png", "image/png", "C:/repo/photo.png")

    await act(async () => {
      await handleFileChange(changeEvent([file]))
    })

    expect(mocks.insertAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ filename: "photo.png", mime: "image/png" }),
    ])
    expect(mocks.insertPaths).not.toHaveBeenCalled()
  })

  it("Bridge 环境下选中的图片读取内容后作为图片附件插入", async () => {
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(true)
    const requestSpy = vi
      .spyOn(ideBridge, "request")
      .mockResolvedValueOnce(selectFilesReply(["C:/repo/photo.png"]))
      .mockResolvedValueOnce(readFilesReply([{ path: "C:/repo/photo.png", base64: "QUJD" }]))

    const { handleSelectFiles } = setup()
    await act(async () => {
      await handleSelectFiles()
    })

    expect(requestSpy).toHaveBeenNthCalledWith(1, "selectFiles", { mode: "file", multiple: true })
    expect(requestSpy).toHaveBeenNthCalledWith(2, "readFiles", { paths: ["C:/repo/photo.png"] })
    expect(mocks.insertAttachments).toHaveBeenCalledWith([
      expect.objectContaining({
        filename: "photo.png",
        mime: "image/png",
        url: "data:image/png;base64,QUJD",
        size: 3,
      }),
    ])
    expect(mocks.insertPaths).not.toHaveBeenCalled()
  })

  it("Bridge 环境下图片与非图片混合选择分别处理", async () => {
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(true)
    vi.spyOn(ideBridge, "request")
      .mockResolvedValueOnce(selectFilesReply(["C:/repo/photo.png", "C:/repo/notes.txt"]))
      .mockResolvedValueOnce(readFilesReply([{ path: "C:/repo/photo.png", base64: "QUJD" }]))

    const { handleSelectFiles } = setup()
    await act(async () => {
      await handleSelectFiles()
    })

    expect(mocks.insertAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ filename: "photo.png", mime: "image/png" }),
    ])
    expect(mocks.insertPaths).toHaveBeenCalledWith(["C:/repo/notes.txt"])
  })

  it("Bridge 环境下单张图片读取失败时回退为路径引用", async () => {
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(true)
    vi.spyOn(ideBridge, "request")
      .mockResolvedValueOnce(selectFilesReply(["C:/repo/broken.png"]))
      .mockResolvedValueOnce(readFilesReply([{ path: "C:/repo/broken.png", error: "boom" }]))

    const { handleSelectFiles } = setup()
    await act(async () => {
      await handleSelectFiles()
    })

    expect(mocks.insertAttachments).not.toHaveBeenCalled()
    expect(mocks.insertPaths).toHaveBeenCalledWith(["C:/repo/broken.png"])
  })

  it("Bridge 环境下 readFiles 请求失败时回退为路径引用", async () => {
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(true)
    vi.spyOn(ideBridge, "request")
      .mockResolvedValueOnce(selectFilesReply(["C:/repo/broken.png"]))
      .mockRejectedValueOnce(new Error("bridge unavailable"))

    const { handleSelectFiles } = setup()
    await act(async () => {
      await handleSelectFiles()
    })

    expect(mocks.insertAttachments).not.toHaveBeenCalled()
    expect(mocks.insertPaths).toHaveBeenCalledWith(["C:/repo/broken.png"])
  })

  it("Bridge 环境下选择非图片文件优先唤起原生文件对话框并插入真实绝对路径", async () => {
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(true)
    const requestSpy = vi.spyOn(ideBridge, "request").mockResolvedValue({
      type: "selectFiles",
      ok: true,
      result: { cancelled: false, paths: ["D:/Tools/Ventoy/Ventoy2Disk.exe", "D:/Tools/other.exe"] },
    })

    const { handleSelectFiles } = setup()
    await act(async () => {
      await handleSelectFiles()
    })

    expect(requestSpy).toHaveBeenCalledWith("selectFiles", { mode: "file", multiple: true })
    expect(mocks.insertPaths).toHaveBeenCalledWith([
      "D:/Tools/Ventoy/Ventoy2Disk.exe",
      "D:/Tools/other.exe",
    ])
  })

  it("Bridge 环境下选择文件夹唤起原生文件夹对话框并调用 pastePath", async () => {
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(true)
    const requestSpy = vi.spyOn(ideBridge, "request").mockResolvedValue({
      type: "selectFiles",
      ok: true,
      result: { cancelled: false, paths: ["D:/Projects/MyProject"] },
    })

    const { handleSelectDirectory } = setup()
    await act(async () => {
      await handleSelectDirectory()
    })

    expect(requestSpy).toHaveBeenCalledWith("selectFiles", { mode: "directory", multiple: false })
    expect(mocks.pastePath).toHaveBeenCalledWith("D:/Projects/MyProject")
  })

  it("Bridge 环境下用户取消对话框时不插入任何路径", async () => {
    vi.spyOn(ideBridge, "isInstalled").mockReturnValue(true)
    vi.spyOn(ideBridge, "request").mockResolvedValue({
      type: "selectFiles",
      ok: true,
      result: { cancelled: true, paths: [] },
    })

    const { handleSelectFiles } = setup()
    await act(async () => {
      await handleSelectFiles()
    })

    expect(mocks.insertPaths).not.toHaveBeenCalled()
    expect(mocks.pastePath).not.toHaveBeenCalled()
    expect(mocks.insertAttachments).not.toHaveBeenCalled()
  })

  it("纯浏览器下目录选择时提取首个路径并调用 pastePath", () => {
    const { handleDirectoryChange } = setup()
    const file = fileWithPath("index.ts", "text/plain", "C:/repo/src/index.ts")

    handleDirectoryChange(changeEvent([file]))

    expect(mocks.pastePath).toHaveBeenCalledWith("C:/repo/src")
  })

  it("纯浏览器下目录选择无物理路径且无 webkitRelativePath 时以名称兜底", () => {
    const { handleDirectoryChange } = setup()
    const file = fileWithPath("my-folder", "application/octet-stream")

    handleDirectoryChange(changeEvent([file]))

    expect(mocks.pastePath).toHaveBeenCalledWith("my-folder")
  })
})
