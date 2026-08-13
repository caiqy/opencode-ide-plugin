import { expect, test } from "bun:test"

test("counts inclusive output without adding reasoning twice", async () => {
  const trialLimiter = await import("../src/routes/zen/util/trialLimiter")

  expect(
    trialLimiter.calculateTrialUsage({
      inputTokens: 1,
      outputTokens: 5,
      reasoningTokens: 2,
      cacheReadTokens: 3,
      cacheWrite5mTokens: 1,
      cacheWrite1hTokens: 2,
    }),
  ).toBe(12)
})
