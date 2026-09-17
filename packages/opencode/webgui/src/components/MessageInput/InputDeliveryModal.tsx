import { useEffect, useId, useRef } from "react"
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../common/Modal"
import type { InputDelivery } from "../../lib/api/inputQueue"

export function InputDeliveryModal(props: {
  pending: boolean
  error: string | null
  onSelect: (delivery: InputDelivery) => void
  onClose: () => void
}) {
  const headingID = useId()
  const body = useRef<HTMLDivElement>(null)
  const options = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (props.pending) {
      body.current?.focus()
      return
    }
    body.current?.querySelector<HTMLButtonElement>("button")?.focus()
  }, [props.pending])

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      ariaLabelledBy={headingID}
      closeOnBackdropClick={!props.pending}
      closeOnEscape={!props.pending}
    >
      <div
        ref={body}
        tabIndex={-1}
        aria-busy={props.pending}
        onKeyDown={(event) => {
          const buttons = Array.from(body.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
          if (!buttons.length) {
            if (event.key === "Tab" || event.key === "Enter") event.preventDefault()
            return
          }
          if (event.key === "Enter") {
            event.preventDefault()
            const active = document.activeElement
            const target = active instanceof HTMLButtonElement && buttons.includes(active) ? active : buttons[0]
            target.click()
            return
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const items = Array.from(options.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])
            if (items.length < 2) return
            event.preventDefault()
            const current = items.indexOf(document.activeElement as HTMLButtonElement)
            if (current === -1) {
              items[event.key === "ArrowDown" ? 0 : items.length - 1].focus()
              return
            }
            const direction = event.key === "ArrowDown" ? 1 : -1
            items[(current + direction + items.length) % items.length].focus()
            return
          }
          if (event.key !== "Tab") return
          const first = buttons[0]
          const last = buttons[buttons.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <ModalHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 id={headingID} className="text-base font-semibold text-gray-900 dark:text-gray-100">
              选择发送方式
            </h2>
          </div>
        </ModalHeader>
        <ModalBody className="space-y-3 pt-1">
          <p className="text-xs text-gray-500 dark:text-gray-400">AI 正在执行，你希望何时发送这条消息？</p>
          <div ref={options} className="grid gap-2.5">
            <button
              type="button"
              disabled={props.pending}
              onClick={() => props.onSelect("steer")}
              className="group relative flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-start shadow-2xs transition-all hover:border-indigo-400 hover:bg-indigo-50/40 hover:shadow-xs focus-visible:outline-blue-500 disabled:opacity-50 dark:border-gray-700/80 dark:bg-white/[0.02] dark:hover:border-indigo-500/60 dark:hover:bg-indigo-950/20"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-indigo-200/60 bg-indigo-50 text-indigo-600 dark:border-indigo-800/50 dark:bg-indigo-950/50 dark:text-indigo-400 transition-colors group-hover:scale-105">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600 dark:text-gray-100 dark:group-hover:text-indigo-300">
                    立即补充
                  </span>
                  <span className="rounded bg-indigo-100 px-1.5 py-0.2 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300">
                    补充
                  </span>
                </div>
                <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  按待发送顺序，在下一个安全模型调用时加入。
                </span>
              </div>
            </button>

            <button
              type="button"
              disabled={props.pending}
              onClick={() => props.onSelect("queue")}
              className="group relative flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-start shadow-2xs transition-all hover:border-amber-400 hover:bg-amber-50/40 hover:shadow-xs focus-visible:outline-blue-500 disabled:opacity-50 dark:border-gray-700/80 dark:bg-white/[0.02] dark:hover:border-amber-500/60 dark:hover:bg-amber-950/20"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-200/60 bg-amber-50 text-amber-600 dark:border-amber-800/50 dark:bg-amber-950/50 dark:text-amber-400 transition-colors group-hover:scale-105">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900 group-hover:text-amber-600 dark:text-gray-100 dark:group-hover:text-amber-300">
                    排队发送
                  </span>
                  <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                    顺序执行
                  </span>
                </div>
                <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  等待当前任务完成后，再发送这条消息。
                </span>
              </div>
            </button>
          </div>

          {props.error && (
            <div role="alert" className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="min-w-0 flex-1">{props.error}</span>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            disabled={props.pending}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/5 dark:hover:text-gray-100 transition-colors"
            onClick={props.onClose}
          >
            {props.pending ? "正在提交…" : "取消"}
          </button>
        </ModalFooter>
      </div>
    </Modal>
  )
}
