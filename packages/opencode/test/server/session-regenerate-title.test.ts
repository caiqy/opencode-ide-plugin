import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(() => {
  mock.restore()
  return resetDatabase()
})

describe("session regenerate title route", () => {
  test("POST /session/:sessionID/title/regenerate 调用标题重生成逻辑并返回更新后的会话", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "旧标题" })
        const regenerate = spyOn(SessionPrompt, "regenerateTitle").mockImplementation(async ({ sessionID }) => {
          await Session.setTitle({ sessionID, title: "新标题" })
          return Session.get(sessionID)
        })

        const app = Server.createApp({})
        const response = await app.request(`/session/${session.id}/title/regenerate`, {
          method: "POST",
        })

        expect(response.status).toBe(200)
        expect(regenerate).toHaveBeenCalledWith({ sessionID: session.id })
        expect(await response.json()).toMatchObject({
          id: session.id,
          title: "新标题",
        })
      },
    })
  })
})
