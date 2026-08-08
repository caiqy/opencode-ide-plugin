import { useMemo, useState } from "react"
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client"
import { cn } from "../../../utils/classNames"
import { MarkdownRenderer } from "../../MarkdownRenderer"

interface QuestionToolProps {
  questions: QuestionInfo[]
  answers: string[][]
  mode: "completed" | "ignored" | "interrupted"
}

export function QuestionTool({ questions, answers, mode }: QuestionToolProps) {
  const [activeTab, setActiveTab] = useState(0)

  const currentQuestion = questions[activeTab]
  const currentAnswers = answers[activeTab] ?? []
  const selectedLabels = useMemo(() => new Set(currentAnswers), [currentAnswers])
  const optionLabels = useMemo(
    () => new Set(currentQuestion?.options.map((option) => option.label) ?? []),
    [currentQuestion],
  )
  const customAnswers = useMemo(
    () => currentAnswers.filter((answer) => !optionLabels.has(answer)),
    [currentAnswers, optionLabels],
  )

  if (!currentQuestion) return null

  const isIgnored = mode === "ignored"
  const title = mode === "completed" ? "已完成" : isIgnored ? "已忽略" : "已中断"
  const note = `${title} · 当前为只读`
  const frameClass = isIgnored
    ? "border-blue-300 dark:border-blue-700 bg-gray-50 dark:bg-gray-900 opacity-80"
    : "border-blue-300 dark:border-blue-700 bg-gray-50 dark:bg-gray-900"
  const headerClass = isIgnored
    ? "bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800"
    : "bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800"
  const titleClass = isIgnored
    ? "bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700"
    : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600"

  return (
    <div className={`m-3 overflow-hidden rounded-xl border shadow-sm ${frameClass}`}>
      <div className={`flex items-center gap-2 border-b px-3 py-2 ${headerClass}`}>
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
          ?
        </span>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">提问</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{questions.length} 个问题</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${titleClass}`}>{title}</span>
      </div>

      <div className="flex flex-row gap-1 px-3 py-2 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex flex-wrap gap-2">
          {questions.map((question, index) => {
            const answered = (answers[index]?.length ?? 0) > 0
            const active = index === activeTab
            return (
              <button
                key={`${question.header}-${index}`}
                type="button"
                onClick={() => setActiveTab(index)}
                className={cn(
                  "px-2 py-1 text-xs rounded transition-colors",
                  active
                    ? "bg-blue-600 text-white"
                    : answered
                      ? "bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700",
                  isIgnored && !active ? "opacity-80" : "",
                )}
              >
                {question.header}
                {answered && !active ? <span className="ml-1 text-green-600 dark:text-green-400">✓</span> : null}
                {answered && active ? " ✓" : ""}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3 px-3 py-3">
        <div>
          <div className="mb-1 text-[11px] text-gray-500 dark:text-gray-400">当前题目</div>
          <div className="text-sm text-gray-800 dark:text-gray-200 [&_.markdown-content>*:last-child]:mb-0">
            <MarkdownRenderer>{currentQuestion.question}</MarkdownRenderer>
            {currentQuestion.multiple === true ? (
              <span className="text-gray-500 dark:text-gray-400 text-xs">（可多选）</span>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          {currentQuestion.options.map((option, index) => {
            const selected = selectedLabels.has(option.label)

            return (
              <div
                key={`${option.label}-${index}`}
                className={cn(
                  "w-full text-left p-2 rounded border transition-colors",
                  selected
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900",
                  isIgnored ? "opacity-80" : "",
                )}
              >
                <div className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 w-4 flex-shrink-0">
                    {index + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {currentQuestion.multiple === true ? (
                        <span
                          className={cn(
                            "w-4 h-4 flex items-center justify-center border rounded text-xs",
                            selected
                              ? "border-blue-500 bg-blue-500 text-white"
                              : "border-gray-300 dark:border-gray-600",
                          )}
                        >
                          {selected ? "✓" : ""}
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "w-4 h-4 flex items-center justify-center border rounded-full",
                            selected ? "border-blue-500 bg-blue-500" : "border-gray-300 dark:border-gray-600",
                          )}
                        >
                          {selected ? <span className="w-2 h-2 bg-white rounded-full" /> : null}
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-sm font-medium",
                          selected ? "text-blue-700 dark:text-blue-300" : "text-gray-800 dark:text-gray-200",
                        )}
                      >
                        {option.label}
                      </span>
                      {currentQuestion.multiple !== true && selected ? (
                        <span className="text-green-600 dark:text-green-400 text-xs">✓</span>
                      ) : null}
                    </div>
                    {option.description ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">{option.description}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}

          {currentQuestion.custom !== false ? (
            <div
              className={cn(
                "w-full text-left p-2 rounded border transition-colors",
                customAnswers.length > 0
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900",
                isIgnored ? "opacity-80" : "",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 w-4 flex-shrink-0">
                  {currentQuestion.options.length + 1}.
                </span>
                <span
                  className={cn(
                    currentQuestion.multiple === true
                      ? "w-4 h-4 flex items-center justify-center border rounded text-xs mt-0.5"
                      : "w-4 h-4 flex items-center justify-center border rounded-full mt-0.5",
                    customAnswers.length > 0
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-gray-300 dark:border-gray-600 text-transparent",
                  )}
                >
                  {currentQuestion.multiple === true
                    ? customAnswers.length > 0
                      ? "✓"
                      : ""
                    : customAnswers.length > 0
                      ? "●"
                      : ""}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        customAnswers.length > 0
                          ? "text-blue-700 dark:text-blue-300"
                          : "text-gray-800 dark:text-gray-200",
                      )}
                    >
                      输入自定义答案
                    </span>
                    {currentQuestion.multiple !== true && customAnswers.length > 0 ? (
                      <span className="text-green-600 dark:text-green-400 text-xs">✓</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {customAnswers.join("、") || "未填写"}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between pt-1 text-xs text-gray-500 dark:text-gray-400">
          <span>{note}</span>
          <span>
            {activeTab + 1} / {questions.length}
          </span>
        </div>
      </div>
    </div>
  )
}
