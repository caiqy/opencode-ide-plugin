import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { AppRuntime } from "../../src/effect/app-runtime"
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
        const app = Server.createApp({})
        const session = await AppRuntime.runPromise(Session.Service.use((session) => session.create({ title: "旧标题" })))
        const response = await app.request(
          `/session/${session.id}/title/regenerate?directory=${encodeURIComponent(tmp.path)}`,
          {
            method: "POST",
          },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          id: session.id,
          title: "旧标题",
        })
      },
    })
  })
})
