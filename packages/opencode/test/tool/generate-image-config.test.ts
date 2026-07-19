import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { Config } from "../../src/config"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Effect } from "effect"
import {
  normalizeBaseURL,
  pickAdapter,
  resolveCredentials,
  resolveConfiguredImageModel,
  resolveImageFieldStyle,
  resolveModelParts,
} from "../../src/tool/generate-image/config"
import { ProviderTest } from "../fake/provider"

async function getConfig() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.get()
    }),
  )
}

describe("generate_image config", () => {
  test("loads image_model from opencode config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            image_model: "openai/gpt-image-2",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await getConfig()
        expect(config.image_model).toBe("openai/gpt-image-2")
      },
    })
  })

  test("loads defaultForImageGeneration from open model options", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            provider: {
              openai: {
                models: {
                  "gpt-image-2": { options: { defaultForImageGeneration: true } },
                },
              },
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await getConfig()
        expect(config.provider?.openai?.models?.["gpt-image-2"]?.options?.defaultForImageGeneration).toBe(true)
      },
    })
  })

  test("loads generate_image permission config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            permission: { generate_image: "allow" },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await getConfig()
        expect(config.permission?.generate_image).toBe("allow")
      },
    })
  })

  test("loads generate_image pattern permission config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          `${dir}/opencode.json`,
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            permission: { generate_image: { "openai/*": "allow" } },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await getConfig()
        expect(config.permission?.generate_image).toEqual({ "openai/*": "allow" })
      },
    })
  })

  test("maps generate_image allow config into permission rules", () => {
    const rules = Permission.fromConfig({ generate_image: "allow" })
    expect(rules).toEqual([{ permission: "generate_image", pattern: "*", action: "allow" }])
    expect(Permission.evaluate("generate_image", "openai/gpt-image-2", rules).action).toBe("allow")
  })

  test("maps generate_image pattern config into permission rules", () => {
    const rules = Permission.fromConfig({ generate_image: { "openai/*": "allow" } })
    expect(rules).toEqual([{ permission: "generate_image", pattern: "openai/*", action: "allow" }])
    expect(Permission.evaluate("generate_image", "openai/gpt-image-2", rules).action).toBe("allow")
  })

  test("resolveConfiguredImageModel prefers a unique configured marker over image_model", () => {
    expect(
      resolveConfiguredImageModel(
        {
          openai: {
            models: {
              "gpt-image-2": { id: "api-image-id", options: { defaultForImageGeneration: true } },
            },
          },
        },
        "legacy/image",
      ),
    ).toBe("openai/gpt-image-2")

    expect(resolveConfiguredImageModel({ openai: { models: { "gpt-image-2": { options: {} } } } }, "legacy/image")).toBe(
      "legacy/image",
    )
    expect(
      resolveConfiguredImageModel(
        { openai: { models: { "gpt-image-2": { options: { defaultForImageGeneration: false } } } } },
        undefined,
      ),
    ).toBeUndefined()
    expect(resolveConfiguredImageModel(undefined, undefined)).toBeUndefined()
  })

  test("resolveConfiguredImageModel rejects invalid and ambiguous markers", () => {
    expect(() =>
      resolveConfiguredImageModel({ openai: { models: { "gpt-image-2": { options: { defaultForImageGeneration: "yes" } } } } }),
    ).toThrow("provider.openai.models.gpt-image-2.options.defaultForImageGeneration must be a boolean")

    expect(() =>
      resolveConfiguredImageModel({
        zeta: { models: { "image-z": { options: { defaultForImageGeneration: true } } } },
        alpha: { models: { "image-a": { options: { defaultForImageGeneration: true } } } },
      }),
    ).toThrow("alpha/image-a, zeta/image-z")
  })

  test("resolveConfiguredImageModel uses the project marker that explicitly disables the global default", async () => {
    await using global = await tmpdir({
      config: {
        provider: {
          openai: { models: { "gpt-image-2": { options: { defaultForImageGeneration: true } } } },
        },
      },
    })
    await using project = await tmpdir({
      config: {
        provider: {
          openai: {
            models: {
              "gpt-image-2": { options: { defaultForImageGeneration: false } },
              "gpt-image-3": { options: { defaultForImageGeneration: true } },
            },
          },
        },
      },
    })
    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = global.path
    await AppRuntime.runPromise(Config.use.invalidate())

    try {
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const config = await getConfig()
          expect(resolveConfiguredImageModel(config.provider)).toBe("openai/gpt-image-3")
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = previous
      await AppRuntime.runPromise(Config.use.invalidate())
    }
  })

  test("resolveConfiguredImageModel reports merged defaults when project config omits false", async () => {
    await using global = await tmpdir({
      config: {
        provider: {
          openai: { models: { "gpt-image-2": { options: { defaultForImageGeneration: true } } } },
        },
      },
    })
    await using project = await tmpdir({
      config: {
        provider: {
          openai: { models: { "gpt-image-3": { options: { defaultForImageGeneration: true } } } },
        },
      },
    })
    const previous = Global.Path.config
    ;(Global.Path as { config: string }).config = global.path
    await AppRuntime.runPromise(Config.use.invalidate())

    try {
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const config = await getConfig()
          expect(() => resolveConfiguredImageModel(config.provider)).toThrow("openai/gpt-image-2, openai/gpt-image-3")
        },
      })
    } finally {
      ;(Global.Path as { config: string }).config = previous
      await AppRuntime.runPromise(Config.use.invalidate())
    }
  })

  test("resolveModelParts uses Provider.parseModel semantics for nested model ids", () => {
    expect(resolveModelParts({ imageModel: "openrouter/openai/gpt-image-2" })).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-image-2",
    })

    expect(resolveModelParts({ imageModel: " openrouter/openai/gpt-image-2 " })).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-image-2",
    })
  })

  test("resolveModelParts applies override matrix correctly", () => {
    expect(resolveModelParts({ imageModel: "openai/gpt-image-2" })).toEqual({
      providerID: "openai",
      modelID: "gpt-image-2",
    })

    expect(resolveModelParts({ imageModel: "openai/gpt-image-2", model: "image-x" })).toEqual({
      providerID: "openai",
      modelID: "image-x",
    })

    expect(resolveModelParts({ imageModel: " openai/gpt-image-2 ", provider: " openai " })).toEqual({
      providerID: "openai",
      modelID: "gpt-image-2",
    })

    expect(resolveModelParts({ imageModel: "openai/", provider: "custom", model: "image-x" })).toEqual({
      providerID: "custom",
      modelID: "image-x",
    })

    expect(resolveModelParts({ imageModel: "openai/gpt-image-2", model: " openai/image-x " })).toEqual({
      providerID: "openai",
      modelID: "openai/image-x",
    })

    expect(
      resolveModelParts({
        imageModel: "openai/gpt-image-2",
        provider: "openrouter",
        model: "openai/gpt-image-1",
      }),
    ).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-image-1",
    })

    expect(resolveModelParts({ imageModel: "openai/gpt-image-2", provider: "openai" })).toEqual({
      providerID: "openai",
      modelID: "gpt-image-2",
    })

    expect(() => resolveModelParts({ imageModel: "openai/gpt-image-2", provider: "openrouter" })).toThrow(
      "model is required when provider overrides image_model provider",
    )

    expect(() => resolveModelParts({ provider: "openai" })).toThrow(
      /configure \{ "image_model": "openai\/gpt-image-2" \} or pass provider and model/,
    )

    expect(() => resolveModelParts({ model: "gpt-image-2" })).toThrow(
      /configure \{ "image_model": "openai\/gpt-image-2" \} or pass provider and model/,
    )
  })

  test("resolveModelParts missing configuration errors include setup guidance", () => {
    expect(() => resolveModelParts({})).toThrow(
      /configure \{ "image_model": "openai\/gpt-image-2" \} or pass provider and model/,
    )

    expect(() => resolveModelParts({ provider: "openai" })).toThrow(
      /configure \{ "image_model": "openai\/gpt-image-2" \} or pass provider and model/,
    )

    expect(() => resolveModelParts({ model: "gpt-image-2" })).toThrow(
      /configure \{ "image_model": "openai\/gpt-image-2" \} or pass provider and model/,
    )
  })

  test("resolveModelParts rejects blank and malformed inputs early", () => {
    expect(() => resolveModelParts({ imageModel: "gpt-image-2" })).toThrow(
      /image_model must include provider and model/,
    )
    expect(() => resolveModelParts({ imageModel: "openai/" })).toThrow(/image_model must include provider and model/)
    expect(() => resolveModelParts({ imageModel: "/gpt-image-2" })).toThrow(
      /image_model must include provider and model/,
    )
    expect(() => resolveModelParts({ imageModel: "openai//gpt-image-2" })).toThrow(
      /image_model must include provider and model/,
    )
    expect(() => resolveModelParts({ provider: "   " })).toThrow(/provider is required/)
    expect(() => resolveModelParts({ model: "   " })).toThrow(/model is required/)
    expect(() => resolveModelParts({ provider: "openai", model: "   " })).toThrow(/model is required/)
    expect(() => resolveModelParts({ provider: "openai/extra", model: "gpt-image-2" })).toThrow(
      /provider must be a provider id/,
    )
    expect(() => resolveModelParts({ provider: "openai", model: "/gpt-image-2" })).toThrow(/model must be a model id/)
    expect(() => resolveModelParts({ provider: "openai", model: "gpt-image-2/" })).toThrow(/model must be a model id/)
    expect(() => resolveModelParts({ provider: "openai", model: "gpt//image-2" })).toThrow(/model must be a model id/)
    expect(() => resolveModelParts({ imageModel: "openai/gpt-image-2", model: "/gpt-image-2" })).toThrow(
      /model must be a model id/,
    )
    expect(() => resolveModelParts({ imageModel: "openai/gpt-image-2", model: "gpt-image-2/" })).toThrow(
      /model must be a model id/,
    )
    expect(() => resolveModelParts({ imageModel: "openai/gpt-image-2", model: "gpt//image-2" })).toThrow(
      /model must be a model id/,
    )
  })

  test("normalizeBaseURL appends v1 once and trims trailing slashes", () => {
    expect(normalizeBaseURL("https://api.openai.com")).toBe("https://api.openai.com/v1")
    expect(normalizeBaseURL("https://api.openai.com/")).toBe("https://api.openai.com/v1")
    expect(normalizeBaseURL("https://api.openai.com/v1")).toBe("https://api.openai.com/v1")
    expect(normalizeBaseURL("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1")
  })

  test("resolveCredentials prefers provider key and options before model fallback", () => {
    const model = ProviderTest.model({
      api: { id: "gpt-image-2", url: "https://model.example.com", npm: "@ai-sdk/openai-compatible" },
    })
    const provider = ProviderTest.info(
      {
        key: "provider-key",
        options: {
          apiKey: "provider-options-key",
          baseURL: "https://provider.example.com/",
        },
      },
      model,
    )

    expect(resolveCredentials({ provider, model })).toEqual({
      apiKey: "provider-key",
      baseURL: "https://provider.example.com/v1",
    })

    expect(
      resolveCredentials({
        provider: ProviderTest.info({ options: { apiKey: "provider-options-key" } }, model),
        model,
      }),
    ).toEqual({
      apiKey: "provider-options-key",
      baseURL: "https://model.example.com/v1",
    })
  })

  test("resolveCredentials reports missing configuration without leaking secrets", () => {
    const missingKeyModel = ProviderTest.model({
      api: { id: "gpt-image-2", url: "https://model.example.com", npm: "@ai-sdk/openai-compatible" },
    })
    const missingBaseURLModel = ProviderTest.model({
      api: { id: "gpt-image-2", url: "", npm: "@ai-sdk/openai-compatible" },
    })

    expect(() =>
      resolveCredentials({
        provider: ProviderTest.info({ options: { baseURL: "https://provider.example.com" } }, missingKeyModel),
        model: missingKeyModel,
      }),
    ).toThrow(/authenticate the provider or configure|configure provider/)

    expect(() =>
      resolveCredentials({
        provider: ProviderTest.info({ key: "secret-token" }, missingBaseURLModel),
        model: missingBaseURLModel,
      }),
    ).toThrow(/configure provider/)

    expect(() =>
      resolveCredentials({
        provider: ProviderTest.info({ key: "secret-token" }, missingBaseURLModel),
        model: missingBaseURLModel,
      }),
    ).not.toThrow(/secret-token/)
  })

  test("pickAdapter resolves explicit options, npm, and openai provider fallback", () => {
    expect(
      pickAdapter({
        providerID: "custom",
        providerOptions: {},
        modelOptions: { imageApi: "openai-compatible" },
        npm: "custom-npm",
      }),
    ).toBe("openai-compatible")

    expect(
      pickAdapter({
        providerID: "custom",
        providerOptions: { imageApi: "openai-compatible" },
        modelOptions: {},
        npm: "custom-npm",
      }),
    ).toBe("openai-compatible")

    expect(
      pickAdapter({
        providerID: "custom",
        providerOptions: { imageAdapter: "openai-compatible" },
        modelOptions: {},
        npm: "custom-npm",
      }),
    ).toBe("openai-compatible")

    expect(
      pickAdapter({
        providerID: "custom",
        providerOptions: {},
        modelOptions: { imageAdapter: "openai-compatible" },
        npm: "custom-npm",
      }),
    ).toBe("openai-compatible")

    expect(
      pickAdapter({
        providerID: "custom",
        providerOptions: {},
        modelOptions: {},
        npm: "@ai-sdk/openai",
      }),
    ).toBe("openai-compatible")

    expect(
      pickAdapter({
        providerID: "custom",
        providerOptions: {},
        modelOptions: {},
        npm: "@ai-sdk/openai-compatible",
      }),
    ).toBe("openai-compatible")

    expect(
      pickAdapter({
        providerID: "openai",
        providerOptions: {},
        modelOptions: {},
        npm: "x",
      }),
    ).toBe("openai-compatible")

    expect(() =>
      pickAdapter({
        providerID: "unknown",
        providerOptions: {},
        modelOptions: {},
        npm: "unknown-package",
      }),
    ).toThrow(/model\.options\.imageApi.*provider\.options\.imageApi/)
  })

  test("pickAdapter rejects explicit unsupported imageApi before fallback", () => {
    expect(() =>
      pickAdapter({
        providerID: "openai",
        providerOptions: { imageApi: "unknown" },
        modelOptions: {},
        npm: "@ai-sdk/openai",
      }),
    ).toThrow(/model\.options\.imageApi.*provider\.options\.imageApi/)

    expect(() =>
      pickAdapter({
        providerID: "x",
        providerOptions: { imageApi: "openai-compatible" },
        modelOptions: { imageApi: "unknown" },
        npm: "@ai-sdk/openai-compatible",
      }),
    ).toThrow(/model\.options\.imageApi.*provider\.options\.imageApi/)
  })

  test("resolveImageFieldStyle defaults to brackets with model override priority", () => {
    expect(resolveImageFieldStyle({ providerOptions: {}, modelOptions: {} })).toBe("brackets")

    expect(resolveImageFieldStyle({ providerOptions: { imageFieldStyle: "repeated" }, modelOptions: {} })).toBe(
      "repeated",
    )

    expect(
      resolveImageFieldStyle({
        providerOptions: { imageFieldStyle: "repeated" },
        modelOptions: { imageFieldStyle: "brackets" },
      }),
    ).toBe("brackets")

    expect(
      resolveImageFieldStyle({
        providerOptions: { imageFieldStyle: "brackets" },
        modelOptions: { imageFieldStyle: "repeated" },
      }),
    ).toBe("repeated")

    expect(() =>
      resolveImageFieldStyle({
        providerOptions: {},
        modelOptions: { imageFieldStyle: "invalid" },
      }),
    ).toThrow("Unsupported imageFieldStyle")
  })
})
