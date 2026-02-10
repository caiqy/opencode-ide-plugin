import { ideBridge } from "../lib/ideBridge"

/**
 * Write text to clipboard with VSCode webview fallback.
 *
 * In a VSCode webview iframe `navigator.clipboard.writeText` is often
 * blocked by the browser security policy. When that happens we fall back
 * to the IDE bridge `clipboardWrite` request.
 */
export async function writeClipboard(value: string): Promise<boolean> {
  try {
    const promise = navigator.clipboard?.writeText(value)
    if (promise) {
      await promise
      return true
    }
  } catch {}

  if (!ideBridge.isInstalled()) return false

  try {
    const res = await Promise.race([
      ideBridge.request("clipboardWrite", { text: value }) as Promise<{ ok?: boolean }>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
    ])
    if (!res) return false
    return !!res.ok
  } catch {
    return false
  }
}
