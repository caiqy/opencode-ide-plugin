import { describe, expect, test } from "bun:test"
import os from "os"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppProcess } from "@opencode-ai/core/process"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()

function withUiVersion<T>(version: string | undefined, run: () => T): T {
  const previous = process.env.OPENCODE_UI_VERSION
  if (version === undefined) {
    delete process.env.OPENCODE_UI_VERSION
  } else {
    process.env.OPENCODE_UI_VERSION = version
  }

  try {
    return run()
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCODE_UI_VERSION
    } else {
      process.env.OPENCODE_UI_VERSION = previous
    }
  }
}

function withNpmRegistryEffect<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const lower = process.env.npm_config_registry
      const upper = process.env.NPM_CONFIG_REGISTRY
      process.env.npm_config_registry = "https://registry.npmjs.org/"
      process.env.NPM_CONFIG_REGISTRY = "https://registry.npmjs.org/"
      return { lower, upper }
    }),
    () => effect,
    ({ lower, upper }) =>
      Effect.sync(() => {
        if (lower === undefined) {
          delete process.env.npm_config_registry
        } else {
          process.env.npm_config_registry = lower
        }
        if (upper === undefined) {
          delete process.env.NPM_CONFIG_REGISTRY
        } else {
          process.env.NPM_CONFIG_REGISTRY = upper
        }
      }),
  )
}

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string,
) {
  const appProcess = AppProcess.layer.pipe(Layer.provide(mockSpawner(spawnHandler)))
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(appProcess))
}

