// Real end-to-end check: talks to the built server over stdio and uses the real, logged-in codex.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env } });
const c = new Client({ name: "e2e", version: "0" });
await c.connect(t);
const doc = "# Q3 plan\nWe will grow revenue 300% next quarter by hiring one intern. Risks: none.";
const started = Date.now();
const r = await c.callTool({ name: "chatgpt_review", arguments: { document: doc, focus: "realism" } });
console.log(`isError=${!!r.isError} seconds=${((Date.now() - started) / 1000).toFixed(1)}\n---\n${r.content[0].text}`);
await c.close();
process.exit(r.isError ? 1 : 0);
