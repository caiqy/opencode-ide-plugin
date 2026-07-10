import { describe, expect, it } from "vitest"
import { contentFromPatch } from "./utils"

describe("contentFromPatch", () => {
  it("derives before and after content from a modified unified hunk", () => {
    expect(contentFromPatch("--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,2 @@\n same\n-old\n+new\n")).toEqual({
      before: "same\nold",
      after: "same\nnew",
    })
  })

  it("derives added and deleted files from a complete hunk", () => {
    expect(contentFromPatch("@@ -0,0 +1 @@\n+new\n")).toEqual({ before: "", after: "new" })
    expect(contentFromPatch("@@ -1 +0,0 @@\n-old\n")).toEqual({ before: "old", after: "" })
  })

  it("preserves content that begins with double minus or plus", () => {
    expect(contentFromPatch("@@ -1 +1 @@\n---flag\n+++value\n")).toEqual({ before: "--flag", after: "++value" })
  })

  it("preserves empty context lines", () => {
    expect(contentFromPatch("@@ -1,2 +1,2 @@\n \n-old\n+new\n")).toEqual({ before: "\nold", after: "\nnew" })
  })

  it("derives empty content additions and deletions", () => {
    expect(contentFromPatch("@@ -1 +1 @@\n-\n+\n")).toEqual({ before: "", after: "" })
  })

  it.each([
    [undefined],
    ["--- a/empty\n+++ b/empty\n"],
    ["@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n"],
    ["Binary files a/image.png and b/image.png differ\n"],
    ["similarity index 100%\nrename from old.ts\nrename to new.ts\n"],
    ["not a patch\n"],
    ["---not-a-header\n+++still-not-a-header\n@@ -1 +1 @@\n-old\n+new\n"],
    ["diff --git a/file.ts b/file.ts\n@@ -1 +1 @@\n-old\n+new\n"],
    ["--- a/file.ts\n+++ b/file.ts\nindex invalid\n@@ -1 +1 @@\n-old\n+new\n"],
    ["@@ -0,0 +0,0 @@\n"],
    ["@@ -1 +1 @@\n same\n"],
    ["@@ -1,2 +1 @@\n-old\n+new\n"],
    ["@@ -1 +1 @@\n-old\n+new\n@@ -4 +4 @@\n-old2\n+new2\n"],
  ])("returns null for an unreliable patch", (patch) => {
    expect(contentFromPatch(patch)).toBeNull()
  })
})
