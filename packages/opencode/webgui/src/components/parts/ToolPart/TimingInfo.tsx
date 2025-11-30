interface TimingInfoProps {
  time: {
    start: number
    end?: number
  }
}

export function TimingInfo({ time }: TimingInfoProps) {
  return (
    <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
      <div className="text-[10px] text-gray-500 dark:text-gray-400">
        {time.end
          ? `Completed in ${((time.end - time.start) / 1000).toFixed(2)}s`
          : `Started ${new Date(time.start).toLocaleTimeString()}`}
      </div>
    </div>
  )
}
