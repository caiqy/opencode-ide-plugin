import { describe, expect, test } from "bun:test"
import path from "node:path"

describe("package dependencies", () => {
  test("declares generated image route runtime dependencies", async () => {
    const source = await Bun.file(
      path.join(import.meta.dir, "../../src/server/routes/instance/generated-image.ts"),
    ).text()
    const packageJson = await Bun.file(path.join(import.meta.dir, "../../package.json")).json()
    const dependencies = packageJson.dependencies ?? {}

    expect(source).toContain('from "hono"')
    expect(source).toContain('from "hono-openapi"')
    expect(dependencies.hono).toBeString()
    expect(dependencies["hono-openapi"]).toBeString()
  })
})
