/** End-to-end check of the built server over stdio, as an MCP host would run it. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/index.js", "--root", "examples/data", "--no-fetch"],
});
const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const result = await client.callTool({
  name: "sqlite_query",
  arguments: {
    database: "shop.db",
    sql: "SELECT plan, COUNT(*) AS orders, SUM(amount_eur) AS revenue FROM orders GROUP BY plan ORDER BY revenue DESC",
  },
});
const content = result.content as { type: string; text: string }[];
console.log(content[0]?.text);
if (result.isError || tools.length !== 5) process.exit(1);
await client.close();
