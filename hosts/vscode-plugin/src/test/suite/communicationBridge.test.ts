import { ok } from "assert"
import { commands, Uri } from "vscode"
import { match, restore, stub } from "sinon"
import { CommunicationBridge } from "../../ui/CommunicationBridge"

suite("CommunicationBridge Test Suite", () => {
  teardown(() => restore())

  test("opens a binary file through VSCode's native file command", async () => {
    const open = stub(commands, "executeCommand").resolves()
    const file = Uri.file("D:/repo/opencode.vsix")

    await new CommunicationBridge().handleOpenFile(file.fsPath)

    ok(
      open.calledWith(
        "vscode.open",
        match((value: Uri) => value.fsPath === file.fsPath),
      ),
    )
  })

  test("accepts case-insensitive file URLs", async () => {
    const open = stub(commands, "executeCommand").resolves()
    const file = Uri.file("D:/repo/opencode.vsix")

    await new CommunicationBridge().handleOpenFile("FILE:///D:/repo/opencode.vsix")

    ok(
      open.calledWith(
        "vscode.open",
        match((value: Uri) => value.fsPath === file.fsPath),
      ),
    )
  })
})
