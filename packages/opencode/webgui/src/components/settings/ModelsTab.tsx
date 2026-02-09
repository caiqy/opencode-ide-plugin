import type { Config, Provider } from "@opencode-ai/sdk/client"

interface ModelsTabProps {
  formData: Partial<Config>
  setFormData: (data: Partial<Config>) => void
  providers: Provider[]
  configuredProviders: string[]
}

export function ModelsTab({ formData, setFormData, providers, configuredProviders }: ModelsTabProps) {
  const displayedProviders = providers.filter((p) => configuredProviders.includes(p.id))

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">默认模型</label>
        <input
          type="text"
          value={formData.model || ""}
          onChange={(e) => setFormData({ ...formData, model: e.target.value })}
          placeholder="例如 anthropic/claude-sonnet-4-5"
          className="modern-input w-full font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          格式：provider/model（例如 anthropic/claude-sonnet-4-5）
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">轻量模型</label>
        <input
          type="text"
          value={formData.small_model || ""}
          onChange={(e) => setFormData({ ...formData, small_model: e.target.value })}
          placeholder="例如 anthropic/claude-haiku-3-5"
          className="modern-input w-full font-mono text-sm"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">用于生成标题等任务</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">禁用的提供方</label>
        <div className="space-y-2">
          {displayedProviders.map((provider) => (
            <label key={provider.id} className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.disabled_providers?.includes(provider.id) ?? false}
                onChange={(e) => {
                  const current = formData.disabled_providers || []
                  if (e.target.checked) {
                    setFormData({ ...formData, disabled_providers: [...current, provider.id] })
                  } else {
                    setFormData({ ...formData, disabled_providers: current.filter((id) => id !== provider.id) })
                  }
                }}
                className="rounded border-gray-300 dark:border-gray-700"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{provider.name}</span>
            </label>
          ))}
          {displayedProviders.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">未找到已配置的提供方。</p>
          )}
        </div>
      </div>
    </div>
  )
}
