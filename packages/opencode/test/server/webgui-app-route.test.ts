import { afterEach, describe, expect, test } from "bun:test"
import { embeddedWebGui } from "../../src/webgui/embed.generated"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function decoded(path: string) {
  const file = embeddedWebGui.find((item) => item.path === path)
  if (!file) throw new Error(`Missing embedded file: ${path}`)
  return Buffer.from(file.data, "base64")
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("webgui app route", () => {
  test("serves embedded index from /app", async () => {
    const response = await Server.App().request("/app")
    const text = await response.text()
    const expected = decoded("index.html").toString("utf8")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/html")
    expect(text).toBe(expected)
  }, 20_000)

  test("serves embedded assets from /app/assets", async () => {
    const assetPath = embeddedWebGui.find((item) => item.path.endsWith(".js"))?.path
    if (!assetPath) throw new Error("Missing embedded js asset")

    const response = await Server.App().request(`/app/${assetPath}`)
    const text = await response.text()
    const expected = decoded(assetPath).toString("utf8")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("javascript")
    expect(text).toBe(expected)
  })
})
