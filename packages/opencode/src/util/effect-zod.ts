import { Schema } from "effect"

export function zod<S extends Schema.Decoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownSync(schema)

  return {
    parse(input: unknown) {
      return decode(input)
    },
    safeParse(input: unknown) {
      try {
        return { success: true as const, data: decode(input) }
      } catch (error) {
        return { success: false as const, error }
      }
    },
  }
}
