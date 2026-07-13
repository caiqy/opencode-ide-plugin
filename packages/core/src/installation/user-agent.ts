import { InstallationVersion } from "./version"

export function customizeUserAgent(userAgent: string, uiVersion = process.env.OPENCODE_UI_VERSION) {
  const [first] = userAgent.trimStart().split(/\s+/, 1)
  if (!first?.startsWith("opencode/")) return userAgent

  const comment = userAgent.indexOf("(")
  const products = comment === -1 ? userAgent : userAgent.slice(0, comment)
  if (products.split(/\s+/).some((token) => token.startsWith("opencode-ui/"))) return userAgent

  const version = uiVersion?.trim() || InstallationVersion
  if (comment === -1) return `${userAgent} opencode-ui/${version}`
  return `${userAgent.slice(0, comment).trimEnd()} opencode-ui/${version} ${userAgent.slice(comment)}`
}

export * as UserAgent from "./user-agent"
