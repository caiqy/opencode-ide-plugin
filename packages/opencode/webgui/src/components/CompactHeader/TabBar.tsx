import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ideBridge } from "../../lib/ideBridge"
import { useSession } from "../../state/SessionContext"
import { Tab } from "./Tab"
import { TabContextMenu } from "./TabContextMenu"

interface TabBarProps {
  openTabs: string[]
  activeTab: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReorder: (from: number, to: number) => void
  onCloseOtherTabs: (id: string) => void
  onCloseTabsToRight: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onToggleShare: (id: string) => void
}

type Menu = {
  x: number
  y: number
  sessionId: string
}

export function TabBar({
  openTabs,
  activeTab,
  onActivate,
  onClose,
  onReorder,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onRename,
  onDelete,
  onToggleShare,
}: TabBarProps) {
  const { sessions, isSessionIdle, isSessionReasoning } = useSession()
  const ref = useRef<HTMLDivElement>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [left, setLeft] = useState(false)
  const [right, setRight] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<Menu | null>(null)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const tabs = useRef(new Map<string, HTMLDivElement>())

  const map = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])

  const checkScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    setLeft(el.scrollLeft > 0)
    setRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = ref.current
    if (!el) return
    el.addEventListener("scroll", checkScroll)

    if (typeof ResizeObserver === "undefined") {
      return () => {
        el.removeEventListener("scroll", checkScroll)
      }
    }

    const observer = new ResizeObserver(checkScroll)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", checkScroll)
      observer.disconnect()
    }
  }, [checkScroll, openTabs])

  const setTab = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      tabs.current.set(id, node)
      return
    }
    tabs.current.delete(id)
  }, [])

  useEffect(() => {
    if (!activeTab) return
    const node = tabs.current.get(activeTab)
    if (!node || typeof node.scrollIntoView !== "function") return
    node.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    })
  }, [activeTab])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    e.preventDefault()
    el.scrollLeft += e.deltaY
  }, [])

  const onDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverIdx(idx)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent, to: number) => {
      e.preventDefault()
      if (dragIdx !== null && dragIdx !== to) {
        onReorder(dragIdx, to)
      }
      setDragIdx(null)
      setDragOverIdx(null)
    },
    [dragIdx, onReorder],
  )

  const onDragEnd = useCallback(() => {
    setDragIdx(null)
    setDragOverIdx(null)
  }, [])

  const onOpenShareLink = useCallback(() => {
    if (!ctxMenu) return
    const url = map.get(ctxMenu.sessionId)?.share?.url
    if (!url) return
    if (ideBridge.isInstalled()) {
      ideBridge.send({ type: "openUrl", payload: { url } })
      return
    }
    window.open(url, "_blank", "noopener,noreferrer")
  }, [ctxMenu, map])

  return (
    <div className="relative flex-1 h-full min-w-0">
      {left && (
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white dark:from-gray-950 to-transparent z-10 pointer-events-none" />
      )}

      <div
        ref={ref}
        className="scrollbar-hide flex h-full items-stretch overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        onWheel={onWheel}
      >
        {openTabs.map((id, idx) => {
          const session = map.get(id)
          const isDragOver =
            dragOverIdx === idx && dragIdx !== null && dragIdx !== idx ? (dragIdx > idx ? "left" : "right") : null

          return (
            <div
              key={id}
              ref={(node) => setTab(id, node)}
              className="h-full min-w-[100px] max-w-[180px] flex-[1_1_150px]"
            >
              <Tab
                sessionId={id}
                title={session?.title || ""}
                isActive={id === activeTab}
                isBusy={!isSessionIdle(id)}
                isReasoning={isSessionReasoning(id)}
                onActivate={() => onActivate(id)}
                onClose={() => onClose(id)}
                onRename={(title) => onRename(id, title)}
                onContextMenu={(x, y) => setCtxMenu({ x, y, sessionId: id })}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDrop={(e) => onDrop(e, idx)}
                onDragEnd={onDragEnd}
                isDragOver={isDragOver}
                isRenaming={renamingTabId === id}
                onRenameComplete={() => setRenamingTabId(null)}
              />
            </div>
          )
        })}
      </div>

      {right && (
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white dark:from-gray-950 to-transparent z-10 pointer-events-none" />
      )}

      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          sessionId={ctxMenu.sessionId}
          isShared={!!map.get(ctxMenu.sessionId)?.share?.url}
          onClose={() => setCtxMenu(null)}
          onCloseTab={() => onClose(ctxMenu.sessionId)}
          onCloseOtherTabs={() => onCloseOtherTabs(ctxMenu.sessionId)}
          onCloseTabsToRight={() => onCloseTabsToRight(ctxMenu.sessionId)}
          onRename={() => {
            setRenamingTabId(ctxMenu.sessionId)
            setCtxMenu(null)
          }}
          onDelete={() => onDelete(ctxMenu.sessionId)}
          onToggleShare={() => onToggleShare(ctxMenu.sessionId)}
          onOpenShareLink={onOpenShareLink}
        />
      )}
    </div>
  )
}
