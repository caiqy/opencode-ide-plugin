declare module "@iarna/toml" {
  export function parse(input: string): unknown
  export function stringify(obj: any): string

  const TOML: {
    parse: typeof parse
    stringify: typeof stringify
  }

  export default TOML
}