describe("installation", () => {
  describe("userAgent", () => {
    test("builds the default opencode UI user agent", () => {
      withUiVersion(undefined, () => {
        expect(Installation.userAgent()).toBe(`opencode/${InstallationVersion} opencode-ui/${InstallationVersion}`)
      })
    })

    test("uses injected UI version for the default opencode UI user agent", () => {
      withUiVersion("26.5.1602", () => {
        expect(Installation.userAgent()).toBe(`opencode/${InstallationVersion} opencode-ui/26.5.1602`)
      })
    })

    test("falls back to installation version when injected UI version is blank", () => {
      withUiVersion("   ", () => {
        expect(Installation.userAgent()).toBe(`opencode/${InstallationVersion} opencode-ui/${InstallationVersion}`)
      })
    })

    test("builds the installation-scoped user agent", () => {
      withUiVersion(undefined, () => {
        expect(Installation.userAgent({ base: "installation" })).toBe(
          `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT} opencode-ui/${InstallationVersion}`,
        )
      })
    })

    test("uses injected UI version for installation-scoped user agent", () => {
      withUiVersion("26.5.1602", () => {
        expect(Installation.userAgent({ base: "installation" })).toBe(
          `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT} opencode-ui/26.5.1602`,
        )
      })
    })

    test("keeps provider integration products before the UI product", () => {
      withUiVersion(undefined, () => {
        expect(Installation.userAgent({ products: ["gitlab-ai-provider/1.2.3"] })).toBe(
          `opencode/${InstallationVersion} gitlab-ai-provider/1.2.3 opencode-ui/${InstallationVersion}`,
        )
      })
    })

    test("keeps provider products before injected UI product", () => {
      withUiVersion("26.5.1602", () => {
        expect(Installation.userAgent({ products: ["gitlab-ai-provider/1.2.3"] })).toBe(
          `opencode/${InstallationVersion} gitlab-ai-provider/1.2.3 opencode-ui/26.5.1602`,
        )
      })
    })

    test("adds system details to the comment", () => {
      withUiVersion(undefined, () => {
        expect(Installation.userAgent({ system: true })).toBe(
          `opencode/${InstallationVersion} opencode-ui/${InstallationVersion} (${os.platform()} ${os.release()}; ${os.arch()})`,
        )
      })
    })
  })

  describe("latest", () => {
    test("sends installation user agent and preserves accept header to version APIs", async () => {
      let headers: HttpClientRequest.HttpClientRequest["headers"] | undefined
      const layer = testLayer((request) => {
        headers = request.headers
        return jsonResponse({ tag_name: "v1.2.3" })
      })

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("unknown")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("1.2.3")
      expect(headers?.["user-agent"]).toBe(Installation.USER_AGENT)
      expect(headers?.accept).toBe("application/json")
    })

    testEffect(testLayer(() => jsonResponse({ tag_name: "v1.2.3" }))).effect(
      "reads release version from GitHub releases",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.Service.use((svc) => svc.latest("unknown"))
          expect(result).toBe("1.2.3")
        }),
    )

    testEffect(testLayer(() => jsonResponse({ tag_name: "v4.0.0-beta.1" }))).effect(
      "strips v prefix from GitHub release tag",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.Service.use((svc) => svc.latest("curl"))
          expect(result).toBe("4.0.0-beta.1")
        }),
    )

    const npmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        npmCalls.push(request.url)
        return jsonResponse({ version: "1.5.0" })
      }),
    ).effect("reads npm versions via registry", () =>
      withNpmRegistryEffect(Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("npm"))
        expect(result).toBe("1.5.0")
        expect(npmCalls).toContain(`https://registry.npmjs.org/opencode-ai/${InstallationChannel}`)
      })),
    )

    const bunCalls: string[] = []
    testEffect(
      testLayer((request) => {
        bunCalls.push(request.url)
        return jsonResponse({ version: "1.6.0" })
      }),
    ).effect("reads bun versions via registry", () =>
      withNpmRegistryEffect(Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("bun"))
        expect(result).toBe("1.6.0")
        expect(bunCalls).toContain(`https://registry.npmjs.org/opencode-ai/${InstallationChannel}`)
      })),
    )

    const pnpmCalls: string[] = []
    testEffect(
      testLayer((request) => {
        pnpmCalls.push(request.url)
        return jsonResponse({ version: "1.7.0" })
      }),
    ).effect("reads pnpm versions via registry", () =>
      withNpmRegistryEffect(Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("pnpm"))
        expect(result).toBe("1.7.0")
        expect(pnpmCalls).toContain(`https://registry.npmjs.org/opencode-ai/${InstallationChannel}`)
      })),
    )

    testEffect(testLayer(() => jsonResponse({ version: "2.3.4" }))).effect("reads scoop manifest versions", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("scoop"))
        expect(result).toBe("2.3.4")
      }),
    )

    testEffect(testLayer(() => jsonResponse({ d: { results: [{ Version: "3.4.5" }] } }))).effect(
      "reads chocolatey feed versions",
      () =>
        Effect.gen(function* () {
          const result = yield* Installation.Service.use((svc) => svc.latest("choco"))
          expect(result).toBe("3.4.5")
        }),
    )

    testEffect(
      testLayer(
        () => jsonResponse({ versions: { stable: "2.0.0" } }),
        (cmd, args) => {
          // getBrewFormula: return core formula (no tap)
          if (cmd === "brew" && args.includes("--formula") && args.includes("anomalyco/tap/opencode")) return ""
          if (cmd === "brew" && args.includes("--formula") && args.includes("opencode")) return "opencode"
          return ""
        },
      ),
    ).effect("reads brew formulae API versions", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("brew"))
        expect(result).toBe("2.0.0")
      }),
    )

    const brewInfoJson = JSON.stringify({
      formulae: [{ versions: { stable: "2.1.0" } }],
    })
    testEffect(
      testLayer(
        () => jsonResponse({}), // HTTP not used for tap formula
        (cmd, args) => {
          if (cmd === "brew" && args.includes("anomalyco/tap/opencode") && args.includes("--formula")) return "opencode"
          if (cmd === "brew" && args.includes("--json=v2")) return brewInfoJson
          return ""
        },
      ),
    ).effect("reads brew tap info JSON via CLI", () =>
      Effect.gen(function* () {
        const result = yield* Installation.Service.use((svc) => svc.latest("brew"))
        expect(result).toBe("2.1.0")
      }),
    )
  })
})
