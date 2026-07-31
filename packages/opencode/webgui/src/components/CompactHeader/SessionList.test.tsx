import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { SessionList } from "./SessionList"

describe("CompactHeader/SessionList", () => {
  it("空列表时提示文案为中文", () => {
    render(
      <SessionList
        sessions={[]}
        currentSessionId={undefined}
        filteredSessions={[]}
        isSelectMode={false}
        selectedSessions={new Set()}
        selectedSessionIndex={0}
        editingSessionId={null}
        editingTitle={""}
        editInputRef={{ current: null }}
        selectedSessionRef={{ current: null }}
        sessionListRef={{ current: null }}
        sharingSessionId={null}
        pinningSessionId={null}
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByText("暂无会话")).toBeInTheDocument()
  })

  it("无匹配结果时提示文案为中文", () => {
    render(
      <SessionList
        sessions={[{ id: "s1", title: "A", time: { created: Date.now() } } as any]}
        currentSessionId={undefined}
        filteredSessions={[]}
        isSelectMode={false}
        selectedSessions={new Set()}
        selectedSessionIndex={0}
        editingSessionId={null}
        editingTitle={""}
        editInputRef={{ current: null }}
        selectedSessionRef={{ current: null }}
        sessionListRef={{ current: null }}
        sharingSessionId={null}
        pinningSessionId={null}
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByText("没有匹配的会话")).toBeInTheDocument()
  })

  it("会话标题为空时回退到中文默认标题", () => {
    render(
      <SessionList
        sessions={[{ id: "s1", title: null, time: { created: Date.now() } } as any]}
        currentSessionId={undefined}
        filteredSessions={[{ id: "s1", title: null, time: { created: Date.now() } } as any]}
        isSelectMode={false}
        selectedSessions={new Set()}
        selectedSessionIndex={0}
        editingSessionId={null}
        editingTitle={""}
        editInputRef={{ current: null }}
        selectedSessionRef={{ current: null }}
        sessionListRef={{ current: null }}
        sharingSessionId={null}
        pinningSessionId={null}
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByText("新建会话")).toBeInTheDocument()
  })

  it("钉住请求进行时禁用所有钉住按钮", () => {
    const sessions = [
      { id: "s1", title: "A", time: { created: 2, updated: 2 } },
      { id: "s2", title: "B", time: { created: 1, updated: 1 } },
    ] as any
    render(
      <SessionList
        sessions={sessions}
        currentSessionId="s1"
        filteredSessions={sessions}
        isSelectMode={false}
        selectedSessions={new Set()}
        selectedSessionIndex={0}
        editingSessionId={null}
        editingTitle={""}
        editInputRef={{ current: null }}
        selectedSessionRef={{ current: null }}
        sessionListRef={{ current: null }}
        sharingSessionId={null}
        pinningSessionId="s1"
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getAllByRole("button", { name: "钉住会话" })).toHaveLength(2)
    screen.getAllByRole("button", { name: "钉住会话" }).forEach((button) => expect(button).toBeDisabled())
  })
})
