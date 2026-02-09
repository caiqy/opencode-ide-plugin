import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { StatusIndicator } from "./StatusIndicator"

describe("CompactHeader/StatusIndicator", () => {
  it("连接中状态的 tooltip 为中文", () => {
    render(<StatusIndicator connectionState={"connecting" as any} />)
    expect(screen.getByTitle("连接中…")).toBeInTheDocument()
  })
})
