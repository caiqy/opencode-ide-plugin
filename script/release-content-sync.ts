#!/usr/bin/env bun

import { syncReleaseContent } from "./release-content"

const check = Bun.argv.includes("--check")

await syncReleaseContent(process.cwd(), { check })
