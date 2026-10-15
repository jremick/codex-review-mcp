// Real end-to-end check: talks to the built server over stdio and uses the real, logged-in codex.
// Usage: node scripts/e2e.mjs [document.md]
// Set CODEX_REVIEW_INSTRUCTIONS to review with an editor instructions file.
// The client keeps the MCP SDK's default 60s request timeout, like Claude Desktop, so long reviews must use job IDs.
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const t = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env } });
const c = new Client({ name: "e2e", version: "0" });
await c.connect(t);
const text = (r) => r.content[0].text;

async function call(name, args) {
  const started = Date.now();
  let r = await c.callTool({ name, arguments: args });
  let polls = 0;
  for (let id; !r.isError && (id = text(r).match(/still working.*job_id "([0-9a-f]+)"/s)?.[1]); polls++) {
    r = await c.callTool({ name: "chatgpt_result", arguments: { job_id: id } });
  }
  return { r, polls, seconds: ((Date.now() - started) / 1000).toFixed(1) };
}

const check = await call("chatgpt_check", {});
console.log(`== chatgpt_check (${check.seconds}s)\n${text(check.r)}\n`);

const doc = process.argv[2]
  ? readFileSync(process.argv[2], "utf8")
  : "# Q3 plan\nWe will grow revenue 300% next quarter by hiring one intern. Risks: none.";
const review = await call("chatgpt_review", { document: doc, focus: process.argv[2] ? undefined : "realism" });
const out = text(review.r);
const verdict = out.trim().split(/\r?\n/).pop();
console.log(`== chatgpt_review: chars=${doc.length} isError=${!!review.r.isError} seconds=${review.seconds} resultPolls=${review.polls}`);
console.log(`${out.slice(0, 1500)}${out.length > 1500 ? "\n[…]" : ""}\n== last line: ${verdict}`);
await c.close();
process.exit(review.r.isError || check.r.isError || !/^VERDICT: (READY|REVISE)$/.test(verdict) ? 1 : 0);
