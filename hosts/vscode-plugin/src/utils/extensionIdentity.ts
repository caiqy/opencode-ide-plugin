import * as vscode from "vscode"

export const extensionId = "caiqy.opencode-ui"

export function getExtension() {
  return vscode.extensions.getExtension(extensionId)
}
