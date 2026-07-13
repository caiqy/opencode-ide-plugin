import { InstallationVersion } from "./version"

export function customizeUserAgent(userAgent: string, uiVersion = process.env.OPENCODE_UI_VERSION) {
  const [first] = userAgent.trimStart().split(/\s+/, 1)
  if (!first?.startsWith("opencode/")) return userAgent

  const comment = userAgent.indexOf("(")
  if (withoutComments(userAgent).split(/\s+/).some((token) => token.startsWith("opencode-ui/"))) return userAgent

  const version = uiVersion?.trim() || InstallationVersion
  if (comment === -1) return `${userAgent} opencode-ui/${version}`
  return `${userAgent.slice(0, comment).trimEnd()} opencode-ui/${version} ${userAgent.slice(comment)}`
}

function withoutComments(userAgent: string) {
  let depth = 0
  let escaped = false
  let result = ""
  for (const char of userAgent) {
    if (escaped) {
      escaped = false
      result += " "
      continue
    }
    if (depth > 0 && char === "\\") {
      escaped = true
      result += " "
      continue
    }
    if (char === "(") {
      depth += 1
      result += " "
      continue
    }
    if (depth > 0 && char === ")") {
      depth -= 1
      result += " "
      continue
    }
    result += depth === 0 ? char : " "
  }
  return result
}

export * as UserAgent from "./user-agent"
