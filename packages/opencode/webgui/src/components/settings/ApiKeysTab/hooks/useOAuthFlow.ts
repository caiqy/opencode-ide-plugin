import { useState } from "react"
import { sdk } from "../../../../lib/api/sdkClient"
import { ideBridge } from "../../../../lib/ideBridge"

interface ManualCodeState {
  providerId: string
  id: string
  instructions?: string
}

interface UseOAuthFlowProps {
  configuredProviders: string[]
  setConfiguredProviders: (providers: string[]) => void
  selectedProviderToAdd: string
  setSelectedProviderToAdd: (provider: string) => void
  markProvidersDirty: () => void
}

export function useOAuthFlow({
  configuredProviders,
  setConfiguredProviders,
  selectedProviderToAdd,
  setSelectedProviderToAdd,
  markProvidersDirty,
}: UseOAuthFlowProps) {
  const [authStatus, setAuthStatus] = useState<Record<string, string>>({})
  const [manualCodeState, setManualCodeState] = useState<ManualCodeState | null>(null)
  const [authInstructions, setAuthInstructions] = useState<Record<string, string>>({})
  const [manualCodeInput, setManualCodeInput] = useState("")

  const handleOAuthLogin = async (providerId: string, methodIndex: number) => {
    try {
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Initializing..." }))
      const { id, url, method, instructions } = await sdk.auth.start(providerId, methodIndex, {})

      if (instructions) {
        setAuthInstructions((prev) => ({ ...prev, [providerId]: instructions }))
      }

      if (url) {
        if (ideBridge.isInstalled()) {
          ideBridge.send({ type: "openUrl", payload: { url } })
        } else {
          window.open(url, "_blank")
        }
      }

      if (method === "code") {
        setAuthStatus((prev) => ({ ...prev, [providerId]: "Waiting for code..." }))
        setManualCodeState({ providerId, id, instructions })
        setManualCodeInput("")
        return
      }

      setAuthStatus((prev) => ({ ...prev, [providerId]: "Waiting for browser..." }))
      await sdk.auth.submit(id, "")

      setAuthStatus((prev) => ({ ...prev, [providerId]: "Connected!" }))
      if (!configuredProviders.includes(providerId)) {
        setConfiguredProviders([...configuredProviders, providerId])
      }
      if (selectedProviderToAdd === providerId) {
        setSelectedProviderToAdd("")
      }
      setTimeout(() => setAuthStatus((prev) => ({ ...prev, [providerId]: "" })), 3000)
      markProvidersDirty()
    } catch (e) {
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Failed" }))
      console.error(e)
    }
  }

  const handleCancel = (providerId: string) => {
    setAuthStatus((prev) => ({ ...prev, [providerId]: "" }))
    setAuthInstructions((prev) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [providerId]: _removed, ...rest } = prev
      return rest
    })
    if (manualCodeState?.providerId === providerId) {
      setManualCodeState(null)
      setManualCodeInput("")
    }
  }

  const handleManualCodeSubmit = async () => {
    if (!manualCodeState || !manualCodeInput) return

    const { providerId, id } = manualCodeState
    try {
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Verifying code..." }))
      await sdk.auth.submit(id, manualCodeInput)

      setAuthStatus((prev) => ({ ...prev, [providerId]: "Connected!" }))
      if (!configuredProviders.includes(providerId)) {
        setConfiguredProviders([...configuredProviders, providerId])
      }
      if (selectedProviderToAdd === providerId) {
        setSelectedProviderToAdd("")
      }
      setManualCodeState(null)
      setManualCodeInput("")
      setTimeout(() => setAuthStatus((prev) => ({ ...prev, [providerId]: "" })), 3000)
      markProvidersDirty()
    } catch (e) {
      console.error("Error submitting code:", e)
      setAuthStatus((prev) => ({ ...prev, [providerId]: "Error submitting code" }))
    }
  }

  return {
    authStatus,
    authInstructions,
    manualCodeState,
    manualCodeInput,
    setManualCodeInput,
    handleOAuthLogin,
    handleCancel,
    handleManualCodeSubmit,
  }
}
