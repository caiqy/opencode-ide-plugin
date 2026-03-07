import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { useClickOutside } from "../../hooks/useClickOutside"
import { DEFAULT_STATUS_TAB, STATUS_TABS, buildLspView, buildMcpView, buildPluginView, buildServerView } from "./status"
import { useStatusPopoverData } from "./useStatusPopoverData"

type Tab = (typeof STATUS_TABS)[number]["id"]

interface StatusPopoverProps {
  open: boolean
  connectionState: ConnectionState
  onClose: () => void
  triggerRef?: RefObject<HTMLElement | null>
}

function stamp(value: number | null) {
  if (!value) return null
  return new Date(value).toLocaleString()
}

function nextTab(tab: Tab, dir: 1 | -1) {
  const list = STATUS_TABS.map((item) => item.id)
  const idx = list.indexOf(tab)
  return list[(idx + dir + list.length) % list.length] ?? DEFAULT_STATUS_TAB
}

export function StatusPopover({ open, connectionState, onClose, triggerRef }: StatusPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>(DEFAULT_STATUS_TAB)
  const data = useStatusPopoverData({ open, connectionState })
  const refs = triggerRef ? ([triggerRef] as unknown as RefObject<HTMLElement>[]) : []

  const close = useCallback(() => {
    onClose()
    queueMicrotask(() => triggerRef?.current?.focus())
  }, [onClose, triggerRef])

  useClickOutside(ref, close, {
    enabled: open,
    excludeRefs: refs,
  })

  useEffect(() => {
    if (!open) return
    setTab(DEFAULT_STATUS_TAB)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      close()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [close, open])

  const servers = useMemo(() => buildServerView(data.servers), [data.servers])
  const mcp = useMemo(() => buildMcpView(data.mcp), [data.mcp])
  const lsp = useMemo(() => buildLspView(data.lsp), [data.lsp])
  const plugins = useMemo(() => buildPluginView(data.plugins), [data.plugins])

  if (!open) return null

  return (
    <div
      ref={ref}
      id="status-popover"
      role="dialog"
      aria-label="状态面板"
      className="absolute right-0 top-full z-50 mt-2 w-[360px] rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-950"
    >
      <div className="border-b border-gray-200 px-2 py-2 dark:border-gray-800" role="tablist" aria-label="状态标签页">
        <div className="flex gap-1">
          {STATUS_TABS.map((item) => {
            const active = item.id === tab
            return (
              <button
                key={item.id}
                id={`status-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`status-panel-${item.id}`}
                tabIndex={active ? 0 : -1}
                className={`rounded px-2 py-1 text-xs ${active ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900" : "text-gray-600 dark:text-gray-300"}`}
                onClick={() => setTab(item.id)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
                  e.preventDefault()
                  const id = nextTab(item.id, e.key === "ArrowRight" ? 1 : -1)
                  setTab(id)
                  queueMicrotask(() => document.getElementById(`status-tab-${id}`)?.focus())
                }}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      <Panel tab={tab} id="servers">
        <div className="space-y-2 p-3 text-xs text-gray-700 dark:text-gray-200">
          <StateBox
            state={servers.state}
            error={servers.error}
            updatedAt={servers.updatedAt}
            onRetry={data.refreshAll}
          />
          <div>SSE 连接：{servers.summary.connection}</div>
          <div>IDE bridge：{servers.summary.bridge.ready ? "ready" : "not ready"}</div>
          <div>
            健康检查：{servers.summary.health === true ? "正常" : servers.summary.health === false ? "异常" : "未知"}
          </div>
          <div>项目：{servers.summary.project ?? "未知"}</div>
          <div>路径：{servers.summary.directory ?? servers.summary.worktree ?? "未知"}</div>
          <div className="text-gray-500 dark:text-gray-400">{servers.note}</div>
        </div>
      </Panel>

      <Panel tab={tab} id="mcp">
        <div className="space-y-2 p-3 text-xs text-gray-700 dark:text-gray-200">
          <div className="flex items-center justify-between">
            <span>MCP</span>
            <button type="button" className="text-blue-600 dark:text-blue-400" onClick={() => void data.refreshMcp()}>
              {mcp.refreshLabel}
            </button>
          </div>
          <StateBox state={mcp.state} error={mcp.error} updatedAt={mcp.updatedAt} />
          {mcp.items.map((item) => (
            <div key={item.name} className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span>{item.name}</span>
                {item.reason ? (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">{item.reason}</span>
                ) : null}
              </div>
              <label className="flex items-center gap-2">
                <span>{item.status}</span>
                <input
                  type="checkbox"
                  aria-label={`切换 ${item.name}`}
                  checked={item.enabled}
                  disabled={item.disabled}
                  onChange={() => void data.toggleMcp(item.name)}
                />
              </label>
            </div>
          ))}
        </div>
      </Panel>

      <Panel tab={tab} id="lsp">
        <div className="space-y-2 p-3 text-xs text-gray-700 dark:text-gray-200">
          <StateBox state={lsp.state} error={lsp.error} updatedAt={lsp.updatedAt} onRetry={data.refreshAll} />
          {lsp.items.map((item) => (
            <div key={item.id}>{item.name}</div>
          ))}
        </div>
      </Panel>

      <Panel tab={tab} id="plugins">
        <div className="space-y-2 p-3 text-xs text-gray-700 dark:text-gray-200">
          <StateBox
            state={plugins.state}
            error={plugins.error}
            updatedAt={plugins.updatedAt}
            empty={plugins.empty}
            onRetry={data.refreshAll}
          />
          {plugins.items.map((item) => (
            <div key={item}>{item}</div>
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Panel(props: { tab: Tab; id: Tab; children: ReactNode }) {
  const active = props.tab === props.id
  return (
    <div id={`status-panel-${props.id}`} role="tabpanel" aria-labelledby={`status-tab-${props.id}`} hidden={!active}>
      {props.children}
    </div>
  )
}

function StateBox(props: {
  state: string
  error: string | null
  updatedAt: number | null
  empty?: string
  onRetry?: () => void | Promise<void>
}) {
  if (props.state === "failed") {
    return (
      <div className="flex items-center justify-between gap-2">
        <span>数据失败：{props.error}</span>
        {props.onRetry ? (
          <button type="button" className="text-blue-600 dark:text-blue-400" onClick={() => void props.onRetry?.()}>
            重试
          </button>
        ) : null}
      </div>
    )
  }
  if (props.state === "stale") return <div>数据可能不是最新，上次更新于 {stamp(props.updatedAt)}</div>
  if (props.state === "empty") return <div>{props.empty ?? "暂无可展示数据"}</div>
  return null
}
