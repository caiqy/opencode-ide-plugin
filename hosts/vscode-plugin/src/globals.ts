import * as vscode from "vscode"
import type { UpdateService } from "./update/UpdateService"

export const logger = vscode.window.createOutputChannel("OpenCode Extension")

let updateService: UpdateService | undefined

export function setUpdateService(service: UpdateService | undefined): void {
  updateService = service
}

export function getUpdateService(): UpdateService | undefined {
  return updateService
}
