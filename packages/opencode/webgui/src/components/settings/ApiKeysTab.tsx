import type { Provider } from "@opencode-ai/sdk/client"

interface ApiKeysTabProps {
  providers: Provider[]
  apiKeys: Record<string, string>
  setApiKeys: (keys: Record<string, string>) => void
  showApiKeys: Record<string, boolean>
  setShowApiKeys: (show: Record<string, boolean>) => void
}

export function ApiKeysTab({ providers, apiKeys, setApiKeys, showApiKeys, setShowApiKeys }: ApiKeysTabProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Configure API keys for AI providers. Keys are stored securely.
      </p>

      {providers.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No providers available</div>
      ) : (
        providers.map((provider) => (
          <div key={provider.id} className="border border-gray-200 dark:border-gray-700 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{provider.name}</label>
              {provider.env.length > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">{provider.env[0]}</span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type={showApiKeys[provider.id] ? "text" : "password"}
                value={apiKeys[provider.id] || ""}
                onChange={(e) => setApiKeys({ ...apiKeys, [provider.id]: e.target.value })}
                placeholder={`Enter ${provider.name} API key`}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              />
              <button
                onClick={() => setShowApiKeys({ ...showApiKeys, [provider.id]: !showApiKeys[provider.id] })}
                className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                title={showApiKeys[provider.id] ? "Hide" : "Show"}
              >
                {showApiKeys[provider.id] ? "👁️" : "👁️‍🗨️"}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
