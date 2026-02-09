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
      setAuthStatus((prev) => ({ ...prev, [providerId]: "初始化中…" }))
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
        setAuthStatus((prev) => ({ ...prev, [providerId]: "等待输入授权码…" }))
        setManualCodeState({ providerId, id, instructions })
        setManualCodeInput("")
        return
      }

      setAuthStatus((prev) => ({ ...prev, [providerId]: "等待浏览器完成授权…" }))
      await sdk.auth.submit(id, "")

      setAuthStatus((prev) => ({ ...prev, [providerId]: "已连接！" }))
      if (!configuredProviders.includes(providerId)) {
        setConfiguredProviders([...configuredProviders, providerId])
      }
      if (selectedProviderToAdd === providerId) {
        setSelectedProviderToAdd("")
      }
      setTimeout(() => setAuthStatus((prev) => ({ ...prev, [providerId]: "" })), 3000)
      markProvidersDirty()
    } catch (e) {
      setAuthStatus((prev) => ({ ...prev, [providerId]: "失败" }))
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
      setAuthStatus((prev) => ({ ...prev, [providerId]: "正在验证授权码…" }))
      await sdk.auth.submit(id, manualCodeInput)

      setAuthStatus((prev) => ({ ...prev, [providerId]: "已连接！" }))
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
      console.error("提交授权码失败：", e)
      setAuthStatus((prev) => ({ ...prev, [providerId]: "提交授权码失败" }))
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
