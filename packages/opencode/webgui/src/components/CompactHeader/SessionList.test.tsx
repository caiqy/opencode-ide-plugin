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
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
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
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
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
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
      />,
    )

    expect(screen.getByText("新建会话")).toBeInTheDocument()
  })
})
