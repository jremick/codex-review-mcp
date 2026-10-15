import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { CodexError, loadConfig, resolveCodex, runCodex } from "../dist/codex.js";
import { reviewPrompt } from "../dist/prompts.js";
import { fakeCodex, fixtures } from "./helpers.mjs";

const cfg = (o = {}) => ({ ...loadConfig({}), codexPath: fakeCodex, timeoutMs: 20_000, ...o });
const withMode = async (mode, fn) => { const p = process.env.FAKE_CODEX_MODE; process.env.FAKE_CODEX_MODE = mode; try { return await fn(); } finally { if (p === undefined) delete process.env.FAKE_CODEX_MODE; else process.env.FAKE_CODEX_MODE = p; } };
const tempDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith("codex-review-")).length;

test("loadConfig defaults and overrides", () => {
  assert.equal(loadConfig({}).timeoutMs, 300_000);
  assert.equal(loadConfig({ CODEX_REVIEW_TIMEOUT_MS: "1000", CODEX_REVIEW_MAX_CHARS: "50" }).maxChars, 50);
  assert.equal(loadConfig({ CODEX_REVIEW_TIMEOUT_MS: "nope" }).timeoutMs, 300_000);
});

test("CODEX_PATH pointing nowhere is a clear NOT_FOUND", () => {
  assert.throws(() => resolveCodex(cfg({ codexPath: "/definitely/not/codex" })), (e) => e instanceof CodexError && e.code === "NOT_FOUND");
});

test("finds codex on PATH", () => {
  const found = resolveCodex({ ...loadConfig({}) }, { PATH: fixtures });
  assert.equal(found.toLowerCase(), fakeCodex.toLowerCase());
});

test("runs read-only, prompt via stdin (not argv), and cleans up", async () => {
  const before = tempDirs();
  const evil = 'Hello "world" & del C:\\ | rm -rf / $(whoami) `id` %PATH% ^ < >';
  const r = await runCodex(reviewPrompt(evil, "tone"), cfg());
  const out = JSON.parse(r.text);
  for (const f of ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "-"]) assert.ok(out.args.includes(f), f);
  assert.ok(out.stdinHead.includes(evil), "document arrives intact via stdin");
  assert.ok(!out.args.some((a) => a.includes("world")), "document never on argv");
  assert.equal(tempDirs(), before);
});

test("model override is passed", async () => {
  const out = JSON.parse((await runCodex("hi", cfg({ model: "gpt-x" }))).text);
  assert.deepEqual(out.args.slice(out.args.indexOf("--model"), out.args.indexOf("--model") + 2), ["--model", "gpt-x"]);
});

test("large input survives stdin", async () => {
  const big = "x".repeat(150_000);
  const out = JSON.parse((await runCodex(big, cfg())).text);
  assert.equal(out.stdinChars, big.length);
});

test("not logged in is detected", () => withMode("notloggedin", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "NOT_LOGGED_IN" && /codex login/.test(e.message))));

test("other failures surface stderr", () => withMode("fail", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "FAILED" && /model exploded/.test(e.message))));

test("timeout kills codex and cleans up", () => withMode("hang", async () => {
  const before = tempDirs();
  await assert.rejects(runCodex("hi", cfg({ timeoutMs: 1500 })), (e) => e.code === "TIMEOUT");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(tempDirs(), before);
}));
