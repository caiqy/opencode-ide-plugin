export function parseTaskResult(output: string) {
  const m = output.match(/<task_result(?:\s[^>]*)?>\n?([\s\S]*?)\n?<\/task_result>/i)
  if (!m) return { hasTag: false, hasContent: false, text: "" }
  const text = (m[1] ?? "").trim()
  return { hasTag: true, hasContent: text.length > 0, text }
}
