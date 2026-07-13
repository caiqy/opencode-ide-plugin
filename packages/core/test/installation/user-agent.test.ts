import { describe, expect, test } from "bun:test"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { customizeUserAgent } from "@opencode-ai/core/installation/user-agent"

describe("customizeUserAgent", () => {
  test.each([
    ["", "9", ""],
    ["opencode", "9", "opencode"],
    ["third-party/1 opencode/2", "9", "third-party/1 opencode/2"],
    ["opencode/2", "9", "opencode/2 opencode-ui/9"],
    ["opencode/2 opencode-ui/old", "9", "opencode/2 opencode-ui/old"],
    [
      "opencode/2 (compatible; opencode-ui/old)",
      "9",
      "opencode/2 opencode-ui/9 (compatible; opencode-ui/old)",
    ],
    ["opencode/2 provider/1 (linux x64)", " 9 ", "opencode/2 provider/1 opencode-ui/9 (linux x64)"],
    ["opencode/2", "   ", `opencode/2 opencode-ui/${InstallationVersion}`],
  ])("customizes %p", (input, version, expected) => {
    expect(customizeUserAgent(input, version)).toBe(expected)
  })
})
