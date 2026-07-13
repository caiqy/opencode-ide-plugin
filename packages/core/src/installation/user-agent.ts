import { InstallationVersion } from "./version"

export function customizeUserAgent(userAgent: string, uiVersion = process.env.OPENCODE_UI_VERSION) {
  const [first] = userAgent.trimStart().split(/\s+/, 1)
  if (!first?.startsWith("opencode/")) return userAgent
  if (userAgent.split(/\s+/).some((token) => token.startsWith("opencode-ui/"))) return userAgent

  const version = uiVersion?.trim() || InstallationVersion
  const comment = userAgent.indexOf("(")
  if (comment === -1) return `${userAgent} opencode-ui/${version}`
  return `${userAgent.slice(0, comment).trimEnd()} opencode-ui/${version} ${userAgent.slice(comment)}`
}
