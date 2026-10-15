import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fakeCodex } from "./helpers.mjs";

async function connect(env = {}) {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env, CODEX_PATH: fakeCodex, ...env } });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  return client;
}
const body = (r) => r.content[0].text;
const fake = (r) => JSON.parse(body(r).replace(/^Editor instructions: .*\n\n/, ""));

test("lists the tools and the paper prompt; reviews via MCP", async () => {
  const c = await connect();
  try {
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["chatgpt_ask", "chatgpt_check", "chatgpt_result", "chatgpt_review"]);
    assert.deepEqual((await c.listPrompts()).prompts.map((p) => p.name), ["write_paper"]);
    const r = await c.callTool({ name: "chatgpt_review", arguments: { document: "My plan", focus: "risks", rubric: "1. clear" } });
    assert.ok(!r.isError);
    assert.match(body(r), /^Editor instructions: none set/);
    const head = fake(r).stdinHead;
    assert.match(head, /My plan/); assert.match(head, /risks/); assert.match(head, /1\. clear/); assert.match(head, /VERDICT/);
    const a = await c.callTool({ name: "chatgpt_ask", arguments: { question: "Why?", context: "ctx" } });
    assert.match(fake(a).stdinHead, /Question: Why\?/);
  } finally { await c.close(); }
});

test("write_paper prompt renders the loop", async () => {
  const c = await connect();
  try {
    const p = await c.getPrompt({ name: "write_paper", arguments: { brief: "Two-page release proposal", rounds: "1" } });
    const text = p.messages[0].content.text;
    assert.match(text, /Brief: Two-page release proposal/);
    assert.match(text, /chatgpt_review/); assert.match(text, /chatgpt_result/); assert.match(text, /up to 1 round\./);
  } finally { await c.close(); }
});

test("editor instructions file is used and named in the result", async () => {
  const d = mkdtempSync(join(tmpdir(), "crm-test-"));
  const f = join(d, "editor-skill.md");
  writeFileSync(f, "---\nname: paper-editor\n---\nFlag every passive sentence.\n");
  const c = await connect({ CODEX_REVIEW_INSTRUCTIONS: f });
  try {
    const r = await c.callTool({ name: "chatgpt_review", arguments: { document: "Draft text" } });
    assert.ok(!r.isError);
    assert.match(body(r), /^Editor instructions: editor-skill\.md\n\n/);
    assert.match(fake(r).stdinHead, /<<<EDITOR INSTRUCTIONS\nFlag every passive sentence\.\nEDITOR INSTRUCTIONS>>>/);
  } finally { await c.close(); rmSync(d, { recursive: true, force: true }); }
});

test("a missing editor instructions file fails loudly instead of falling back", async () => {
  const c = await connect({ CODEX_REVIEW_INSTRUCTIONS: join(tmpdir(), "nope", "missing.md") });
  try {
    const r = await c.callTool({ name: "chatgpt_review", arguments: { document: "Draft" } });
    assert.equal(r.isError, true); assert.match(body(r), /can't be read/);
  } finally { await c.close(); }
});

test("slow reviews return a job_id that chatgpt_result collects", async () => {
  const c = await connect({ FAKE_CODEX_MODE: "slow", FAKE_CODEX_DELAY_MS: "1500", CODEX_REVIEW_WAIT_MS: "200" });
  try {
    const first = await c.callTool({ name: "chatgpt_review", arguments: { document: "Long draft" } });
    assert.ok(!first.isError);
    const id = body(first).match(/job_id "([0-9a-f]+)"/)?.[1];
    assert.ok(id, body(first));
    let r;
    for (let i = 0; i < 30; i++) {
      r = await c.callTool({ name: "chatgpt_result", arguments: { job_id: id } });
      if (!/still working/.test(body(r))) break;
    }
    assert.ok(!r.isError); assert.match(fake(r).stdinHead, /Long draft/);
    // A finished job can be collected again.
    assert.match(fake(await c.callTool({ name: "chatgpt_result", arguments: { job_id: id } })).stdinHead, /Long draft/);
    const unknown = await c.callTool({ name: "chatgpt_result", arguments: { job_id: "deadbeef" } });
    assert.equal(unknown.isError, true); assert.match(body(unknown), /no ChatGPT job/);
  } finally { await c.close(); }
});

test("chatgpt_check reports a working setup", async () => {
  const c = await connect();
  try {
    const r = await c.callTool({ name: "chatgpt_check", arguments: {} });
    assert.ok(!r.isError);
    assert.match(body(r), /^Ready/); assert.match(body(r), /codex-cli 0\.0\.0-fake/); assert.match(body(r), /no editor instructions file is set/);
  } finally { await c.close(); }
});

test("chatgpt_check names the problem when sign-in fails", async () => {
  const c = await connect({ FAKE_CODEX_MODE: "notloggedin" });
  try {
    const r = await c.callTool({ name: "chatgpt_check", arguments: {} });
    assert.match(body(r), /^Not ready/); assert.match(body(r), /Problem: Codex is not signed in/);
  } finally { await c.close(); }
});

test("size cap counts the editor instructions and returns a tool error", async () => {
  const c = await connect({ CODEX_REVIEW_MAX_CHARS: "10" });
  try {
    const r = await c.callTool({ name: "chatgpt_review", arguments: { document: "this is longer than ten" } });
    assert.equal(r.isError, true); assert.match(body(r), /limit is 10/);
  } finally { await c.close(); }
});

test("not logged in returns a friendly tool error", async () => {
  const c = await connect({ FAKE_CODEX_MODE: "notloggedin" });
  try {
    const r = await c.callTool({ name: "chatgpt_ask", arguments: { question: "hi" } });
    assert.equal(r.isError, true); assert.match(body(r), /codex login/);
  } finally { await c.close(); }
});
