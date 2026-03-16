import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const McpRoutes = lazy(() =>
  new Hono()
    .get(
      "/:name/tools",
      describeRoute({
        summary: "Get MCP tools by server",
        description: "List tools exposed by an MCP server and whether each tool is enabled.",
        operationId: "mcp.tools",
        responses: {
          200: {
            description: "MCP tools",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    server: z.string(),
                    connected: z.boolean(),
                    tools: z.array(
                      z.object({
                        id: z.string(),
                        name: z.string(),
                        enabled: z.boolean(),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        const result = await MCP.toolsByServer(name)
        if (!result.connected) {
          return c.json({
            server: name,
            connected: false,
            tools: [],
          })
        }
        const config = await Config.get()
        return c.json({
          server: name,
          connected: true,
          tools: result.tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            enabled: config.tools?.[tool.id] !== false,
          })),
        })
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "Get MCP status",
        description: "Get the status of all Model Context Protocol (MCP) servers.",
        operationId: "mcp.status",
        responses: {
          200: {
            description: "MCP server status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.status())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Add MCP server",
        description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
        operationId: "mcp.add",
        responses: {
          200: {
            description: "MCP server added successfully",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          config: Config.Mcp,
        }),
      ),
      async (c) => {
        const { name, config } = c.req.valid("json")
        const result = await MCP.add(name, config)
        return c.json(result.status)
      },
    )
    .post(
      "/:name/auth",
      describeRoute({
        summary: "Start MCP OAuth",
        description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
        operationId: "mcp.auth.start",
        responses: {
          200: {
            description: "OAuth flow started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    authorizationUrl: z.string().describe("URL to open in browser for authorization"),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const supportsOAuth = await MCP.supportsOAuth(name)
        if (!supportsOAuth) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        const result = await MCP.startAuth(name)
        return c.json(result)
      },
    )
    .post(
      "/:name/auth/callback",
      describeRoute({
        summary: "Complete MCP OAuth",
        description:
          "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
        operationId: "mcp.auth.callback",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          code: z.string().describe("Authorization code from OAuth callback"),
        }),
      ),
      async (c) => {
        const name = c.req.param("name")
        const { code } = c.req.valid("json")
        const status = await MCP.finishAuth(name, code)
        return c.json(status)
      },
    )
    .post(
      "/:name/auth/authenticate",
      describeRoute({
        summary: "Authenticate MCP OAuth",
        description: "Start OAuth flow and wait for callback (opens browser)",
        operationId: "mcp.auth.authenticate",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const supportsOAuth = await MCP.supportsOAuth(name)
        if (!supportsOAuth) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        const status = await MCP.authenticate(name)
        return c.json(status)
      },
    )
    .delete(
      "/:name/auth",
      describeRoute({
        summary: "Remove MCP OAuth",
        description: "Remove OAuth credentials for an MCP server",
        operationId: "mcp.auth.remove",
        responses: {
          200: {
            description: "OAuth credentials removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        await MCP.removeAuth(name)
        return c.json({ success: true as const })
      },
    )
    .post(
      "/:name/connect",
      describeRoute({
        description: "Connect an MCP server",
        operationId: "mcp.connect",
        responses: {
          200: {
            description: "MCP server connected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        await MCP.connect(name)
        return c.json(true)
      },
    )
    .post(
      "/:name/disconnect",
      describeRoute({
        description: "Disconnect an MCP server",
        operationId: "mcp.disconnect",
        responses: {
          200: {
            description: "MCP server disconnected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) => {
        const { name } = c.req.valid("param")
        await MCP.disconnect(name)
        return c.json(true)
      },
    )
    .patch(
      "/:name/enabled",
      describeRoute({
        description: "Set MCP server enabled state with persistence",
        operationId: "mcp.setEnabled",
        responses: {
          200: {
            description: "MCP server enabled state updated",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string() })),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const { name } = c.req.valid("param")
        const { enabled } = c.req.valid("json")
        // Guard: verify server exists in config before acting
        const mcpStatus = await MCP.status()
        if (!(name in mcpStatus)) {
          return c.json({ error: `MCP server not found: ${name}` }, 404)
        }
        await MCP.setEnabled(name, enabled)
        return c.json(true)
      },
    )
    .patch(
      "/:name/tools/:toolId",
      describeRoute({
        description: "Set a single MCP tool enabled state with persistence",
        operationId: "mcp.setToolEnabled",
        responses: {
          200: {
            description: "MCP tool enabled state updated",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ name: z.string(), toolId: z.string() })),
      validator("json", z.object({ enabled: z.boolean() })),
      async (c) => {
        const { name, toolId } = c.req.valid("param")
        const { enabled } = c.req.valid("json")
        // Guard: verify the toolId belongs to the named server.
        // MCP.toolsByServer already exists at packages/opencode/src/mcp/index.ts
        const serverTools = await MCP.toolsByServer(name)
        if (!serverTools.connected) {
          return c.json({ error: `MCP server not connected: ${name}` }, 404)
        }
        const toolExists = serverTools.tools.some((t) => t.id === toolId)
        if (!toolExists) {
          return c.json({ error: `Tool ${toolId} not found on server ${name}` }, 404)
        }
        await MCP.setToolEnabled(toolId, enabled)
        return c.json(true)
      },
    ),
)
