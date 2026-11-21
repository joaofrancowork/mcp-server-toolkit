/**
 * Read-only SQL over SQLite files in the sandbox.
 *
 * Two independent layers: the database is opened read-only by SQLite itself, and
 * the statement must be a single SELECT / WITH / EXPLAIN / PRAGMA table_info.
 * Either layer alone would stop a write; together they also stop an agent from
 * attaching other files or changing connection settings.
 */
import { DatabaseSync } from "node:sqlite";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { guard, ok, truncate } from "../result.js";
import type { Sandbox } from "../sandbox.js";

export const MAX_ROWS = 500;
const DB_EXTENSIONS = [".db", ".sqlite", ".sqlite3"];
const ALLOWED_START = /^\s*(select|with|explain)\b/i;
const FORBIDDEN =
  /\b(attach|detach|insert|update|delete|drop|alter|create|replace|vacuum|reindex|pragma)\b/i;

export class QueryError extends Error {}

export function assertReadOnly(sql: string): void {
  const body = sql.trim().replace(/;\s*$/, "");
  if (body.includes(";")) throw new QueryError("Only a single statement is allowed.");
  if (!ALLOWED_START.test(body)) {
    throw new QueryError("Only SELECT, WITH or EXPLAIN queries are allowed (read-only).");
  }
  const withoutStrings = body.replace(/'(?:[^']|'')*'/g, "''");
  const match = withoutStrings.match(FORBIDDEN);
  if (match) throw new QueryError(`Statement not allowed in read-only mode: ${match[1]}`);
}

export function openReadOnly(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}

export function runQuery(path: string, sql: string, maxRows = MAX_ROWS) {
  assertReadOnly(sql);
  const db = openReadOnly(path);
  try {
    const statement = db.prepare(sql);
    const rows: Record<string, unknown>[] = [];
    for (const row of statement.iterate()) {
      if (rows.length >= maxRows) break;
      rows.push(row as Record<string, unknown>);
    }
    const columns = rows[0] ? Object.keys(rows[0]) : [];
    return { columns, rows, truncated: rows.length >= maxRows };
  } finally {
    db.close();
  }
}

export function schema(path: string) {
  const db = openReadOnly(path);
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    return tables.map(({ name }) => {
      const columns = db.prepare(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all() as {
        name: string;
        type: string;
        pk: number;
      }[];
      const count = db
        .prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`)
        .get() as {
        n: number;
      };
      return {
        table: name,
        rows: count.n,
        columns: columns.map((c) => ({ name: c.name, type: c.type, primaryKey: c.pk > 0 })),
      };
    });
  } finally {
    db.close();
  }
}

function toMarkdown(columns: string[], rows: Record<string, unknown>[]): string {
  if (!rows.length) return "(no rows)";
  const header = `| ${columns.join(" | ")} |\n|${columns.map(() => "---").join("|")}|`;
  const body = rows.map((r) => `| ${columns.map((c) => String(r[c] ?? "")).join(" | ")} |`);
  return [header, ...body].join("\n");
}

export function registerSqliteTools(server: McpServer, sandbox: Sandbox): void {
  server.registerTool(
    "sqlite_schema",
    {
      title: "SQLite schema",
      description: "List the tables of a SQLite database with their columns and row counts.",
      inputSchema: {
        database: z.string().describe("Path to a .db/.sqlite file, relative to the root"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ database }) =>
      guard(() => {
        const tables = schema(sandbox.file(database, DB_EXTENSIONS));
        const text = tables
          .map(
            (t) =>
              `${t.table} (${t.rows} rows): ${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")}`,
          )
          .join("\n");
        return ok(text || "(no tables)", { tables });
      }),
  );

  server.registerTool(
    "sqlite_query",
    {
      title: "Read-only SQL query",
      description: `Run one read-only SQL query (SELECT/WITH/EXPLAIN) on a SQLite file. Returns at most ${MAX_ROWS} rows. Call sqlite_schema first.`,
      inputSchema: {
        database: z.string().describe("Path to a .db/.sqlite file, relative to the root"),
        sql: z.string().min(1).max(10_000),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ database, sql }) =>
      guard(() => {
        const result = runQuery(sandbox.file(database, DB_EXTENSIONS), sql);
        const note = result.truncated
          ? `\n\nShowing the first ${MAX_ROWS} rows; add LIMIT or aggregate.`
          : "";
        return ok(truncate(toMarkdown(result.columns, result.rows)) + note, result);
      }),
  );
}
