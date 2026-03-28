import { spawn, type ChildProcess } from "child_process"

type Proc = Pick<ChildProcess, "pid" | "kill" | "exitCode" | "signalCode">

type Run = {
  once(event: "exit" | "error", fn: () => void): unknown
}

type Opts = {
  platform?: NodeJS.Platform
  spawn?: (cmd: string, args: ReadonlyArray<string>, opts: { stdio: "ignore"; windowsHide: boolean }) => Run
  sleep?: (ms: number) => Promise<void>
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function done(child: Proc) {
  return child.exitCode != null || child.signalCode != null
}

export async function killTree(child: Proc, opts: Opts = {}) {
  const pid = child.pid
  if (!pid || done(child)) return

  if ((opts.platform ?? process.platform) === "win32") {
    await new Promise<void>((resolve) => {
      const killer = (opts.spawn ?? spawn)("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
    })
    return
  }

  try {
    process.kill(-pid, "SIGTERM")
    await (opts.sleep ?? wait)(200)
    if (!done(child)) {
      process.kill(-pid, "SIGKILL")
    }
  } catch {
    child.kill("SIGTERM")
    await (opts.sleep ?? wait)(200)
    if (!done(child)) {
      child.kill("SIGKILL")
    }
  }
}
