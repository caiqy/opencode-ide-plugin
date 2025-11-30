import { ManualCodeInput } from "./ManualCodeInput"

interface AuthMethod {
  label: string
  type: "oauth" | "api"
}

interface OAuthSectionProps {
  providerId: string
  providerName: string
  methods: AuthMethod[]
  oauthMethodIndex: number
  authStatus: string
  manualCodeState: { providerId: string; id: string } | null
  manualCodeInput: string
  onOAuthLogin: (providerId: string, methodIndex: number) => void
  onCancel: (providerId: string) => void
  onManualCodeChange: (value: string) => void
  onManualCodeSubmit: () => void
  onManualCodeCancel: () => void
}

export function OAuthSection({
  providerId,
  providerName,
  methods,
  oauthMethodIndex,
  authStatus,
  manualCodeState,
  manualCodeInput,
  onOAuthLogin,
  onCancel,
  onManualCodeChange,
  onManualCodeSubmit,
  onManualCodeCancel,
}: OAuthSectionProps) {
  const isWaiting = authStatus && (authStatus.startsWith("Waiting") || authStatus === "Initializing...")
  const showManualCodeInput = manualCodeState?.providerId === providerId

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onOAuthLogin(providerId, oauthMethodIndex)}
          disabled={!!authStatus && authStatus !== "Waiting for code..."}
          className="px-3 py-1.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md text-xs font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors disabled:opacity-50 shadow-sm"
        >
          {methods[oauthMethodIndex].label || `Login with ${providerName}`}
        </button>
        {authStatus && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-blue-600 dark:text-blue-400 animate-pulse">{authStatus}</span>
            {isWaiting && !showManualCodeInput && (
              <button
                onClick={() => onCancel(providerId)}
                className="px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>

      {showManualCodeInput && (
        <ManualCodeInput
          value={manualCodeInput}
          onValueChange={onManualCodeChange}
          onSubmit={onManualCodeSubmit}
          onCancel={onManualCodeCancel}
        />
      )}
    </div>
  )
}
