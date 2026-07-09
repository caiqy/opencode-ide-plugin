import { extractPathsFromDrop } from "./dnd"

/** Helper to build a minimal DragEvent with a fake DataTransfer */
function makeDragEvent(opts: {
  types?: string[]
  data?: Record<string, string>
  items?: Array<{
    kind: string
    getAsFile?: () => { path?: string }
    webkitGetAsEntry?: () => { isDirectory: boolean }
  }>
  files?: Array<{ path?: string }>
}): DragEvent {
  const data = opts.data ?? {}
  const types = opts.types ?? Object.keys(data)
  const items = opts.items ?? []
  const files = opts.files ?? []

  const dt = {
    types,
    getData: (type: string) => data[type] ?? "",
    items: Object.assign(items, { length: items.length }),
    files: Object.assign(files, { length: files.length }),
  }

  return { dataTransfer: dt } as unknown as DragEvent
}

describe("extractPathsFromDrop", () => {
  it("returns empty array when dataTransfer is null", () => {
    const ev = { dataTransfer: null } as unknown as DragEvent
    expect(extractPathsFromDrop(ev)).toEqual([])
  })

  describe("DataTransferItem path extraction (Electron)", () => {
    it("extracts file paths from items with .path", () => {
      const ev = makeDragEvent({
        items: [
          { kind: "file", getAsFile: () => ({ path: "/home/user/file.ts" }) },
          { kind: "file", getAsFile: () => ({ path: "/home/user/other.ts" }) },
        ],
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts", "/home/user/other.ts"])
    })

    it("skips directories detected via webkitGetAsEntry", () => {
      const ev = makeDragEvent({
        items: [
          {
            kind: "file",
            getAsFile: () => ({ path: "/home/user/dir" }),
            webkitGetAsEntry: () => ({ isDirectory: true }),
          },
          { kind: "file", getAsFile: () => ({ path: "/home/user/file.ts" }) },
        ],
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })

    it("skips non-file items", () => {
      const ev = makeDragEvent({
        items: [{ kind: "string" } as any, { kind: "file", getAsFile: () => ({ path: "/home/user/file.ts" }) }],
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })
  })

  describe("text/uri-list extraction", () => {
    it("extracts POSIX paths from file:// URIs", () => {
      const ev = makeDragEvent({
        types: ["text/uri-list"],
        data: { "text/uri-list": "file:///home/user/project/main.ts\nfile:///home/user/project/lib.ts" },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/project/main.ts", "/home/user/project/lib.ts"])
    })

    it("extracts Windows paths from file:// URIs", () => {
      const ev = makeDragEvent({
        types: ["text/uri-list"],
        data: { "text/uri-list": "file:///C:/Users/dev/project/main.ts" },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["C:/Users/dev/project/main.ts"])
    })

    it("falls back to application/vnd.code.uri-list", () => {
      const ev = makeDragEvent({
        types: ["application/vnd.code.uri-list"],
        data: { "application/vnd.code.uri-list": "file:///home/user/file.ts" },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })

    it("skips comment lines and empty lines", () => {
      const ev = makeDragEvent({
        types: ["text/uri-list"],
        data: { "text/uri-list": "# comment\n\nfile:///home/user/file.ts\n" },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })

    it("skips directory paths", () => {
      const ev = makeDragEvent({
        types: ["text/uri-list"],
        data: { "text/uri-list": "file:///home/user/dir/\nfile:///home/user/file.ts" },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })
  })

  describe("VSCode explorer tree extraction", () => {
    it("extracts paths from explorer tree JSON", () => {
      const treeData = JSON.stringify([{ uri: "file:///home/user/project/index.ts" }])
      const ev = makeDragEvent({
        types: ["application/vnd.code.tree.explorer"],
        data: { "application/vnd.code.tree.explorer": treeData },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/project/index.ts"])
    })

    it("handles resource.uri format", () => {
      const treeData = JSON.stringify([{ resource: { uri: "file:///home/user/project/index.ts" } }])
      const ev = makeDragEvent({
        types: ["application/vnd.code.tree.explorer"],
        data: { "application/vnd.code.tree.explorer": treeData },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/project/index.ts"])
    })
  })

  describe("deduplication: uri-list + explorer tree", () => {
    it("does NOT produce duplicates when both uri-list and explorer tree contain the same file", () => {
      const fileUri = "file:///C:/Users/dev/project/app.vsix"
      const treeData = JSON.stringify([{ uri: fileUri }])
      const ev = makeDragEvent({
        types: ["text/uri-list", "application/vnd.code.tree.explorer"],
        data: {
          "text/uri-list": fileUri,
          "application/vnd.code.tree.explorer": treeData,
        },
      })
      const result = extractPathsFromDrop(ev)
      expect(result).toEqual(["C:/Users/dev/project/app.vsix"])
    })

    it("uses explorer tree when uri-list is empty", () => {
      const treeData = JSON.stringify([{ uri: "file:///home/user/file.ts" }])
      const ev = makeDragEvent({
        types: ["text/uri-list", "application/vnd.code.tree.explorer"],
        data: {
          "text/uri-list": "",
          "application/vnd.code.tree.explorer": treeData,
        },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })

    it("uses explorer tree when uri-list only has directories", () => {
      const treeData = JSON.stringify([{ uri: "file:///home/user/file.ts" }])
      const ev = makeDragEvent({
        types: ["text/uri-list", "application/vnd.code.tree.explorer"],
        data: {
          "text/uri-list": "file:///home/user/dir/",
          "application/vnd.code.tree.explorer": treeData,
        },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })
  })

  describe("text/plain fallback", () => {
    it("extracts absolute POSIX paths from plain text", () => {
      const ev = makeDragEvent({
        types: ["text/plain"],
        data: { "text/plain": "/home/user/file.ts" },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })

    it("extracts Windows paths from plain text", () => {
      const ev = makeDragEvent({
        types: ["text/plain"],
        data: { "text/plain": "C:\\Users\\dev\\file.ts" },
      })
      expect(extractPathsFromDrop(ev)).toEqual(["C:\\Users\\dev\\file.ts"])
    })

    it("does not use text/plain when file-type indicators are present", () => {
      const ev = makeDragEvent({
        types: ["text/uri-list", "text/plain"],
        data: {
          "text/uri-list": "",
          "text/plain": "/home/user/file.ts",
        },
      })
      // text/plain is suppressed because hasFileTypes is true
      expect(extractPathsFromDrop(ev)).toEqual([])
    })
  })

  describe("dt.files fallback", () => {
    it("extracts paths from dt.files when other methods fail", () => {
      const ev = makeDragEvent({
        types: [],
        files: [{ path: "/home/user/dropped.ts" }],
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/dropped.ts"])
    })

    it("skips files without path", () => {
      const ev = makeDragEvent({
        types: [],
        files: [{ path: "" }, { path: "/home/user/file.ts" }],
      })
      expect(extractPathsFromDrop(ev)).toEqual(["/home/user/file.ts"])
    })
  })
})
