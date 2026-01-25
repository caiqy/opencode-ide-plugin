import { IconButton } from "../common"

interface SettingsHeaderProps {
  onClose: () => void
}

export function SettingsHeader({ onClose }: SettingsHeaderProps) {
  return (
    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
      <IconButton
        onClick={onClose}
        size="md"
        aria-label="Close"
        title="Close"
        data-tip="Close"
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        }
      />
    </div>
  )
}
