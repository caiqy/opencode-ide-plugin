import { Storage } from "@/storage/storage.ts"
import { Hono } from "hono"
import { validator, describeRoute, resolver } from "hono-openapi"
import { stream } from "hono/streaming"
import { z } from "zod"
import * as State from "@/webgui/state/state.ts"
import { StateSchema } from "@/webgui/state/state.ts"
import { ModelsDev } from "../../provider/models"
import { Auth } from "../../auth"
import { Instance } from "../../project/instance"
import { mapValues } from "remeda"
import { Provider } from "@/provider/provider.ts"
import { SessionPrompt } from "../../session/prompt"
import { MessageV2 } from "../../session/message-v2"

const StatePatchSchema = StateSchema.partial()

type AuthSession = {
  status: "pending" | "success" | "failed"
  result?: any
  callback?: (code: string) => Promise<any>
}

const pendingAuths = new Map<string, AuthSession>()

const ERRORS = {
  400: {
    description: "Bad request",
    content: {
      "application/json": {
        schema: resolver(
          z
            .object({
              data: z.any(),
              errors: z.array(z.record(z.string(), z.any())),
              success: z.literal(false),
            })
            .meta({
              ref: "BadRequestError",
            }),
        ),
      },
    },
  },
  404: {
    description: "Not found",
    content: {
      "application/json": {
        schema: resolver(Storage.NotFoundError.Schema),
      },
    },
  },
} as const

function errors(...codes: number[]) {
  return Object.fromEntries(codes.map((code) => [code, ERRORS[code as keyof typeof ERRORS]]))
}

