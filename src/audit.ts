/**
 * Append-only audit log: one JSON line per tool call.
 *
 * When an agent misbehaves, the question is always "what did it actually call, with
 * what, and what came back?". Large argument values are truncated so the log stays
 * useful without copying whole documents.
 */
import { appendFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export const MAX_VALUE_CHARS = 200;

export interface AuditEntry {
  ts: string;
  tool: string;
  args: Record<string, unknown>;
  durationMs: number;
  isError: boolean;
}

export function redact(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([key, value]) => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return [
        key,
        text && text.length > MAX_VALUE_CHARS
          ? `${text.slice(0, MAX_VALUE_CHARS)}…(${text.length} chars)`
          : value,
      ];
    }),
  );
}

export class AuditLog {
  constructor(
    private readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  record(entry: Omit<AuditEntry, "ts">): void {
    appendFileSync(this.path, `${JSON.stringify({ ts: this.now().toISOString(), ...entry })}\n`);
  }
}

type ToolCallback = (args: unknown, extra: unknown) => Promise<CallToolResult> | CallToolResult;

/** Wrap every tool registered from now on so its calls are written to the log. */
export function auditTools(server: McpServer, log: AuditLog): void {
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: unknown,
    cb: ToolCallback,
  ) => unknown;
  const wrapped = (name: string, config: unknown, cb: ToolCallback) =>
    register(name, config, async (args: unknown, extra: unknown) => {
      const started = performance.now();
      let result: CallToolResult | undefined;
      try {
        result = await cb(args, extra);
        return result;
      } finally {
        log.record({
          tool: name,
          args: redact(args),
          durationMs: Math.round(performance.now() - started),
          isError: result?.isError === true || result === undefined,
        });
      }
    });
  server.registerTool = wrapped as unknown as McpServer["registerTool"];
}
