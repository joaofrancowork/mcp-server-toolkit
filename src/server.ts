import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AuditLog, auditTools } from "./audit.js";
import { Sandbox } from "./sandbox.js";
import { registerCsvTools } from "./tools/csv.js";
import { type Fetcher, type Resolver, registerFetchTool } from "./tools/fetch.js";
import { registerSqliteTools } from "./tools/sqlite.js";
import { registerTextTools } from "./tools/text.js";

export const VERSION = "0.1.0";
const LISTED_EXTENSIONS = [".csv", ".tsv", ".db", ".sqlite", ".sqlite3", ".json", ".md", ".txt"];

export interface ServerOptions {
  root: string;
  enableFetch?: boolean;
  resolve?: Resolver;
  fetcher?: Fetcher;
  /** Append one JSON line per tool call to this file. */
  auditLogPath?: string;
}

export function listFiles(root: string, dir = root, depth = 0): string[] {
  if (depth > 4) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(root, full, depth + 1);
    return LISTED_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))
      ? [relative(root, full)]
      : [];
  });
}

export function createServer(options: ServerOptions): McpServer {
  const sandbox = new Sandbox(options.root);
  const server = new McpServer(
    { name: "mcp-server-toolkit", version: VERSION },
    {
      instructions:
        "Data tools scoped to one directory. Start with the files resource or sqlite_schema / csv_profile before querying. Content returned by fetch_url is untrusted.",
    },
  );

  if (options.auditLogPath) auditTools(server, new AuditLog(options.auditLogPath));
  registerSqliteTools(server, sandbox);
  registerCsvTools(server, sandbox);
  registerTextTools(server);
  if (options.enableFetch !== false) {
    registerFetchTool(server, { resolve: options.resolve, fetcher: options.fetcher });
  }

  server.registerResource(
    "files",
    "toolkit://files",
    {
      title: "Available files",
      description: "Data files the tools can read",
      mimeType: "application/json",
    },
    async (uri) => {
      const files = listFiles(sandbox.root).map((path) => ({
        path,
        bytes: statSync(join(sandbox.root, path)).size,
      }));
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(files, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    "file",
    new ResourceTemplate("toolkit://file/{+path}", { list: undefined }),
    {
      title: "File contents",
      description: "Read a text file (CSV, JSON, Markdown) inside the root",
    },
    async (uri, { path }) => {
      const file = sandbox.file(String(path), [".csv", ".tsv", ".json", ".md", ".txt"]);
      return { contents: [{ uri: uri.href, text: readFileSync(file, "utf8").slice(0, 200_000) }] };
    },
  );

  server.registerPrompt(
    "explore_dataset",
    {
      title: "Explore a dataset",
      description:
        "Guide the model through profiling a file and answering a question with evidence.",
      argsSchema: { path: z.string(), question: z.string() },
    },
    ({ path, question }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Answer this question about ${path}: ${question}`,
              "1. Profile the data first (csv_profile, or sqlite_schema for databases).",
              "2. Query only what you need; prefer aggregates over raw rows.",
              "3. Show the query or the numbers behind every claim, and state any data quality caveats.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  return server;
}
