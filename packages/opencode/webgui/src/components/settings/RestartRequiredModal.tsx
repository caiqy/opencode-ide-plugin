import { useState } from "react"
import { ideBridge } from "../../lib/ideBridge"
import { flushScopedStateWrites } from "../../state/scopedStorage"
import { Button, Modal } from "../common"

interface RestartRequiredModalProps {
  isOpen: boolean
  onClose: () => void
}

export function RestartRequiredModal({ isOpen, onClose }: RestartRequiredModalProps) {
  const [error, setError] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)

  const restart = async () => {
    setRestarting(true)
    setError(null)
    try {
      await flushScopedStateWrites()
      const response = await ideBridge.request("restartHost")
      if (response.ok !== true) setError("请手动重启插件或执行 Reload Window")
    } catch {
      setError("请手动重启插件或执行 Reload Window")
    } finally {
      setRestarting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="space-y-4 p-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Provider 设置已保存</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">配置变更需要重启插件后才能生效。</p>
        </div>
        {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={restarting}>
            暂不重启
          </Button>
          <Button variant="primary" onClick={restart} loading={restarting}>
            立即重启
          </Button>
        </div>
      </div>
    </Modal>
  )
}
