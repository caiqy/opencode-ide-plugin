import { Effect, Schema } from "effect"
import { Config } from "../config"
import { Provider } from "../provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { InstanceState } from "@/effect/instance-state"
import * as Tool from "./tool"
import DESCRIPTION from "./generate-image.txt"
import { callOpenAICompatible } from "./generate-image/openai-compatible"
import { pickAdapter, resolveCredentials, resolveImageFieldStyle, resolveModelParts } from "./generate-image/config"
import { decodeImageInput, validateMask, validatePrompt } from "./generate-image/input"
import { persistImages } from "./generate-image/persist"

const Prompt = Schema.String.check(Schema.isPattern(/^[\s\S]{1,4000}$/)).annotate({
  minLength: 1,
  maxLength: 4000,
})

export const Parameters = Schema.Struct({
  action: Schema.Literals(["generate", "edit"])
    .annotate({ description: "Whether to generate a new image or edit existing images" })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("generate" as const))),
  prompt: Prompt.annotate({ description: "Text prompt for a single image (use n for count)" }),
  provider: Schema.optional(Schema.String).annotate({ description: "Optional provider override" }),
  model: Schema.optional(Schema.String).annotate({
    description: "Optional model override; omit to use configured image_model.",
  }),
  images: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Project-relative image paths or data URLs for edit inputs",
  }),
  mask: Schema.optional(Schema.String).annotate({ description: "Optional mask path or data URL for image edits" }),
  filename: Schema.optional(Schema.String).annotate({ description: "Optional filename prefix for persisted outputs" }),
  size: Schema.String.annotate({
    description:
      "Requested output size. Use auto or WIDTHxHEIGHT. For gpt-image-* models, 1024x1024 is the recommended minimum starting size. Smaller sizes may still work if they satisfy the model constraints: width and height must be multiples of 16, the longest edge must be <= 3840, aspect ratio must be <= 3:1, and total pixels must be between 655360 and 8294400.",
  }).pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("auto"))),
  quality: Schema.Literals(["auto", "low", "medium", "high"])
    .annotate({ description: "Requested image quality" })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("high" as const))),
  format: Schema.Literals(["png", "jpeg", "webp"])
    .annotate({ description: "Requested output image format" })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("png" as const))),
  n: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
    .check(Schema.isLessThanOrEqualTo(10))
    .annotate({ description: "Number of images to generate (1-10)" })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(1))),
})

export const GenerateImageTool = Tool.define(
  "generate_image",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const providerSvc = yield* Provider.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          validatePrompt(params.prompt)

          const action = params.action ?? "generate"
          const providerOverride = optionalTrimmed(params.provider)
          const modelOverride = optionalTrimmed(params.model)
          const filename = optionalTrimmed(params.filename)
          const mask = optionalTrimmed(params.mask)
          const size = params.size ?? "auto"
          const quality = params.quality ?? "high"
          const format = params.format ?? "png"
          const n = params.n ?? 1
          const generateImages = normalizeGenerateImages(params.images)
          const editImages = action === "edit" ? params.images : undefined

          if (action === "generate") {
            if (generateImages) {
              throw new Error("images can only be used with edit action")
            }

            if (mask !== undefined) {
              throw new Error("mask can only be used with edit action")
            }
          }

          if (action === "edit" && (!editImages || editImages.length === 0)) {
            throw new Error("images are required for edit action")
          }

          if (action === "edit" && editImages && editImages.length > 10) {
            throw new Error("edit action supports at most 10 images")
          }

          const cfg = yield* config.get()
          const modelParts = resolveModelParts({
            imageModel: cfg.image_model,
            provider: providerOverride,
            model: modelOverride,
          })
          const providerID = ProviderV2.ID.make(modelParts.providerID)
          const modelID = ModelV2.ID.make(modelParts.modelID)
          const provider = yield* providerSvc.getProvider(providerID)
          const model = yield* providerSvc.getModel(providerID, modelID)

          const adapter = pickAdapter({
            providerID: provider.id,
            providerOptions: provider.options,
            modelOptions: model.options,
            npm: model.api.npm,
          })
          const { apiKey, baseURL } = resolveCredentials({ provider, model })
          const imageFieldStyle = resolveImageFieldStyle({
            providerOptions: provider.options,
            modelOptions: model.options,
          })

          const metadata = {
            provider: modelParts.providerID,
            model: modelParts.modelID,
            action,
            n,
            size,
            quality,
            format,
            filename,
            images: {
              count: editImages?.length ?? 0,
              inputs: editImages ?? [],
            },
            mask,
          }

          // Ask for permission before decoding edit images so denied requests never read image bytes.
          yield* ctx.ask({
            permission: "generate_image",
            patterns: [`${modelParts.providerID}/${modelParts.modelID}`],
            always: ["*"],
            metadata,
          })

          const instance = yield* InstanceState.context
          const images = editImages
            ? yield* Effect.promise(() =>
                Promise.all(editImages.map((input) => decodeImageInput({ root: instance.worktree, input }))),
              )
            : undefined
          const decodedMask =
            mask !== undefined
              ? yield* Effect.promise(() => decodeImageInput({ root: instance.worktree, input: mask }))
              : undefined

          if (action === "edit" && images) {
            validateMask(images, decodedMask)
          }

          const generated =
            adapter === "openai-compatible"
              ? yield* callOpenAICompatible({
                  baseURL,
                  apiKey,
                  action,
                  model: model.id,
                  prompt: params.prompt,
                  size,
                  quality,
                  format,
                  n,
                  images,
                  mask: decodedMask,
                  imageFieldStyle,
                })
              : yield* Effect.die(`Unsupported image adapter: ${adapter}`)

          if (generated.length === 0) {
            throw new Error("No image data returned from image provider")
          }

          const attachments = yield* Effect.promise(() =>
            persistImages({
              root: instance.worktree,
              messageID: ctx.messageID,
              filename,
              images: generated,
            }),
          )

          return {
            title: "generate_image",
            output: `已生成 ${attachments.length} 张图片：`,
            metadata: {
              ...metadata,
              count: attachments.length,
            },
            attachments,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function optionalTrimmed(value: string | undefined) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeGenerateImages(images: readonly string[] | undefined) {
  if (!images) {
    return undefined
  }

  return images.some((value) => value.trim().length > 0) ? images : undefined
}
