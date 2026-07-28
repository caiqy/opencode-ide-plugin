import whichPkg from "which"
import path from "path"
import { Global } from "../global"

export function which(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, options(env))
  return typeof result === "string" ? result : null
}

export function whichAll(cmd: string, env?: NodeJS.ProcessEnv) {
  const result = whichPkg.sync(cmd, { ...options(env), all: true })
  if (!Array.isArray(result)) return []
  return Array.from(
    new Map(result.map((item) => [process.platform === "win32" ? item.toLowerCase() : item, item])).values(),
  )
}

function options(env?: NodeJS.ProcessEnv) {
  const base = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? ""
  return {
    nothrow: true as const,
    path: base ? base + path.delimiter + Global.Path.bin : Global.Path.bin,
    pathExt: env?.PATHEXT ?? env?.PathExt ?? process.env.PATHEXT ?? process.env.PathExt,
  }
}
