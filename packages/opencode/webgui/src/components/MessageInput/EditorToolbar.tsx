import { ModelSelector } from "../ModelSelector"
import { AgentSelector } from "../AgentSelector"
import { VariantSelector } from "../VariantSelector"
import { MessageActions } from "./MessageActions"
import type { ApprovalMode } from "../../state/approval"
import { ApprovalModeSelector } from "../ApprovalModeSelector"
import { AddContextMenu } from "./AddContextMenu"

interface EditorToolbarProps {
  selectedProviderId: string | undefined
  selectedModelId: string | undefined
  selectedAgent: string
  onModelSelect: (providerId: string, modelId: string) => void
  onAgentSelect: (agent: string) => void
  onFileSelect?: () => void
  onSelectFiles?: () => void
  onSelectDirectory?: () => void
  isDisabled: boolean
  modelSelectorKey: number
  lastFailedMessage: boolean
  onRetry: () => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  directoryInputRef?: React.RefObject<HTMLInputElement | null>
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onDirectoryChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
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
  approvalMode: ApprovalMode
  approvalPending: boolean
  approvalDisabled?: boolean
  onApprovalSelect: (mode: ApprovalMode) => void
}

export function EditorToolbar({
  selectedProviderId,
  selectedModelId,
  selectedAgent,
  onModelSelect,
  onAgentSelect,
  onFileSelect,
  onSelectFiles,
  onSelectDirectory,
  isDisabled,
  modelSelectorKey,
  lastFailedMessage,
  onRetry,
  fileInputRef,
  directoryInputRef,
  onFileChange,
  onDirectoryChange,
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
  approvalMode,
  approvalPending,
  approvalDisabled = false,
  onApprovalSelect,
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
            <AddContextMenu
              disabled={isDisabled}
              onSelectFiles={onSelectFiles ?? onFileSelect ?? (() => {})}
              onSelectDirectory={onSelectDirectory ?? (() => {})}
            />
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
<ApprovalModeSelector
              value={approvalMode}
              onSelect={onApprovalSelect}
              disabled={isDisabled || approvalPending || approvalDisabled}
            />
            <input
              ref={fileInputRef}
              id="opencode-file-input"
              name="opencode-file-input"
              type="file"
              multiple
              onChange={onFileChange}
              aria-label="添加文件"
              className="hidden"
            />
            <input
              ref={directoryInputRef}
              id="opencode-directory-input"
              name="opencode-directory-input"
              type="file"
              {...({ webkitdirectory: "" } as any)}
              multiple
              onChange={onDirectoryChange}
              aria-label="添加文件夹"
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
