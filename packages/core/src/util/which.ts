import whichPkg from "which"
import path from "path"
import { Global } from "../global"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichAll(cmd, env)[0]
  return result ?? null
}

export function whichAll(cmd: string, env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  const full = base ? base + path.delimiter + Global.Path.bin : Global.Path.bin
  const result = whichPkg.sync(cmd, {
    nothrow: true,
    all: true,
    path: full,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  })
  if (!Array.isArray(result)) return []
  return Array.from(
    new Map(result.map((item) => [process.platform === "win32" ? item.toLowerCase() : item, item])).values(),
  )
}
