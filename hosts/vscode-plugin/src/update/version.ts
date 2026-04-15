export function normalizeVersion(input: string): string {
  const value = input.trim().replace(/^v/i, "")
  if (!/^\d+(\.\d+)*$/.test(value)) {
    throw new Error(`Invalid version: ${input}`)
  }
  return value
}

export function compareVersion(left: string, right: string): number {
  const a = normalizeVersion(left).split(".").map(Number)
  const b = normalizeVersion(right).split(".").map(Number)
  const size = Math.max(a.length, b.length)

  for (let index = 0; index < size; index++) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    if (av === bv) {
      continue
    }
    return av > bv ? 1 : -1
  }

  return 0
}
