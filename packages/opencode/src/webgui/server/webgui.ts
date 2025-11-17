import { Hono } from "hono"
import { validator } from "hono-openapi"
import { z } from "zod"
import * as State from "@/webgui/state/state.ts"
import { StateSchema } from "@/webgui/state/state.ts"

const StatePatchSchema = StateSchema.partial()

// not exposed to Stainless API
export const WebGuiRoute = new Hono()
  .get(
    "/state",
    /*describeRoute({
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
                    agent_model: z.record(
                      z.string(),
                      z.object({
                        provider_id: z.string(),
                        model_id: z.string(),
                      }),
                    ).optional(),
                    provider: z.string().optional(),
                    model: z.string().optional(),
                    agent: z.string().optional(),
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
    }),*/
    async (c) => {
      const state = await State.read()
      return c.json(state)
    },
  )
  .patch(
    "/state",
    /*describeRoute({
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
                    agent_model: z.record(
                      z.string(),
                      z.object({
                        provider_id: z.string(),
                        model_id: z.string(),
                      }),
                    ).optional(),
                    provider: z.string().optional(),
                    model: z.string().optional(),
                    agent: z.string().optional(),
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
    }),*/
    validator("json", StatePatchSchema),
    async (c) => {
      const partial = c.req.valid("json")
      await State.write(partial)
      const updated = await State.read()
      return c.json(updated)
    },
  )
