import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const EnabledPayload = Schema.Struct({
  enabled: Schema.Boolean,
})

export const McpGroup = HttpApiGroup.make("server.mcp")
  .add(
    HttpApiEndpoint.patch("mcp.enabled", "/mcp/:name/enabled", {
      params: { name: Schema.String },
      query: LocationQuery,
      payload: EnabledPayload,
      success: Schema.Boolean,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "mcp.enabled",
          summary: "Update MCP enabled state",
          description: "Enable or disable a Model Context Protocol (MCP) server.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.patch("mcp.tool.enabled", "/mcp/:name/tools/:toolId", {
      params: { name: Schema.String, toolId: Schema.String },
      query: LocationQuery,
      payload: EnabledPayload,
      success: Schema.Boolean,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "mcp.tool.enabled",
          summary: "Update MCP tool enabled state",
          description: "Enable or disable an MCP tool by tool id.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "mcp",
      description: "Experimental MCP routes.",
    }),
  )
