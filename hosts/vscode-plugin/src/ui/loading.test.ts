import assert from "node:assert/strict"
import test from "node:test"
import { loading } from "./loading"

test("loading 会返回不含 iframe 的静态壳页面", () => {
  const html = loading("OpenCode", "正在重启插件…")

  assert.match(html, /OpenCode/)
  assert.match(html, /正在重启插件/)
  assert.ok(!html.includes("<iframe"))
})
