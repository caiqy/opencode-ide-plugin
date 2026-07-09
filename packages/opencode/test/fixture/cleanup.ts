import fs from "fs/promises"
import path from "path"
import { setTimeout as sleep } from "node:timers/promises"

const WAIT = 20
const RETRY = 40

type Opts = {
  platform?: NodeJS.Platform
  rm?: (dir: string, opts: { recursive: true; force: true }) => Promise<void>
  sleep?: (ms: number) => Promise<void>
  gc?: (full: boolean) => void
}

const busy = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err && (err.code === "EBUSY" || err.code === "ENOTEMPTY")

const side = (file: string) => file.endsWith("-wal") || file.endsWith("-shm")

export async function cleanupTestDir(dir: string, opts: Opts = {}) {
  const rm = opts.rm ?? fs.rm
  const wait = opts.sleep ?? sleep
  const gc = opts.gc ?? Bun.gc

  const wipe = async (root: string): Promise<void> => {
    const list = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      list.flatMap((item) => {
        const file = path.join(root, item.name)
        if (item.isDirectory()) return [wipe(file)]
        if (!side(item.name)) return []
        return [fs.unlink(file).catch(() => {})]
      }),
    )
  }

  const drop = (left: number): Promise<void> =>
    rm(dir, { recursive: true, force: true }).catch((err) => {
      if ((opts.platform ?? process.platform) !== "win32") throw err
      if (!busy(err)) throw err
      if (left <= 1) throw err
      gc(true)
      return wait(WAIT).then(() => drop(left - 1))
    })

  await wipe(dir)
  return drop(RETRY)
}
