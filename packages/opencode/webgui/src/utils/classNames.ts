/**
 * Conditionally join classNames together
 *
 * @example
 * cn('foo', 'bar') // => 'foo bar'
 * cn('foo', condition && 'bar') // => 'foo bar' or 'foo'
 * cn('foo', undefined, null, 'bar') // => 'foo bar'
 * cn({ foo: true, bar: false, baz: true }) // => 'foo baz'
 * cn(['foo', 'bar']) // => 'foo bar'
 */
export function cn(...args: ClassNameValue[]): string {
  const classes: string[] = []

  for (const arg of args) {
    // Filter out falsy values (including 0)
    if (!arg) continue

    if (typeof arg === "string") {
      const trimmed = arg.trim()
      if (trimmed) classes.push(trimmed)
    } else if (typeof arg === "number") {
      // Only add non-zero numbers
      if (arg !== 0) classes.push(String(arg))
    } else if (Array.isArray(arg)) {
      const inner = cn(...arg)
      if (inner) classes.push(inner)
    } else if (typeof arg === "object") {
      for (const key in arg) {
        if (arg[key]) classes.push(key)
      }
    }
  }

  // Deduplicate while preserving first occurrence order
  const seen = new Set<string>()
  const deduplicated: string[] = []
  for (const cls of classes) {
    if (!seen.has(cls)) {
      seen.add(cls)
      deduplicated.push(cls)
    }
  }

  return deduplicated.join(" ")
}

/**
 * Type for className values that can be passed to cn()
 */
export type ClassNameValue = string | number | boolean | null | undefined | ClassNameObject | ClassNameArray

interface ClassNameObject {
  [key: string]: boolean | null | undefined
}

interface ClassNameArray extends Array<ClassNameValue> {}
