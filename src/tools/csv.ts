/** Profile a CSV file so an agent can understand it without reading every row. */
import { readFileSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { guard, ok } from "../result.js";
import type { Sandbox } from "../sandbox.js";

export interface ColumnProfile {
  name: string;
  type: "number" | "boolean" | "date" | "text" | "empty";
  nonNull: number;
  nulls: number;
  unique: number;
  min?: number | string;
  max?: number | string;
  mean?: number;
  top?: { value: string; count: number }[];
}

const NULLS = new Set(["", "na", "n/a", "null", "none", "nan"]);
const BOOLEANS = new Set(["true", "false", "yes", "no", "0", "1"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/;

function inferType(values: string[]): ColumnProfile["type"] {
  if (!values.length) return "empty";
  if (values.every((v) => v.trim() !== "" && Number.isFinite(Number(v)))) return "number";
  if (values.every((v) => BOOLEANS.has(v.toLowerCase()))) return "boolean";
  if (values.every((v) => ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)))) return "date";
  return "text";
}

export function profileColumn(name: string, raw: string[]): ColumnProfile {
  const values = raw.filter((v) => !NULLS.has(v.trim().toLowerCase()));
  const type = inferType(values);
  const profile: ColumnProfile = {
    name,
    type,
    nonNull: values.length,
    nulls: raw.length - values.length,
    unique: new Set(values).size,
  };
  if (type === "number") {
    const nums = values.map(Number);
    profile.min = Math.min(...nums);
    profile.max = Math.max(...nums);
    profile.mean = Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
  } else if (type === "date") {
    const sorted = [...values].sort();
    profile.min = sorted[0];
    profile.max = sorted[sorted.length - 1];
  }
  if (type === "text" || type === "boolean") {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    profile.top = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));
  }
  return profile;
}

export function profileCsv(content: string, delimiter?: string) {
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    ...(delimiter ? { delimiter } : {}),
  }) as Record<string, string>[];
  const columns = records[0] ? Object.keys(records[0]) : [];
  return {
    rows: records.length,
    columns: columns.map((c) =>
      profileColumn(
        c,
        records.map((r) => r[c] ?? ""),
      ),
    ),
    sample: records.slice(0, 5),
  };
}

function describe(p: ColumnProfile): string {
  const parts = [`${p.name}: ${p.type}`, `${p.nulls} null`, `${p.unique} unique`];
  if (p.min !== undefined) parts.push(`range ${p.min}..${p.max}`);
  if (p.mean !== undefined) parts.push(`mean ${p.mean}`);
  if (p.top) parts.push(`top ${p.top.map((t) => `${t.value} (${t.count})`).join(", ")}`);
  return `- ${parts.join(" · ")}`;
}

export function registerCsvTools(server: McpServer, sandbox: Sandbox): void {
  server.registerTool(
    "csv_profile",
    {
      title: "Profile a CSV file",
      description:
        "Row count, inferred column types, nulls, unique values, numeric ranges and top values, plus 5 sample rows.",
      inputSchema: {
        path: z.string().describe("Path to a .csv/.tsv file, relative to the root"),
        delimiter: z.string().length(1).optional().describe("Defaults to ',' (or tab for .tsv)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ path, delimiter }) =>
      guard(() => {
        const file = sandbox.file(path, [".csv", ".tsv"]);
        const profile = profileCsv(
          readFileSync(file, "utf8"),
          delimiter ?? (file.endsWith(".tsv") ? "\t" : undefined),
        );
        const text = [
          `${sandbox.display(file)}: ${profile.rows} rows, ${profile.columns.length} columns`,
          ...profile.columns.map(describe),
        ].join("\n");
        return ok(text, profile);
      }),
  );
}
