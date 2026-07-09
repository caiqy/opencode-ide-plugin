import { Provider } from "../../provider"

export type AdapterID = "openai-compatible"

export type ImageFieldStyle = "brackets" | "repeated"

const imageModelGuidance = 'configure { "image_model": "openai/gpt-image-2" } or pass provider and model'

export function resolveModelParts(input: { imageModel?: string; provider?: string; model?: string }) {
  const imageModel = optionalTrimmed(input.imageModel)
  const provider = optionalTrimmed(input.provider)
  const model = optionalTrimmed(input.model)

  if (input.imageModel !== undefined && !imageModel) {
    throw new Error(`image_model must include provider and model; ${imageModelGuidance}`)
  }

  if (input.provider !== undefined && !provider) {
    throw new Error(`provider is required when image_model is not configured; ${imageModelGuidance}`)
  }

  if (input.model !== undefined && !model) {
    throw new Error(`model is required when image_model is not configured; ${imageModelGuidance}`)
  }

  if (provider && model) {
    validateProviderID(provider)
    validateModelID(model)
    return Provider.parseModel(`${provider}/${model}`)
  }

  if (imageModel) {
    const parsed = parseConfiguredImageModel(imageModel)

    if (provider) {
      if (provider === parsed.providerID) {
        return parsed
      }

      throw new Error("model is required when provider overrides image_model provider")
    }

    if (model) {
      validateModelID(model)
      return Provider.parseModel(`${parsed.providerID}/${model}`)
    }

    return parsed
  }

  if (provider && !model) {
    throw new Error(`model is required when image_model is not configured; ${imageModelGuidance}`)
  }

  if (model) {
    throw new Error(`provider is required when image_model is not configured; ${imageModelGuidance}`)
  }

  throw new Error(`image_model is not configured; ${imageModelGuidance}`)
}

export function normalizeBaseURL(url: string) {
  const trimmed = url.replace(/\/+$/, "")
  if (trimmed.endsWith("/v1")) {
    return trimmed
  }
  return `${trimmed}/v1`
}

export function pickAdapter(input: {
  providerID: string
  providerOptions: Record<string, unknown>
  modelOptions: Record<string, unknown>
  npm: string
}): AdapterID {
  const configured = explicitAdapter(input.modelOptions) ?? explicitAdapter(input.providerOptions)
  if (configured !== undefined) {
    if (configured === "openai-compatible") {
      return configured
    }

    throw new Error(
      `Unsupported image adapter: ${configured}. Configure model.options.imageApi or provider.options.imageApi.`,
    )
  }

  if (input.npm === "@ai-sdk/openai-compatible" || input.npm === "@ai-sdk/openai") {
    return "openai-compatible"
  }

  if (input.providerID === "openai") {
    return "openai-compatible"
  }

  throw new Error(
    `No image adapter configured for provider ${input.providerID}. Configure model.options.imageApi or provider.options.imageApi.`,
  )
}

export function resolveImageFieldStyle(input: {
  providerOptions: Record<string, unknown>
  modelOptions: Record<string, unknown>
}): ImageFieldStyle {
  const value = input.modelOptions.imageFieldStyle ?? input.providerOptions.imageFieldStyle ?? "brackets"
  if (value === "brackets" || value === "repeated") {
    return value
  }

  throw new Error(`Unsupported imageFieldStyle: ${String(value)}`)
}

export function resolveCredentials(input: { provider: Provider.Info; model: Provider.Model }) {
  const apiKey = stringOption(input.provider.key) ?? stringOption(input.provider.options.apiKey)
  if (!apiKey) {
    throw new Error(
      `Unable to authenticate the provider or configure an apiKey for provider ${input.provider.id}. Please authenticate the provider or configure provider options.apiKey.`,
    )
  }

  const rawBaseURL = stringOption(input.provider.options.baseURL) ?? stringOption(input.model.api.url)
  if (!rawBaseURL) {
    throw new Error(
      `Unable to configure provider ${input.provider.id} for image generation. Please configure provider options.baseURL or model.api.url.`,
    )
  }

  return {
    apiKey,
    baseURL: normalizeBaseURL(rawBaseURL),
  }
}

function stringOption(value: unknown) {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function explicitAdapter(options: Record<string, unknown>) {
  return stringOption(options.imageApi) ?? stringOption(options.imageAdapter)
}

function optionalTrimmed(value: string | undefined) {
  if (value === undefined) {
    return undefined
  }

  return stringOption(value)
}

function parseConfiguredImageModel(value: string) {
  validateImageModel(value)
  const parsed = Provider.parseModel(value)
  const providerID = stringOption(parsed.providerID)
  const modelID = stringOption(parsed.modelID)
  if (!value.includes("/") || !providerID || !modelID) {
    throw new Error(`image_model must include provider and model; ${imageModelGuidance}`)
  }

  return {
    providerID,
    modelID,
  }
}

function validateImageModel(value: string) {
  const parts = value.split("/")
  if (parts.length < 2 || parts.some((part) => part.length === 0)) {
    throw new Error(`image_model must include provider and model; ${imageModelGuidance}`)
  }
}

function validateProviderID(value: string) {
  if (value.includes("/")) {
    throw new Error("provider must be a provider id")
  }
}

function validateModelID(value: string) {
  const parts = value.split("/")
  if (parts.some((part) => part.length === 0)) {
    throw new Error("model must be a model id")
  }
}
