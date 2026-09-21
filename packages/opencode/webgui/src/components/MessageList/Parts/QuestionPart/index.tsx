import { useState, useCallback } from "react"
import type { QuestionInfo, QuestionRequest, QuestionAnswer } from "@opencode-ai/sdk/v2/client"
import { QuestionTabs } from "./QuestionTabs"
import { QuestionOptions } from "./QuestionOptions"
import { ConfirmTab } from "./ConfirmTab"
import { useMessages } from "../../../../state/MessagesContext"

interface QuestionPartProps {
  request: QuestionRequest
}

const optionLabels = (question: QuestionInfo | undefined) =>
  new Set((question?.options ?? []).map((option) => option.label))

export function QuestionPart({ request }: QuestionPartProps) {
  const { replyQuestion, rejectQuestion } = useMessages()
  const questions = request.questions
  const [activeTab, setActiveTab] = useState(0)
  const [answers, setAnswers] = useState<QuestionAnswer[]>(() => questions.map(() => []))
  const [customInputs, setCustomInputs] = useState<string[]>(() => questions.map(() => ""))
  const [isLoading, setIsLoading] = useState(false)
  const [editingCustom, setEditingCustom] = useState<boolean[]>(() => questions.map(() => false))

  // The confirm tab is the last step: nothing is submitted until the user confirms there.
  const isConfirmTab = activeTab === questions.length

  // Current question (if not on confirm tab)
  const currentQuestion = questions[activeTab]
  const currentAnswers = answers[activeTab] ?? []
  const currentCustomInput = customInputs[activeTab] ?? ""
  const isMultiple = currentQuestion?.multiple === true
  const isEditingCustom = editingCustom[activeTab] ?? false

  // A custom answer is committed once it shows up in the answers without being a preset option label.
  const committedCustom = currentAnswers.find((answer) => !optionLabels(currentQuestion).has(answer))
  // Opening the input selects the custom option right away, so it stays checked while editing.
  const isCustomSelected = isEditingCustom || committedCustom !== undefined

  // Handle submitting answers
  const handleSubmit = useCallback(async () => {
    setIsLoading(true)
    try {
      await replyQuestion(request.id, answers)
    } catch (error) {
      console.error("[QuestionPart] Failed to submit answers:", error)
    } finally {
      setIsLoading(false)
    }
  }, [request.id, answers, replyQuestion])

  // Handle rejecting/dismissing
  const handleDismiss = useCallback(async () => {
    setIsLoading(true)
    try {
      await rejectQuestion(request.id)
    } catch (error) {
      console.error("[QuestionPart] Failed to reject question:", error)
    } finally {
      setIsLoading(false)
    }
  }, [request.id, rejectQuestion])

  const setCustomEditing = useCallback(
    (value: boolean) => {
      setEditingCustom((prev) => {
        if ((prev[activeTab] ?? false) === value) return prev
        const next = [...prev]
        next[activeTab] = value
        return next
      })
    },
    [activeTab],
  )

  // The draft is the answer while the custom option is selected; empty means unanswered.
  const writeCustomAnswer = useCallback(
    (value: string) => {
      const labels = optionLabels(questions[activeTab])
      setAnswers((prev) => {
        const newAnswers = [...prev]
        const presets = (newAnswers[activeTab] ?? []).filter((answer) => labels.has(answer))
        newAnswers[activeTab] = !value ? presets : isMultiple ? [...presets, value] : [value]
        return newAnswers
      })
    },
    [activeTab, questions, isMultiple],
  )

  // Handle option toggle
  const handleToggleOption = useCallback(
    (label: string) => {
      if (!isMultiple) setCustomEditing(false)
      setAnswers((prev) => {
        const newAnswers = [...prev]
        const currentAnswers = [...(newAnswers[activeTab] ?? [])]

        if (isMultiple) {
          // Multi-select: toggle the option
          const index = currentAnswers.indexOf(label)
          if (index === -1) {
            currentAnswers.push(label)
          } else {
            currentAnswers.splice(index, 1)
          }
          newAnswers[activeTab] = currentAnswers
        } else {
          // Single-select: replace the answer, then move to the confirm tab
          newAnswers[activeTab] = [label]
          setTimeout(() => {
            setActiveTab((prev) => Math.min(prev + 1, questions.length))
          }, 150)
        }

        return newAnswers
      })
    },
    [activeTab, isMultiple, questions.length, setCustomEditing],
  )

  // Handle custom input change
  const handleCustomInputChange = useCallback(
    (value: string) => {
      setCustomInputs((prev) => {
        const newInputs = [...prev]
        newInputs[activeTab] = value
        return newInputs
      })
      writeCustomAnswer(value.trim())
    },
    [activeTab, writeCustomAnswer],
  )

  // Handle selecting custom option: expanding the input selects it
  const handleSelectCustom = useCallback(() => {
    setCustomEditing(true)
  }, [setCustomEditing])

  // Handle stopping custom input editing (Esc) — keeps the answer as it is
  const handleStopEditing = useCallback(() => {
    setCustomEditing(false)
  }, [setCustomEditing])

  // Handle confirming the custom answer (tick or Enter): commit the draft and advance
  const handleConfirmCustom = useCallback(() => {
    const value = currentCustomInput.trim()
    if (!value) {
      // Nothing typed yet — keep the editor open
      setCustomEditing(true)
      return
    }

    setCustomEditing(false)
    if (isMultiple && committedCustom === value) {
      // Multi-select: confirming the same custom answer again unchecks it
      writeCustomAnswer("")
      return
    }

    writeCustomAnswer(value)
    if (!isMultiple) {
      // Move to the next question (or the confirm tab)
      setTimeout(() => {
        setActiveTab((prev) => Math.min(prev + 1, questions.length))
      }, 150)
    }
  }, [currentCustomInput, committedCustom, isMultiple, questions.length, setCustomEditing, writeCustomAnswer])

  // Build tabs data
  const tabsData = questions.map((q, index) => ({
    header: q.header,
    answered: (answers[index]?.length ?? 0) > 0,
  }))

  // Navigation handlers
  const handlePrevious = () => {
    setActiveTab((prev) => Math.max(prev - 1, 0))
  }

  const handleNext = () => {
    setActiveTab((prev) => Math.min(prev + 1, questions.length))
  }

  return (
    <div className="border rounded-lg border-blue-300 dark:border-blue-700 overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
        <div className="text-xs font-medium text-blue-700 dark:text-blue-300">来自助手的问题</div>
      </div>

      {/* Tabs + confirm step */}
      <QuestionTabs tabs={tabsData} activeTab={activeTab} onTabChange={setActiveTab} showConfirm />

      {/* Content */}
      {isConfirmTab ? (
        <ConfirmTab
          questions={questions}
          answers={answers}
          onSubmit={handleSubmit}
          onDismiss={handleDismiss}
          isLoading={isLoading}
        />
      ) : (
        currentQuestion && (
          <QuestionOptions
            question={currentQuestion}
            answers={currentAnswers}
            customInput={currentCustomInput}
            onToggleOption={handleToggleOption}
            onCustomInputChange={handleCustomInputChange}
            isCustomSelected={isCustomSelected}
            onSelectCustom={handleSelectCustom}
            onConfirmCustom={handleConfirmCustom}
            isEditing={isEditingCustom}
            onStopEditing={handleStopEditing}
          />
        )
      )}

      {/* Footer with navigation */}
      <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between">
        <div className="flex gap-2">
          {activeTab > 0 && (
            <button
              onClick={handlePrevious}
              className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              ← 上一步
            </button>
          )}
          {!isConfirmTab && (
            <button
              onClick={handleNext}
              className="px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              下一步 →
            </button>
          )}
        </div>

        <div className="flex gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>{isConfirmTab ? "复核" : `${activeTab + 1}/${questions.length}`}</span>
          <span>•</span>
          <button
            onClick={handleDismiss}
            disabled={isLoading}
            className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            忽略
          </button>
        </div>
      </div>
    </div>
  )
}
