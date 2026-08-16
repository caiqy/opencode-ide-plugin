import { ModelSelector } from "../ModelSelector"
import { AgentSelector } from "../AgentSelector"
import { VariantSelector } from "../VariantSelector"
import { MessageActions } from "./MessageActions"

interface EditorToolbarProps {
  selectedProviderId: string | undefined
  selectedModelId: string | undefined
  selectedAgent: string
  onModelSelect: (providerId: string, modelId: string) => void
  onAgentSelect: (agent: string) => void
  onFileSelect: () => void
  isDisabled: boolean
  modelSelectorKey: number
  lastFailedMessage: boolean
  onRetry: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  isIdle: boolean
  isButtonDisabled: boolean
  isCompactDisabled: boolean
  onSubmit: () => void
  onAbort: () => void
  onCompactClick: () => void
  variants?: string[]
  selectedVariant?: string
  onVariantSelect: (variant: string | undefined) => void
  isReasoningModel?: boolean
  selectionPending?: boolean
}

export function EditorToolbar({
  selectedProviderId,
  selectedModelId,
  selectedAgent,
  onModelSelect,
  onAgentSelect,
  onFileSelect,
  isDisabled,
  modelSelectorKey,
  lastFailedMessage,
  onRetry,
  fileInputRef,
  onFileChange,
  isIdle,
  isButtonDisabled,
  isCompactDisabled,
  onSubmit,
  onAbort,
  onCompactClick,
  variants,
  selectedVariant,
  onVariantSelect,
  isReasoningModel,
  selectionPending = false,
}: EditorToolbarProps) {
  return (
    <div className="flex min-h-9 items-center gap-2 px-3 pb-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap content-center items-center gap-0.5 sm:flex-nowrap" data-testid="composer-toolbar-controls">
        {selectionPending ? (
          <div className="px-2 text-xs text-gray-500 dark:text-gray-400">正在切换会话设置…</div>
        ) : (
          <>
            {lastFailedMessage && (
              <button
                onClick={onRetry}
                className="h-6 px-2 flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 rounded border border-red-200 dark:border-red-800"
                title="恢复失败消息"
                data-tip="恢复失败消息"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                重试
              </button>
            )}
            <button
              type="button"
              onClick={onFileSelect}
              disabled={isDisabled}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="添加文件"
              title="添加文件"
              data-tip="添加文件"
              data-testid="add-file"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m-7-7h14" />
              </svg>
            </button>
            <AgentSelector selectedAgent={selectedAgent} onSelect={onAgentSelect} disabled={isDisabled} />
            <ModelSelector
              key={modelSelectorKey}
              selectedProviderId={selectedProviderId}
              selectedModelId={selectedModelId}
              onSelect={onModelSelect}
              disabled={isDisabled}
              renderInPortal
            />
            <VariantSelector
              variants={variants}
              selectedVariant={selectedVariant}
              onSelect={onVariantSelect}
              disabled={isDisabled}
              isReasoningModel={isReasoningModel}
            />
            <button
              type="button"
              disabled
              className="flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-xs text-gray-400 opacity-60 dark:text-gray-500"
              aria-label="自动审批"
              title="自动审批（暂未启用）"
              data-tip="自动审批（暂未启用）"
              data-testid="auto-approve"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 5-3.5 8.4-7 10-3.5-1.6-7-5-7-10V6l7-3z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m9 12 2 2 4-4" />
              </svg>
              自动审批
            </button>
            <input
              ref={fileInputRef}
              id="opencode-file-input"
              name="opencode-file-input"
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,application/pdf,text/*"
              multiple
              onChange={onFileChange}
              aria-label="添加文件"
              className="hidden"
            />
          </>
        )}
      </div>
      <MessageActions
        isIdle={isIdle}
        isButtonDisabled={isButtonDisabled}
        isCompactDisabled={isCompactDisabled}
        onSubmit={onSubmit}
        onAbort={onAbort}
        onCompactClick={onCompactClick}
      />
    </div>
  )
}
