import type { Config } from "@opencode-ai/sdk/client"

interface AdvancedTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
}

export function AdvancedTab({ formData, setFormData }: AdvancedTabProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Theme</label>
        <input
          type="text"
          value={formData.theme || ""}
          onChange={(e) => setFormData({ ...formData, theme: e.target.value })}
          placeholder="Theme name"
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">TUI theme name (not used in web GUI)</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Watch Ignore Patterns</label>
        <textarea
          value={formData.watcher?.ignore?.join("\n") || ""}
          onChange={(e) =>
            setFormData({
              ...formData,
              watcher: { ignore: e.target.value.split("\n").filter((line) => line.trim()) },
            })
          }
          placeholder="node_modules&#10;dist&#10;.git"
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">File patterns to ignore (one per line)</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Plugins</label>
        <textarea
          value={formData.plugin?.join("\n") || ""}
          onChange={(e) =>
            setFormData({
              ...formData,
              plugin: e.target.value.split("\n").filter((line) => line.trim()),
            })
          }
          placeholder="plugin-name&#10;another-plugin"
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Plugin names (one per line)</p>
      </div>
    </div>
  )
}