// not exposed to Stainless API
export const WebGuiRoute = new Hono()
  .get(
    "/auth/methods",
    describeRoute({
      description: "Get auth methods for a provider",
      operationId: "auth.methods",
      responses: {
        200: {
          description: "Auth methods",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    label: z.string(),
                    type: z.enum(["oauth", "api"]),
                    prompts: z.array(z.any()).optional(),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    validator("query", z.object({ provider: z.string() })),
    async (c) => {
      const { provider } = c.req.valid("query")
      const plugin = await import("../../plugin").then((m) =>
        m.Plugin.list().then((x) => x.find((p) => p.auth?.provider === provider)),
      )
      if (!plugin || !plugin.auth) return c.json([])
      return c.json(
        plugin.auth.methods.map((m) => ({
          label: m.label,
          type: m.type,
          prompts: m.prompts,
        })),
      )
    },
  )
  .get(
    "/auth/list",
    describeRoute({
      description: "List configured auth providers",
      operationId: "auth.list",
      responses: {
        200: {
          description: "List of configured auth providers",
          content: {
            "application/json": {
              schema: resolver(z.record(z.string(), Auth.Info)),
            },
          },
        },
      },
    }),
    async (c) => {
      const auths = await Auth.all()
      return c.json(auths)
    },
  )
  .post(
    "/auth/set",
    describeRoute({
      description: "Set auth provider",
      operationId: "auth.set",
      responses: {
        200: {
          description: "Set successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("json", z.object({ provider: z.string(), value: z.any() })),
    async (c) => {
      const { provider, value } = c.req.valid("json")
      await Auth.set(provider, value)
      await Instance.disposeAll()
      return c.json(true)
    },
  )
  .post(
    "/auth/remove",
    describeRoute({
      description: "Remove an auth provider",
      operationId: "auth.remove",
      responses: {
        200: {
          description: "Removed successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
      },
    }),
    validator("json", z.object({ provider: z.string() })),
    async (c) => {
      const { provider } = c.req.valid("json")
      await Auth.remove(provider)
      await Instance.disposeAll()
      return c.json(true)
    },
  )
  .post(
    "/auth/login/start",
    describeRoute({
      description: "Start auth flow",
      operationId: "auth.login.start",
      responses: {
        200: {
          description: "Auth started",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  id: z.string(),
                  url: z.string().optional(),
                  method: z.enum(["auto", "code"]),
                  instructions: z.string().optional(),
                }),
              ),
            },
          },
        },
      },
    }),
    validator(
      "json",
      z.object({
        provider: z.string(),
        methodIndex: z.number(),
        inputs: z.record(z.string(), z.string()),
      }),
    ),
    async (c) => {
      const { provider, methodIndex, inputs } = c.req.valid("json")
      const plugin = await import("../../plugin").then((m) =>
        m.Plugin.list().then((x) => x.find((p) => p.auth?.provider === provider)),
      )
      if (!plugin || !plugin.auth) throw new Error("Provider not found")

      const method = plugin.auth.methods[methodIndex]
      if (!method) throw new Error("Method not found")

      if (method.type === "oauth") {
        const authorize = await method.authorize(inputs)
        const id = crypto.randomUUID()

        if (authorize.method === "auto") {
          // Start background polling/waiting
          pendingAuths.set(id, { status: "pending" })
          authorize
            .callback()
            .then(async (result) => {
              if (result.type === "success") {
                // Save credentials immediately like CLI does
                const saveProvider = result.provider ?? provider
                if ("refresh" in result) {
                  const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
                  await Auth.set(saveProvider, {
                    type: "oauth",
                    refresh,
                    access,
                    expires,
                    ...extraFields,
                  })
                }
                if ("key" in result) {
                  await Auth.set(saveProvider, {
                    type: "api",
                    key: result.key,
                  })
                }
                await Instance.disposeAll()
                pendingAuths.set(id, { status: "success", result })
              } else {
                pendingAuths.set(id, { status: "failed", result })
              }
            })
            .catch((err) => {
              pendingAuths.set(id, { status: "failed", result: err })
            })

          return c.json({ id, url: authorize.url, method: "auto" as const, instructions: authorize.instructions })
        }

        if ((authorize as any).method === "code") {
          pendingAuths.set(id, {
            status: "pending",
            callback: authorize.callback,
          })
          return c.json({ id, url: authorize.url, method: "code" as const, instructions: authorize.instructions })
        }

        throw new Error("Unsupported oauth method: " + authorize.method)
      }

      throw new Error("Only oauth supported for now via this endpoint")
    },
  )
  .post(
    "/auth/login/submit",
    describeRoute({
      description: "Submit auth code",
      operationId: "auth.login.submit",
      responses: {
        200: {
          description: "Code submitted",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        id: z.string(),
        code: z.string(),
      }),
    ),
    async (c) => {
      const { id, code } = c.req.valid("json")
      const session = pendingAuths.get(id)
      if (!session) return c.json({ success: false, data: null, errors: [{ message: "Session not found" }] }, 404)
      if (!session.callback)
        return c.json({ success: false, data: null, errors: [{ message: "Session does not expect code" }] }, 400)

      try {
        const result = await session.callback(code)
        if (result.type === "success") {
          const saveProvider = result.provider
          if ("refresh" in result) {
            const { type: _, provider: __, refresh, access, expires, ...extraFields } = result
            await Auth.set(saveProvider, {
              type: "oauth",
              refresh,
              access,
              expires,
              ...extraFields,
            })
          }
          if ("key" in result) {
            await Auth.set(saveProvider, {
              type: "api",
              key: result.key,
            })
          }
          await Instance.disposeAll()
          session.status = "success"
          session.result = result
        } else {
          session.status = "failed"
          session.result = result
        }
      } catch (err) {
        session.status = "failed"
        session.result = err
      }

      return c.json(true)
    },
  )
  .get(
    "/auth/login/status/:id",
    describeRoute({
      description: "Get auth login status",
      operationId: "auth.login.status",
      responses: {
        200: {
          description: "Auth status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  status: z.enum(["pending", "success", "failed"]),
                  result: z.any().optional(),
                }),
              ),
            },
          },
        },
        ...errors(404),
      },
    }),
    async (c) => {
      const id = c.req.param("id")
      const session = pendingAuths.get(id)
      if (!session) return c.json({ success: false, data: null, errors: [{ message: "Session not found" }] }, 404)
      return c.json({ status: session.status, result: session.result })
    },
  )
  .get(
    "/config/providers",
    describeRoute({
      description: "List all providers",
      operationId: "config.providers",
      responses: {
        200: {
          description: "List of providers",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  providers: ModelsDev.Provider.array(),
                  default: z.record(z.string(), z.string()),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      // Get providers directly from updated cache after refresh
      const database = await ModelsDev.get()
      const activeProviders = await Provider.list()

      // Merge active providers into the full list from database
      // This ensures we have all available providers, but with updated info for active ones
      const allProviders = { ...database, ...activeProviders }

      return c.json({
        providers: Object.values(allProviders),
        default: mapValues(activeProviders, (item) => Provider.sort(Object.values(item.models))[0]?.id ?? ""),
      })
    },
  )
  .get(
    "/state",
    describeRoute({
      description: "Get TUI state (theme, model, agent preferences)",
      operationId: "state.get",
      responses: {
        200: {
          description: "TUI state",
          content: {
            "application/json": {
              schema: resolver(
                z
                  .object({
                    theme: z.string().optional(),
                    agent_model: z
                      .record(
                        z.string(),
                        z.object({
                          provider_id: z.string(),
                          model_id: z.string(),
                        }),
                      )
                      .optional(),
                    provider: z.string().optional(),
                    model: z.string().optional(),
                    agent: z.string().optional(),
                    variant: z.record(z.string(), z.string()).optional(),
                    recently_used_models: z
                      .array(
                        z.object({
                          provider_id: z.string(),
                          model_id: z.string(),
                          last_used: z.string(),
                        }),
                      )
                      .optional(),
                    recently_used_agents: z
                      .array(
                        z.object({
                          agent_name: z.string(),
                          last_used: z.string(),
                        }),
                      )
                      .optional(),
                    show_tool_details: z.boolean().optional(),
                    show_thinking_blocks: z.boolean().optional(),
                  })
                  .meta({ ref: "State" }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const state = await State.read()
      return c.json(state)
    },
  )
  .patch(
    "/state",
    describeRoute({
      description: "Update TUI state (merge with existing)",
      operationId: "state.update",
      responses: {
        200: {
          description: "Successfully updated state",
          content: {
            "application/json": {
              schema: resolver(
                z
                  .object({
                    theme: z.string().optional(),
                    agent_model: z
                      .record(
                        z.string(),
                        z.object({
                          provider_id: z.string(),
                          model_id: z.string(),
                        }),
                      )
                      .optional(),
                    provider: z.string().optional(),
                    model: z.string().optional(),
                    agent: z.string().optional(),
                    variant: z.record(z.string(), z.string()).optional(),
                    recently_used_models: z
                      .array(
                        z.object({
                          provider_id: z.string(),
                          model_id: z.string(),
                          last_used: z.string(),
                        }),
                      )
                      .optional(),
                    recently_used_agents: z
                      .array(
                        z.object({
                          agent_name: z.string(),
                          last_used: z.string(),
                        }),
                      )
                      .optional(),
                    show_tool_details: z.boolean().optional(),
                    show_thinking_blocks: z.boolean().optional(),
                  })
                  .meta({ ref: "State" }),
              ),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", StatePatchSchema),
    async (c) => {
      const partial = c.req.valid("json")
      await State.write(partial)
      const updated = await State.read()
      return c.json(updated)
    },
  )
  .post(
    "/session/:sessionID/retry",
    describeRoute({
      summary: "Retry session",
      description: "Retry the assistant loop for a session without sending a new message.",
      operationId: "session.retry",
      responses: {
        200: {
          description: "Assistant response",
          content: {
            "application/json": {
              schema: resolver(MessageV2.WithParts),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string().meta({ description: "Session ID" }),
      }),
    ),
    async (c) => {
      const { sessionID } = c.req.valid("param")
      try {
        c.status(200)
        c.header("Content-Type", "application/json")
        return stream(c, async (stream) => {
          try {
            const msg = await SessionPrompt.loop({ sessionID })
            stream.write(JSON.stringify(msg))
          } catch (e) {
            console.error(`[WebGui] Error in retry loop for session ${sessionID}:`, e)
            // Error during stream - though we didn't write anything yet
            stream.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          }
        })
      } catch (e) {
        console.error(`[WebGui] Failed to initiate retry stream for session ${sessionID}:`, e)
        return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
      }
    },
  )
