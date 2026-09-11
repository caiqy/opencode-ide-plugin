import { useCallback, useRef } from "react"
import { type LexicalEditor } from "lexical"
import { ideBridge } from "../../../lib/ideBridge"
import {
  fileToDataURL,
  getExtensionFromFilename,
  getMimeTypeFromExtension,
  isImageFile,
} from "../../../lib/fileUtils"
import type { AttachmentMetadata } from "../../attachment/AttachmentNode"

type ReadFilesResult = {
  files?: Array<{ path?: string; base64?: string; error?: string }>
}

function filenameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function imageAttachment(input: { filename: string; mime: string; url: string; size: number }): AttachmentMetadata {
  return {
    id: crypto.randomUUID(),
    display: input.filename,
    filename: input.filename,
    mime: input.mime,
    url: input.url,
    size: input.size,
  }
}

function estimateSizeFromBase64(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

export function useFileAttachment(
  _editor: LexicalEditor,
  insertPaths: (paths: string[]) => void,
  pastePath?: (path: string) => void,
  insertAttachments?: (attachments: AttachmentMetadata[]) => void,
) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const directoryInputRef = useRef<HTMLInputElement | null>(null)

  const readImageAttachments = useCallback(
    async (paths: string[]): Promise<{ attachments: AttachmentMetadata[]; failed: string[] }> => {
      try {
        const response = await ideBridge.request<ReadFilesResult>("readFiles", { paths })
        const files = Array.isArray(response.result?.files) ? response.result.files : []
        const attachments: AttachmentMetadata[] = []
        const failed: string[] = []

        for (const path of paths) {
          const file = files.find((item) => item?.path === path)
          if (!file?.base64) {
            failed.push(path)
            continue
          }
          const filename = filenameFromPath(path)
          const mime = getMimeTypeFromExtension(getExtensionFromFilename(path))
          attachments.push(
            imageAttachment({
              filename,
              mime,
              url: `data:${mime};base64,${file.base64}`,
              size: estimateSizeFromBase64(file.base64),
            }),
          )
        }

        return { attachments, failed }
      } catch (err) {
        console.warn("[useFileAttachment] ideBridge readFiles failed, falling back to paths", err)
        return { attachments: [], failed: paths }
      }
    },
    [],
  )

  const applySelectedPaths = useCallback(
    async (paths: string[]) => {
      const imagePaths: string[] = []
      const otherPaths: string[] = []
      for (const path of paths) {
        const mime = getMimeTypeFromExtension(getExtensionFromFilename(path))
        if (isImageFile(mime)) {
          imagePaths.push(path)
        } else {
          otherPaths.push(path)
        }
      }

      if (imagePaths.length > 0) {
        if (!insertAttachments) {
          insertPaths(imagePaths)
        } else {
          const { attachments, failed } = await readImageAttachments(imagePaths)
          if (attachments.length > 0) insertAttachments(attachments)
          if (failed.length > 0) insertPaths(failed)
        }
      }

      if (otherPaths.length > 0) insertPaths(otherPaths)
    },
    [insertAttachments, insertPaths, readImageAttachments],
  )

  const handleSelectFiles = useCallback(async () => {
    if (ideBridge.isInstalled()) {
      try {
        const response = await ideBridge.request<{ cancelled: boolean; paths: string[] }>("selectFiles", {
          mode: "file",
          multiple: true,
        })
        const result = response.result
        if (result && !result.cancelled && Array.isArray(result.paths) && result.paths.length > 0) {
          await applySelectedPaths(result.paths)
          return
        }
        if (result?.cancelled) {
          return
        }
      } catch (err) {
        console.warn("[useFileAttachment] ideBridge selectFiles failed, falling back to input", err)
      }
    }
    fileInputRef.current?.click()
  }, [applySelectedPaths])

  const handleSelectDirectory = useCallback(async () => {
    if (ideBridge.isInstalled()) {
      try {
        const response = await ideBridge.request<{ cancelled: boolean; paths: string[] }>("selectFiles", {
          mode: "directory",
          multiple: false,
        })
        const result = response.result
        if (result && !result.cancelled && Array.isArray(result.paths) && result.paths.length > 0) {
          const dir = result.paths[0]
          if (dir) {
            if (pastePath) {
              pastePath(dir)
            } else {
              insertPaths([dir.endsWith("/") ? dir : `${dir}/`])
            }
          }
          return
        }
        if (result?.cancelled) {
          return
        }
      } catch (err) {
        console.warn("[useFileAttachment] ideBridge selectDirectory failed, falling back to input", err)
      }
    }
    directoryInputRef.current?.click()
  }, [insertPaths, pastePath])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      for (const file of Array.from(files)) {
        const mime = file.type || getMimeTypeFromExtension(getExtensionFromFilename(file.name))
        if (isImageFile(mime) && insertAttachments) {
          try {
            const url = await fileToDataURL(file)
            insertAttachments([imageAttachment({ filename: file.name, mime, url, size: file.size })])
            continue
          } catch (err) {
            console.warn("[useFileAttachment] failed to read selected image, falling back to reference", err)
          }
        }

        const filePath =
          typeof (file as unknown as { path?: unknown }).path === "string"
            ? (file as unknown as { path: string }).path
            : undefined
        if (filePath) {
          insertPaths([filePath])
          continue
        }

        // In standard browser sandboxes file.path is unavailable, so we safely fallback
        // to using file.name as a mention instead of blocking with an error toast.
        insertPaths([file.name])
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [insertAttachments, insertPaths],
  )

  const handleDirectoryChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return
      const first = files[0]
      const dirPath =
        typeof (first as unknown as { path?: unknown }).path === "string"
          ? (first as unknown as { path: string }).path
          : undefined
      if (dirPath) {
        const dir = dirPath.replace(/[\\/][^\\/]+$/, "")
        if (pastePath) {
          pastePath(dir)
        } else {
          insertPaths([dir.endsWith("/") ? dir : `${dir}/`])
        }
      } else if (first.webkitRelativePath) {
        const rootDir = first.webkitRelativePath.split("/")[0]
        if (pastePath) {
          pastePath(rootDir)
        } else {
          insertPaths([`${rootDir}/`])
        }
      } else {
        const fallbackName = first.name || "directory"
        if (pastePath) {
          pastePath(fallbackName)
        } else {
          insertPaths([`${fallbackName}/`])
        }
      }
      if (directoryInputRef.current) {
        directoryInputRef.current.value = ""
      }
    },
    [insertPaths, pastePath],
  )

  return {
    fileInputRef,
    directoryInputRef,
    handleFileSelect: handleSelectFiles,
    handleSelectFiles,
    handleSelectDirectory,
    handleFileChange,
    handleDirectoryChange,
  }
}
