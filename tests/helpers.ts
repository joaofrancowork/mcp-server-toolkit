import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type ServerOptions } from "../src/server.js";

export function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mcp-toolkit-"));
  const db = new DatabaseSync(join(root, "shop.db"));
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, city TEXT);
    INSERT INTO customers VALUES (1, 'Ana', 'Lisbon'), (2, 'Rui', 'Porto'), (3, 'Eva', 'Lisbon');
  `);
  db.close();
  writeFileSync(
    join(root, "orders.csv"),
    "id,amount,city,paid,date\n1,10.5,Lisbon,true,2026-01-02\n2,,Porto,false,2026-02-03\n3,30,Lisbon,true,2026-03-04\n",
  );
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "notes.md"), "# Notes\nhello");
  writeFileSync(join(root, "image.png"), "not listed");
  const outside = mkdtempSync(join(tmpdir(), "mcp-outside-"));
  writeFileSync(join(outside, "secret.csv"), "token\nabc\n");
  symlinkSync(join(outside, "secret.csv"), join(root, "escape.csv"));
  return root;
}

export async function connect(options: Partial<ServerOptions> & { root: string }) {
  const server = createServer(options);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { client, call };
}

export function text(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}

export function resourceText(content: { uri: string } | undefined): string {
  return content && "text" in content && typeof content.text === "string" ? content.text : "";
}
