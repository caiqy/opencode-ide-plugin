import * as os from "os"
import * as path from "path"
import { promises as fs } from "fs"
import type { ReleaseInfo } from "./ReleaseChecker"

type InstallInput = Pick<ReleaseInfo, "version" | "vsixUrl"> & {
  directory?: string
}

type InstallHooks = {
  onInstalling?: (filePath: string) => void
}

export class UpdateInstaller {
  private readonly defaultDirectory = path.join(os.tmpdir(), "opencode-update")

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly installVsix: (filePath: string) => Promise<unknown> = async (filePath) => {
      const vscode = await import("vscode")
      return vscode.commands.executeCommand("workbench.extensions.installExtension", vscode.Uri.file(filePath))
    },
  ) {}

  async install(input: InstallInput, hooks?: InstallHooks): Promise<string> {
    const response = await this.fetcher(input.vsixUrl)

    if (!response.ok) {
      throw new Error(`VSIX download failed: ${response.status}`)
    }

    const root = input.directory ?? this.defaultDirectory
    const filePath = path.join(root, `opencode-ui-${input.version}.vsix`)
    const buffer = Buffer.from(await response.arrayBuffer())

    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(filePath, buffer)
    hooks?.onInstalling?.(filePath)
    await this.installVsix(filePath)

    return filePath
  }
}

export type { InstallHooks, InstallInput }
