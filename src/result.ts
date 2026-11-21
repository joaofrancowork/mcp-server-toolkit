import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Errors are returned to the model as tool results, not thrown, so it can recover. */
export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function ok(text: string, structured?: Record<string, unknown>): CallToolResult {
  return structured
    ? { content: [{ type: "text", text }], structuredContent: structured }
    : { content: [{ type: "text", text }] };
}

/** Run a tool body and turn expected failures into readable error results. */
export async function guard(fn: () => Promise<CallToolResult> | CallToolResult) {
  try {
    return await fn();
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export function truncate(text: string, max = 20_000): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}
