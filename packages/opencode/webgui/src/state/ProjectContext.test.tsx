import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProjectProvider, useProject } from "./ProjectContext"
import { sdk } from "../lib/api/sdkClient"

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    project: {
      current: vi.fn(),
    },
    path: {
      get: vi.fn(),
    },
  },
}))

function Probe() {
  const project = useProject()
  return (
    <div>
      <div data-testid="worktree">{project.worktree}</div>
      <div data-testid="directory">{project.directory}</div>
    </div>
  )
}

describe("ProjectContext", () => {
  beforeEach(() => {
    vi.mocked(sdk.project.current).mockReset()
    vi.mocked(sdk.path.get).mockReset()
  })

  it("保持 worktree 与 directory 的语义分离", async () => {
    vi.mocked(sdk.project.current).mockResolvedValue({
      data: { id: "p1", worktree: "D:/repo", time: { created: 1 } },
      error: null,
    } as never)
    vi.mocked(sdk.path.get).mockResolvedValue({
      data: {
        state: "ready",
        config: "cfg",
        configFile: "cfg/opencode.json",
        worktree: "D:/repo",
        directory: "D:/repo/sub",
      },
      error: null,
    } as never)

    render(
      <ProjectProvider>
        <Probe />
      </ProjectProvider>,
    )

    await waitFor(() => expect(screen.getByTestId("directory")).toHaveTextContent("D:/repo/sub"))

    expect(screen.getByTestId("worktree").textContent).toBe("D:/repo")
  })
})
