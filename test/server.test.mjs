import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeCodex } from "./helpers.mjs";

async function connect(env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env, CODEX_PATH: fakeCodex, ...env } });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}

test("lists both tools and reviews via MCP", async () => {
  const c = await connect();
  try {
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["chatgpt_ask", "chatgpt_review"]);
    const r = await c.callTool({ name: "chatgpt_review", arguments: { document: "My plan", focus: "risks", rubric: "1. clear" } });
    assert.ok(!r.isError);
    const head = JSON.parse(r.content[0].text).stdinHead;
    assert.match(head, /My plan/); assert.match(head, /risks/); assert.match(head, /1\. clear/);
    const a = await c.callTool({ name: "chatgpt_ask", arguments: { question: "Why?", context: "ctx" } });
    assert.match(JSON.parse(a.content[0].text).stdinHead, /Question: Why\?/);
  } finally { await c.close(); }
});

test("size cap returns a tool error", async () => {
  const c = await connect({ CODEX_REVIEW_MAX_CHARS: "10" });
  try {
    const r = await c.callTool({ name: "chatgpt_review", arguments: { document: "this is longer than ten" } });
    assert.equal(r.isError, true); assert.match(r.content[0].text, /limit is 10/);
  } finally { await c.close(); }
});

test("not logged in returns a friendly tool error", async () => {
  const c = await connect({ FAKE_CODEX_MODE: "notloggedin" });
  try {
    const r = await c.callTool({ name: "chatgpt_ask", arguments: { question: "hi" } });
    assert.equal(r.isError, true); assert.match(r.content[0].text, /codex login/);
  } finally { await c.close(); }
});
