// @vitest-environment node

import { describe, expect, it } from "vitest"
import config from "./vitest.config"

describe("vitest config", () => {
  it("uses threads pool so full suite does not depend on external node executable", () => {
    expect(config.test?.pool).toBe("threads")
  })
})
