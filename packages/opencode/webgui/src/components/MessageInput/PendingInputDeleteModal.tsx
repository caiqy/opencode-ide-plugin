import { useEffect, useId, useRef } from "react"
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../common/Modal"

export function PendingInputDeleteModal(props: {
  pending: boolean
  error: string | null
  onOverwrite: () => void
  onDiscard: () => void
  onClose: () => void
}) {
  const headingID = useId()
  const overwrite = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!props.pending) overwrite.current?.focus()
  }, [props.pending])

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      ariaLabelledBy={headingID}
      closeOnBackdropClick={!props.pending}
      closeOnEscape={!props.pending}
    >
      <ModalHeader>
        <h2 id={headingID} className="text-base font-semibold text-gray-900 dark:text-gray-100">
          输入框已有内容
        </h2>
      </ModalHeader>
      <ModalBody>
        <p className="text-sm text-gray-600 dark:text-gray-300">请选择如何处理这条待发送消息。</p>
        {props.error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{props.error}</p>}
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          disabled={props.pending}
          onClick={props.onClose}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/5"
        >
          取消
        </button>
        <button
          type="button"
          disabled={props.pending}
          onClick={props.onDiscard}
          className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          保留草稿并丢弃
        </button>
        <button
          ref={overwrite}
          type="button"
          disabled={props.pending}
          onClick={props.onOverwrite}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 focus-visible:outline-blue-500 disabled:opacity-50"
        >
          {props.pending ? "正在删除…" : "覆盖并回填"}
        </button>
      </ModalFooter>
    </Modal>
  )
}
