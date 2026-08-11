import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const directory = resolve(import.meta.dir, "..")
const client = resolve(import.meta.dir, "../../client")
const core = resolve(import.meta.dir, "../../core")
const server = resolve(import.meta.dir, "../../server")

test("bundles the client and in-memory host", async () => {
  const inputs = await bundleInputs()

  expect(within(inputs, client).length).toBeGreaterThan(0)
  expect(within(inputs, core).length).toBeGreaterThan(0)
  expect(within(inputs, server).length).toBeGreaterThan(0)
})

async function bundleInputs() {
  const temporary = await mkdtemp(join(import.meta.dir, ".import-boundary-"))
  const entrypoint = join(temporary, "index.ts")
  try {
    await Bun.write(entrypoint, 'export * from "@opencode-ai/sdk-next"')
    const build = await Bun.build(
      Object.assign(
        {
          entrypoints: [entrypoint],
          target: "bun",
          format: "esm",
          packages: "bundle",
          metafile: true,
          outdir: join(temporary, "out"),
        } satisfies Parameters<typeof Bun.build>[0],
        { write: false },
      ),
    )
    if (!build.success) throw new AggregateError(build.logs, "Failed to bundle @opencode-ai/sdk-next")
    if (!build.metafile) throw new Error("SDK-next bundle did not produce a metafile")
    return Object.keys(build.metafile.inputs).map((input) => resolve(directory, input))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

function within(inputs: ReadonlyArray<string>, directory: string) {
  const prefix = directory.endsWith(sep) ? directory : directory + sep
  return inputs.filter((input) => input === directory || input.startsWith(prefix))
}
