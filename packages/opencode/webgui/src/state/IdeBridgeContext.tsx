import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ideBridge } from "../lib/ideBridge"
import { useProject } from "./ProjectContext"
import { toProjectRelative } from "../utils/path"

interface IdeBridgeState {
  openedFiles: string[]
  currentFile: string | null
  timestamp: number | null
  customApi: boolean
}

const Ctx = createContext<IdeBridgeState | null>(null)

export function useIdeBridgeState() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useIdeBridgeState must be used within IdeBridgeProvider")
  return ctx
}

export function useCustomApi() {
  return useIdeBridgeState().customApi
}

interface ProviderProps {
  children: ReactNode
}

export function IdeBridgeProvider({ children }: ProviderProps) {
  const [openedFiles, setOpenedFiles] = useState<string[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [timestamp, setTimestamp] = useState<number | null>(null)
  const [customApi, setCustomApi] = useState(true)
  const { worktree } = useProject()

  const rel = (p: string): string => toProjectRelative(p, worktree)

  useEffect(() => {
    setCustomApi(ideBridge.customApi)
  }, [])

  useEffect(() => {
    const handler = (msg: any) => {
      if (!msg || typeof msg !== "object") return
      if (msg.type === "updateOpenedFiles") {
        const of = Array.isArray(msg.openedFiles)
          ? (msg.openedFiles as string[])
          : Array.isArray(msg.payload?.openedFiles)
            ? (msg.payload.openedFiles as string[])
            : []
        const cfRaw =
          typeof msg.currentFile === "string"
            ? (msg.currentFile as string)
            : typeof msg.payload?.currentFile === "string"
              ? (msg.payload.currentFile as string)
              : null
        const ts =
          typeof msg.timestamp === "number"
            ? (msg.timestamp as number)
            : typeof msg.payload?.timestamp === "number"
              ? (msg.payload.timestamp as number)
              : Date.now()
        const ofRel = of.map(rel)
        const cfRel = cfRaw ? rel(cfRaw) : null
        setOpenedFiles(ofRel)
        setCurrentFile(cfRel)
        setTimestamp(ts)
      }
    }
    ideBridge.on(handler)
    return () => ideBridge.off(handler)
  }, [worktree])

  const value = useMemo(
    () => ({ openedFiles, currentFile, timestamp, customApi }),
    [openedFiles, currentFile, timestamp, customApi],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
