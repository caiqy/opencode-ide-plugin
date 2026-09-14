import { useCallback, useEffect, useRef, useState } from "react"
import { $createParagraphNode, $getRoot, type EditorState, type LexicalEditor } from "lexical"
import type { DraftPart } from "../../../state/repo/draftRepo"
import type { InputDelivery, QueuedSubmission } from "../../../lib/api/inputQueue"
import { resolveSlashInput } from "./resolveSlashInput"

export function useQueuedSubmission(options: {
  sessionID: string | null
  editor: LexicalEditor
  extractMessageParts: (state: EditorState) => DraftPart[]
  selectedAgent: string
  selectedProviderId?: string
  selectedModelId?: string
  selectedVariant?: string
  add: (input: QueuedSubmission) => Promise<boolean>
  onMessageSent?: () => void
}) {
  const [form, setForm] = useState<{
    sessionID: string
    state: EditorState
    input: QueuedSubmission
    text: string
  } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(options.sessionID)
  active.current = options.sessionID
  const request = useRef<QueuedSubmission | null>(null)
  const locked = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setForm(null)
    setPending(false)
    setError(null)
    request.current = null
    locked.current = false
  }, [options.sessionID])

  const open = useCallback(() => {
    if (!options.sessionID || locked.current || form) return
    const state = options.editor.getEditorState()
    const parts = options.extractMessageParts(state)
    if (!parts.some((part) => part.type !== "text" || part.text.trim())) return
    const text = state.read(() => $getRoot().getTextContent())
    setError(null)
    const input: QueuedSubmission = {
      id: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
      delivery: "steer",
      prompt: {
        parts,
        agent: options.selectedAgent,
        model:
          options.selectedProviderId && options.selectedModelId
            ? { providerID: options.selectedProviderId, modelID: options.selectedModelId }
            : undefined,
        variant: options.selectedVariant,
      },
    }
    if (request.current && JSON.stringify(request.current.prompt) !== JSON.stringify(input.prompt))
      request.current = null
    setForm({ sessionID: options.sessionID, state, text, input: request.current ?? input })
  }, [form, options])

  const close = useCallback(() => {
    if (locked.current) return
    setForm(null)
    setError(null)
    options.editor.focus()
  }, [options.editor])

  const select = useCallback(
    async (delivery: InputDelivery) => {
      if (!form || locked.current || form.sessionID !== active.current) return
      if (request.current && request.current.delivery !== delivery) {
        setError("上次提交结果尚未确认，请使用原发送方式重试；成功后可在列表中转换。")
        return
      }
      const token = generation.current
      locked.current = true
      setPending(true)
      setError(null)
      try {
        if (!request.current) {
          const slash = await resolveSlashInput(form.text.trim())
          if (token !== generation.current || active.current !== form.sessionID) return
          request.current = {
            ...form.input,
            delivery,
            ...(slash.mode === "command"
              ? {
                  command: {
                    command: slash.name,
                    arguments: slash.arguments,
                    agent: form.input.prompt.agent,
                    model: form.input.prompt.model
                      ? `${form.input.prompt.model.providerID}/${form.input.prompt.model.modelID}`
                      : undefined,
                    variant: form.input.prompt.variant,
                  },
                }
              : {}),
          }
        }
        if (token !== generation.current || active.current !== form.sessionID) return
        const accepted = await options.add(request.current)
        if (token !== generation.current || active.current !== form.sessionID) return
        if (!accepted) {
          setError("提交未确认，草稿已保留。请重试原发送方式。")
          return
        }
        // A late acknowledgement must not erase a newer draft or another session's editor.
        if (JSON.stringify(options.editor.getEditorState().toJSON()) === JSON.stringify(form.state.toJSON())) {
          options.editor.update(() => {
            $getRoot().clear().append($createParagraphNode())
          })
        }
        setForm(null)
        request.current = null
        options.onMessageSent?.()
        options.editor.focus()
      } catch (error) {
        if (token === generation.current) setError(error instanceof Error ? error.message : "提交失败，草稿已保留")
      } finally {
        if (token === generation.current) {
          locked.current = false
          setPending(false)
        }
      }
    },
    [form, options],
  )

  return { isOpen: form?.sessionID === options.sessionID && !!form, pending, error, open, close, select }
}
