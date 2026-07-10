import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import { createEditor } from "lexical"
import { AttachmentNode } from "../../attachment/AttachmentNode"
import { MentionNode } from "../../mention/MentionNode"
import { restoreDraftImpl } from "../utils"
import { useMessageParts } from "./useMessageParts"

describe("useMessageParts", () => {
  it("round-trips source-less agents and resource sources without duplicating editor tokens", async () => {
    const editor = createEditor({
      nodes: [AttachmentNode, MentionNode],
      onError(error) {
        throw error
      },
    })
    restoreDraftImpl(editor, {
      parts: [
        { type: "text", text: "first@exploresecond" },
        { type: "agent", name: "explore" },
        {
          type: "file",
          mime: "text/plain",
          filename: "resource.txt",
          url: "resource://server/item",
          source: {
            type: "resource",
            clientName: "server",
            uri: "resource://server/item",
            text: { value: "resource://server/item", start: 0, end: 14 },
          },
        },
      ],
      agent: "build",
      model: undefined,
    })
    await Promise.resolve()

    const { result } = renderHook(() => useMessageParts({ editor, resolveToAbsolutePath: (path) => path ?? "" }))

    expect(result.current.extractMessageParts()).toEqual([
      { type: "text", text: "first@exploresecond[resource.txt]" },
      { type: "agent", name: "explore" },
      {
        type: "file",
        mime: "text/plain",
        filename: "resource.txt",
        url: "resource://server/item",
        source: {
          type: "resource",
          clientName: "server",
          uri: "resource://server/item",
          text: { value: "resource://server/item", start: 19, end: 33 },
        },
      },
    ])
  })

  it("round-trips attachment-before-mention producer parts by editor offset", async () => {
    const editor = createEditor({
      nodes: [AttachmentNode, MentionNode],
      onError(error) {
        throw error
      },
    })
    restoreDraftImpl(editor, {
      parts: [
        { type: "text", text: "[resource.txt] @file" },
        {
          type: "file",
          mime: "text/plain",
          filename: "resource.txt",
          url: "resource://server/item",
          source: {
            type: "resource",
            clientName: "server",
            uri: "resource://server/item",
            text: { value: "resource://server/item", start: 0, end: 14 },
          },
        },
        {
          type: "file",
          mime: "text/plain",
          filename: "file",
          url: "file:///file",
          source: { type: "file", path: "file", text: { value: "@file", start: 15, end: 20 } },
        },
      ],
      agent: "build",
      model: undefined,
    })
    await Promise.resolve()

    const { result } = renderHook(() => useMessageParts({ editor, resolveToAbsolutePath: (path) => path ?? "" }))

    expect(result.current.extractMessageParts()).toEqual([
      { type: "text", text: "[resource.txt] @file" },
      {
        type: "file",
        mime: "text/plain",
        filename: "file",
        url: "file:///file",
        source: { type: "file", path: "file", text: { value: "@file", start: 15, end: 20 } },
      },
      {
        type: "file",
        mime: "text/plain",
        filename: "resource.txt",
        url: "resource://server/item",
        source: {
          type: "resource",
          clientName: "server",
          uri: "resource://server/item",
          text: { value: "resource://server/item", start: 0, end: 14 },
        },
      },
    ])
  })
})
