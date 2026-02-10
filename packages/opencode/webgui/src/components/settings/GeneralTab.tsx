import type { Config } from "@opencode-ai/sdk/client"
import { useProject } from "../../state/ProjectContext"

interface GeneralTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
}

export function GeneralTab({ formData, setFormData }: GeneralTabProps) {
  const { worktree } = useProject()

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名</label>
        <input
          type="text"
          value={formData.username || ""}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          placeholder="输入用户名"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">在会话中显示的自定义用户名</p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.autoupdate === true}
            onChange={(e) => setFormData({ ...formData, autoupdate: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">自动更新</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">自动更新到最新版本</p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.snapshot ?? false}
            onChange={(e) => setFormData({ ...formData, snapshot: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">启用快照</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">在会话中记录文件状态快照</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">分享模式</label>
        <select
          value={formData.share || "manual"}
          onChange={(e) => setFormData({ ...formData, share: e.target.value as "manual" | "auto" | "disabled" })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="manual">手动</option>
          <option value="auto">自动</option>
          <option value="disabled">禁用</option>
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">控制会话分享行为</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">工作目录</label>
        <div className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-900 text-xs font-mono text-gray-900 dark:text-gray-100 truncate">
          {worktree ?? "未知"}
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">OpenCode 服务器启动时所在的目录。</p>
      </div>
    </div>
  )
}
