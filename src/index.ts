#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "./server.js";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: process.env.MCP_TOOLKIT_ROOT ?? process.cwd() },
    "no-fetch": { type: "boolean", default: false },
    "audit-log": { type: "string" },
    version: { type: "boolean", default: false },
  },
});

if (values.version) {
  console.log(VERSION);
  process.exit(0);
}

const server = createServer({
  root: values.root as string,
  enableFetch: !values["no-fetch"],
  auditLogPath: values["audit-log"],
});
await server.connect(new StdioServerTransport());
// stdout is the protocol channel; logs go to stderr.
console.error(`mcp-server-toolkit ${VERSION} ready (root: ${values.root})`);
