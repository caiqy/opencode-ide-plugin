import type { Config } from "@opencode-ai/sdk/client"
import { useProject } from "../../state/ProjectContext"
import { useUISettings } from "../../state/UISettingsContext"

interface GeneralTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
}

export function GeneralTab({ formData, setFormData }: GeneralTabProps) {
  const { worktree } = useProject()
  const { autoExpandMessageParts, setAutoExpandMessageParts } = useUISettings()

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
        <input
          type="text"
          value={formData.username || ""}
          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          placeholder="Your username"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Custom username to display in conversations</p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.autoupdate === true}
            onChange={(e) => setFormData({ ...formData, autoupdate: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Auto-update</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">Automatically update to the latest version</p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={autoExpandMessageParts}
            onChange={(e) => {
              setAutoExpandMessageParts(e.target.checked).catch((error) => {
                console.error("[GeneralTab] Failed to update auto-expand setting:", error)
              })
            }}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Auto expand thinking and tool calls</span>
          <button
            type="button"
            aria-label="Auto expand help"
            title="When disabled, thinking/tool blocks are collapsed by default and can still be expanded manually."
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[10px] text-gray-500 dark:border-gray-600 dark:text-gray-400"
          >
            i
          </button>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">
          Applies immediately. When enabled, thinking/tool blocks open by default and stay expanded unless manually
          collapsed.
        </p>
      </div>

      <div>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={formData.snapshot ?? false}
            onChange={(e) => setFormData({ ...formData, snapshot: e.target.checked })}
            className="rounded border-gray-300 dark:border-gray-700"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">Enable snapshots</span>
        </label>
        <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">
          Take snapshots of file state during sessions
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Share Mode</label>
        <select
          value={formData.share || "manual"}
          onChange={(e) => setFormData({ ...formData, share: e.target.value as "manual" | "auto" | "disabled" })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="manual">Manual</option>
          <option value="auto">Auto</option>
          <option value="disabled">Disabled</option>
        </select>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Control session sharing behavior</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Working directory</label>
        <div className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-gray-50 dark:bg-gray-900 text-xs font-mono text-gray-900 dark:text-gray-100 truncate">
          {worktree ?? "Unknown"}
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Directory where the OpenCode server was started.
        </p>
      </div>
    </div>
  )
}
