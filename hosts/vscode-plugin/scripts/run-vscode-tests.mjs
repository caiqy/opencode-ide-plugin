import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const registryKey = String.raw`HKCU\Software\Classes\vscode`

try {
  process.exitCode = await main()
} catch (error) {
  console.error(formatError(error))
  process.exitCode = 1
}

async function main() {
  const snapshot = process.platform === "win32" ? await snapshotProtocolHandler() : undefined

  try {
    return await runTests()
  } finally {
    if (snapshot) {
      await restoreProtocolHandler(snapshot)
    }
  }
}

async function snapshotProtocolHandler() {
  const existed = registryExists()

  if (!existed) {
    return { existed }
  }

  const directory = await mkdtemp(path.join(tmpdir(), "opencode-vscode-test-"))
  const file = path.join(directory, "vscode.reg")

  try {
    runRegistry(["export", registryKey, file, "/y"])
    return { directory, existed, file }
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    throw new Error(`Could not snapshot ${registryKey}. ${formatError(error)}`)
  }
}

async function restoreProtocolHandler(snapshot) {
  try {
    if (registryExists()) {
      runRegistry(["delete", registryKey, "/f"])
    }

    if (snapshot.existed) {
      runRegistry(["import", snapshot.file])
    }
  } catch (error) {
    const backup = snapshot.file ? ` Backup retained at ${snapshot.file}.` : ""
    throw new Error(`Could not restore ${registryKey}.${backup} ${formatError(error)}`)
  }

  if (snapshot.directory) {
    try {
      await rm(snapshot.directory, { force: true, recursive: true })
    } catch (error) {
      throw new Error(
        `Restored ${registryKey} but could not remove backup directory ${snapshot.directory}. Backup retained at ${snapshot.file}. ${formatError(error)}`,
      )
    }
  }
}

function registryExists() {
  const result = spawnSync("reg.exe", ["query", registryKey], { stdio: "ignore" })

  if (result.error) {
    throw result.error
  }

  if (result.status === 0) {
    return true
  }

  if (result.status === 1) {
    return false
  }

  throw new Error(`reg.exe query exited with ${result.status}`)
}

function runRegistry(args) {
  const result = spawnSync("reg.exe", args, { stdio: "ignore" })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`reg.exe ${args[0]} exited with ${result.status}`)
  }
}

function runTests() {
  const cliPath = path.join(
    process.cwd(),
    "node_modules",
    "@vscode",
    "test-cli",
    "out",
    "bin.mjs",
  )

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
      detached: process.platform === "win32", // Keep Ctrl+C on the wrapper so taskkill owns teardown.
      shell: false,
      stdio: process.platform === "win32" ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: process.platform === "win32",
    })
    child.stdout?.pipe(process.stdout)
    child.stderr?.pipe(process.stderr)
    const signals = new Map([
      ["SIGINT", 130],
      ["SIGTERM", 143],
      ...(process.platform === "win32" ? [["SIGBREAK", 131]] : []),
    ])
    let signalFailure
    let stopRequested = false

    const rememberSignalFailure = (message) => {
      if (signalFailure) {
        return
      }

      signalFailure = new Error(message)
      console.error(message)
    }

    const handlers = [...signals].map(([signal]) => {
      const handler = () => {
        if (stopRequested) {
          return
        }

        stopRequested = true

        if (process.platform !== "win32") {
          if (!child.killed) {
            child.kill(signal)
          }
          return
        }

        if (child.pid === undefined) {
          rememberSignalFailure(`Could not taskkill VS Code test process tree after ${signal}: missing child pid.`)
          return
        }

        const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "inherit",
        })

        if (result.error) {
          rememberSignalFailure(
            `Could not taskkill VS Code test process tree for PID ${child.pid} after ${signal}. ${formatError(result.error)}`,
          )
          return
        }

        if (result.status !== 0) {
          rememberSignalFailure(`taskkill.exe /PID ${child.pid} /T /F exited with ${result.status} after ${signal}.`)
        }
      }
      process.once(signal, handler)
      return [signal, handler]
    })

    const removeHandlers = () => {
      handlers.forEach(([signal, handler]) => process.removeListener(signal, handler))
    }

    child.once("error", (error) => {
      removeHandlers()
      reject(new Error(`Could not start VS Code test CLI. ${formatError(error)}`))
    })
    child.once("exit", (code, signal) => {
      removeHandlers()

      if (signalFailure) {
        reject(signalFailure)
        return
      }

      resolve(code ?? signals.get(signal) ?? 1)
    })
  })
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
