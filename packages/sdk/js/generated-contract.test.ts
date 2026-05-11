import { describe, expect, test } from "bun:test"

async function read(file: string) {
  return await Bun.file(new URL(file, import.meta.url)).text()
}

function expectRelativePath(text: string) {
  expect(text).toMatch(/export type FilePart = \{[\s\S]*?relativePath\?: string[\s\S]*?\}/)
  expect(text).toMatch(/export type FilePartInput = \{[\s\S]*?relativePath\?: string[\s\S]*?\}/)
}

function expectOpenApiRelativePath(text: string) {
  expect(text).toMatch(/"FilePart": \{[\s\S]*?"relativePath": \{[\s\S]*?"type": "string"[\s\S]*?\}/)
  expect(text).toMatch(/"FilePartInput": \{[\s\S]*?"relativePath": \{[\s\S]*?"type": "string"[\s\S]*?\}/)
}

describe("generated SDK contract", () => {
  test("v1 types include generated image relativePath", async () => {
    expectRelativePath(await read("./src/gen/types.gen.ts"))
  })

  test("v2 types include generated image relativePath", async () => {
    expectRelativePath(await read("./src/v2/gen/types.gen.ts"))
  })

  test("checked-in openapi schema includes generated image relativePath", async () => {
    expectOpenApiRelativePath(await read("../openapi.json"))
  })
})
