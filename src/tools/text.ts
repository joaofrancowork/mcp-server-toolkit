/** JSON querying (JMESPath) and text diffs: small, pure tools agents use constantly. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTwoFilesPatch, diffWords } from "diff";
import jmespath from "jmespath";
import { z } from "zod";
import { fail, guard, ok, truncate } from "../result.js";

const MAX_INPUT = 1_000_000;

export function jsonQuery(json: string, expression: string): unknown {
  const data: unknown = JSON.parse(json);
  return jmespath.search(data, expression);
}

export function unifiedDiff(before: string, after: string, context = 3): string {
  return createTwoFilesPatch("before", "after", before, after, "", "", { context });
}

export function changeStats(before: string, after: string) {
  let added = 0;
  let removed = 0;
  for (const part of diffWords(before, after)) {
    const words = part.value.split(/\s+/).filter(Boolean).length;
    if (part.added) added += words;
    else if (part.removed) removed += words;
  }
  return { wordsAdded: added, wordsRemoved: removed, identical: before === after };
}

export function registerTextTools(server: McpServer): void {
  server.registerTool(
    "json_query",
    {
      title: "Query JSON with JMESPath",
      description:
        "Extract or reshape data from a JSON document with a JMESPath expression, e.g. `items[?price > `10`].name`.",
      inputSchema: {
        json: z.string().max(MAX_INPUT),
        expression: z.string().min(1).max(2_000),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ json, expression }) =>
      guard(() => {
        let result: unknown;
        try {
          result = jsonQuery(json, expression);
        } catch (error) {
          const kind =
            error instanceof SyntaxError ? "Invalid JSON" : "Invalid JMESPath expression";
          return fail(`${kind}: ${(error as Error).message}`);
        }
        return ok(truncate(JSON.stringify(result, null, 2) ?? "null"), { result });
      }),
  );

  server.registerTool(
    "text_diff",
    {
      title: "Diff two texts",
      description: "Unified diff between two texts plus word-level change counts.",
      inputSchema: {
        before: z.string().max(MAX_INPUT),
        after: z.string().max(MAX_INPUT),
        context: z.number().int().min(0).max(20).default(3),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ before, after, context }) =>
      guard(() => {
        const stats = changeStats(before, after);
        if (stats.identical) return ok("The texts are identical.", stats);
        return ok(truncate(unifiedDiff(before, after, context)), stats);
      }),
  );
}
