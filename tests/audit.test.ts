import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AuditEntry, AuditLog, redact } from "../src/audit.js";
import { connect, makeRoot } from "./helpers.js";

describe("audit log", () => {
  it("records every tool call with duration and error flag", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "audit-")), "calls.jsonl");
    const { call } = await connect({ root: makeRoot(), enableFetch: false, auditLogPath: path });
    await call("sqlite_query", { database: "shop.db", sql: "SELECT 1 AS one" });
    await call("sqlite_query", { database: "shop.db", sql: "DELETE FROM customers" });
    await call("text_diff", { before: "x".repeat(500), after: "y" });

    const entries = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as AuditEntry);
    expect(entries.map((e) => [e.tool, e.isError])).toEqual([
      ["sqlite_query", false],
      ["sqlite_query", true],
      ["text_diff", false],
    ]);
    expect(entries[0]?.args).toMatchObject({ sql: "SELECT 1 AS one" });
    expect(String(entries[2]?.args.before)).toMatch(/…\(500 chars\)$/);
    expect(entries.every((e) => e.durationMs >= 0 && !Number.isNaN(Date.parse(e.ts)))).toBe(true);
  });

  it("writes timestamps from the injected clock and redacts safely", () => {
    const path = join(mkdtempSync(join(tmpdir(), "audit-")), "a.jsonl");
    new AuditLog(path, () => new Date("2026-01-01T00:00:00Z")).record({
      tool: "t",
      args: {},
      durationMs: 1,
      isError: false,
    });
    expect(readFileSync(path, "utf8")).toContain('"ts":"2026-01-01T00:00:00.000Z"');
    expect(redact(undefined)).toEqual({});
    expect(redact({ n: 3, list: [1, 2] })).toEqual({ n: 3, list: [1, 2] });
  });
});
