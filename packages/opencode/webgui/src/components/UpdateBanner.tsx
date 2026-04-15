import { useUpdate } from "../state/UpdateContext"

const statusText = {
  available: "待更新",
  downloading: "下载中",
  installing: "安装中",
  success: "安装完成，请重载 VSCode",
  error: "更新失败",
  idle: "空闲",
} as const

const titleText = {
  available: "发现新版本可更新",
  downloading: "正在下载更新",
  installing: "正在安装更新",
  success: "更新已安装完成，请重载 VSCode",
  error: "更新失败，请重试",
  idle: "",
} as const

export function UpdateBanner() {
  const update = useUpdate()

  if (!update.latest || update.status === "idle") return null

  const title = titleText[update.status]
  const disabled = update.status === "downloading" || update.status === "installing" || update.status === "success"

  return (
    <div
      className="w-full border-b border-blue-200 bg-blue-50 px-4 py-2 text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100"
      role="status"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold">{title}</p>
          <div className="text-xs opacity-90">
            <p>当前版本：{update.currentVersion}</p>
            <p>最新版本：{update.latest.version}</p>
            <p>状态：{statusText[update.status]}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled}
            onClick={() => {
              void update.installUpdate(update.latest!.version)
            }}
          >
            立即更新
          </button>
          {update.latest.releaseUrl ? (
            <button
              className="rounded border border-blue-300 px-3 py-1 text-sm font-medium transition-colors hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900"
              onClick={() => {
                void update.openRelease()
              }}
            >
              查看 Release
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
