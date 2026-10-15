import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexError, codexArgs, codexVersion, loadConfig, loadInstructions, resolveCodex, runCodex } from "../dist/codex.js";
import { paperPrompt, reviewPrompt } from "../dist/prompts.js";
import { fakeCodex, fixtures } from "./helpers.mjs";

const cfg = (o = {}) => ({ ...loadConfig({}), codexPath: fakeCodex, timeoutMs: 20_000, ...o });
const withMode = async (mode, fn) => { const p = process.env.FAKE_CODEX_MODE; process.env.FAKE_CODEX_MODE = mode; try { return await fn(); } finally { if (p === undefined) delete process.env.FAKE_CODEX_MODE; else process.env.FAKE_CODEX_MODE = p; } };
const tempDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith("codex-review-")).length;
const tempFile = (name, text) => { const d = mkdtempSync(join(tmpdir(), "crm-test-")); const f = join(d, name); writeFileSync(f, text); return { f, cleanup: () => rmSync(d, { recursive: true, force: true }) }; };
const dead = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
const killPid = (pid) => { if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } };
const readJson = async (file) => {
  const start = Date.now();
  for (;;) {
    try { return JSON.parse(readFileSync(file, "utf8")); }
    catch (e) {
      if (e?.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
      if (Date.now() - start > 2_000) throw new Error(`timed out waiting for ${file}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
};

test("loadConfig defaults and overrides", () => {
  const d = loadConfig({});
  assert.equal(d.timeoutMs, 600_000);
  assert.equal(d.waitMs, 45_000);
  assert.equal(d.effort, "medium");
  assert.equal(d.instructionsFile, undefined);
  assert.equal(loadConfig({ CODEX_REVIEW_TIMEOUT_MS: "1000", CODEX_REVIEW_MAX_CHARS: "50" }).maxChars, 50);
  assert.equal(loadConfig({ CODEX_REVIEW_TIMEOUT_MS: "nope" }).timeoutMs, 600_000);
  assert.equal(loadConfig({ CODEX_REVIEW_EFFORT: "High" }).effort, "high");
  assert.equal(loadConfig({ CODEX_REVIEW_EFFORT: "default" }).effort, undefined);
});

test("unfilled .mcpb placeholders count as unset", () => {
  const c = loadConfig({ CODEX_PATH: "${user_config.codex_path}", CODEX_REVIEW_TIMEOUT_MS: "${user_config.timeout_ms}", CODEX_REVIEW_EFFORT: "${user_config.effort}", CODEX_REVIEW_INSTRUCTIONS: "${user_config.instructions_file}" });
  assert.equal(c.codexPath, undefined); assert.equal(c.timeoutMs, 600_000); assert.equal(c.effort, "medium"); assert.equal(c.instructionsFile, undefined);
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

test("model and reasoning effort are passed; bad effort is a CONFIG error", async () => {
  const out = JSON.parse((await runCodex("hi", cfg({ model: "gpt-x", effort: "low" }))).text);
  assert.deepEqual(out.args.slice(out.args.indexOf("--model"), out.args.indexOf("--model") + 2), ["--model", "gpt-x"]);
  assert.ok(out.args.includes("model_reasoning_effort=low"));
  assert.ok(!codexArgs(cfg({ effort: undefined }), "w", "o").some((a) => a.startsWith("model_reasoning_effort")));
  assert.throws(() => codexArgs(cfg({ effort: "turbo" }), "w", "o"), (e) => e.code === "CONFIG");
});

test("large input survives stdin", async () => {
  const big = "x".repeat(150_000);
  const out = JSON.parse((await runCodex(big, cfg())).text);
  assert.equal(out.stdinChars, big.length);
});

test("not logged in is detected", () => withMode("notloggedin", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "NOT_LOGGED_IN" && /codex login/.test(e.message))));

test("authentication_cache, a stray 401, and 'Authentication succeeded' are not sign-in failures", async () => {
  await withMode("authcache", () => assert.rejects(runCodex("hi", cfg()), (e) => e.code === "CONFIG" && /authentication_cache/.test(e.message) && !/not signed in/.test(e.message)));
  await withMode("stray401", () => assert.rejects(runCodex("hi", cfg()), (e) => e.code === "SANDBOX" && /reference 401/.test(e.message) && !/not signed in/.test(e.message)));
  await withMode("authbenign", () => assert.rejects(runCodex("hi", cfg()), (e) => e.code === "FAILED" && /Authentication succeeded/.test(e.message) && !/not signed in/.test(e.message)));
});

test("an explicit 401 Unauthorized status is a sign-in failure", () => withMode("unauthorized", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "NOT_LOGGED_IN" && /codex login/.test(e.message))));

test("sandbox setup failure is detected", () => withMode("sandbox", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "SANDBOX" && /Codex mode/.test(e.message))));

test("an unsupported model is a CONFIG error, and MCP-server 401 noise isn't mistaken for sign-in", () => withMode("badmodel", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "CONFIG" && /Model setting/.test(e.message) && !/rmcp/.test(e.message))));

test("a broken Codex settings file is a CONFIG error naming the file", () => withMode("badrules", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "CONFIG" && /own settings/.test(e.message) && /default\.rules:1/.test(e.message))));

test("a plain 'sandbox: read-only' banner is not mistaken for a sandbox failure", () => withMode("fail", () =>
  assert.rejects(runCodex("hi", cfg()), (e) => e.code === "FAILED" && /model exploded/.test(e.message))));

test("timeout kills codex and cleans up", () => withMode("hang", async () => {
  const before = tempDirs();
  await assert.rejects(runCodex("hi", cfg({ timeoutMs: 1500 })), (e) => e.code === "TIMEOUT");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(tempDirs(), before);
}));

test("timeout kills the process tree and removes the work dir only after exit", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "crm-test-"));
  const pidFile = join(scratch, "pids.json");
  const raceFile = join(scratch, "race");
  const prev = { mode: process.env.FAKE_CODEX_MODE, pid: process.env.FAKE_CODEX_PIDFILE, race: process.env.FAKE_CODEX_RACEFILE };
  process.env.FAKE_CODEX_MODE = "hang";
  process.env.FAKE_CODEX_PIDFILE = pidFile;
  process.env.FAKE_CODEX_RACEFILE = raceFile;
  const before = tempDirs();
  let state;
  try {
    const pending = runCodex("hi", cfg({ timeoutMs: 1500 }));
    state = await readJson(pidFile);
    assert.equal(typeof state.childPid, "number");
    assert.notEqual(state.childPid, state.pid);
    assert.equal(dead(state.pid), false);
    assert.equal(dead(state.childPid), false);
    assert.equal(existsSync(state.cwd), true);
    await assert.rejects(pending, (e) => e instanceof CodexError && e.code === "TIMEOUT");
    // Settling means the direct process was reaped; cleanup has already removed the work dir.
    assert.equal(dead(state.pid), true, "timeout settled before codex was reaped");
    assert.equal(existsSync(state.cwd), false);
    assert.equal(tempDirs(), before);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(dead(state.childPid), true, "descendant survived the timeout");
    assert.equal(existsSync(raceFile), false, "work dir was removed while a descendant was still running");
  } finally {
    killPid(state?.pid);
    killPid(state?.childPid);
    if (prev.mode === undefined) delete process.env.FAKE_CODEX_MODE; else process.env.FAKE_CODEX_MODE = prev.mode;
    if (prev.pid === undefined) delete process.env.FAKE_CODEX_PIDFILE; else process.env.FAKE_CODEX_PIDFILE = prev.pid;
    if (prev.race === undefined) delete process.env.FAKE_CODEX_RACEFILE; else process.env.FAKE_CODEX_RACEFILE = prev.race;
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("timeout settles when a descendant outside the process group keeps the pipes open", { timeout: 20_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "crm-test-"));
  const pidFile = join(scratch, "pids.json");
  const prev = { mode: process.env.FAKE_CODEX_MODE, pid: process.env.FAKE_CODEX_PIDFILE };
  process.env.FAKE_CODEX_MODE = "escape";
  process.env.FAKE_CODEX_PIDFILE = pidFile;
  const before = tempDirs();
  let state;
  try {
    const started = Date.now();
    const pending = runCodex("hi", cfg({ timeoutMs: 1500 }));
    state = await readJson(pidFile);
    await assert.rejects(pending, (e) => e instanceof CodexError && e.code === "TIMEOUT");
    // Settled on codex's own exit, well before the 5s kill-grace backstop would fire (1.5s + 5s).
    assert.ok(Date.now() - started < 5_500, `took ${Date.now() - started}ms`);
    assert.equal(dead(state.pid), true, "timeout settled before codex was reaped");
    assert.equal(tempDirs(), before);
  } finally {
    killPid(state?.pid);
    killPid(state?.childPid);
    if (prev.mode === undefined) delete process.env.FAKE_CODEX_MODE; else process.env.FAKE_CODEX_MODE = prev.mode;
    if (prev.pid === undefined) delete process.env.FAKE_CODEX_PIDFILE; else process.env.FAKE_CODEX_PIDFILE = prev.pid;
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("codex --version is read for the setup check", async () => {
  assert.equal(await codexVersion(fakeCodex), "codex-cli 0.0.0-fake");
});

test("editor instructions: front matter stripped; missing or empty file is a CONFIG error", () => {
  assert.equal(loadInstructions(cfg()), undefined);
  const t = tempFile("SKILL.md", "\uFEFF---\r\nname: paper-editor\r\ndescription: x\r\n---\r\nCut every adverb.\n");
  try {
    assert.deepEqual(loadInstructions(cfg({ instructionsFile: t.f })), { name: "SKILL.md", text: "Cut every adverb." });
    writeFileSync(t.f, "---\nname: x\n---\n   \n");
    assert.throws(() => loadInstructions(cfg({ instructionsFile: t.f })), (e) => e.code === "CONFIG" && /empty/.test(e.message));
  } finally { t.cleanup(); }
  assert.throws(() => loadInstructions(cfg({ instructionsFile: join(tmpdir(), "nope", "missing.md") })), (e) => e.code === "CONFIG" && /can't be read/.test(e.message));
});

test("review prompt uses editor instructions and always asks for a verdict", () => {
  const withEditor = reviewPrompt("Doc body", undefined, undefined, "Cut every adverb.");
  assert.match(withEditor, /<<<EDITOR INSTRUCTIONS\nCut every adverb\.\nEDITOR INSTRUCTIONS>>>/);
  assert.doesNotMatch(withEditor, /Overall assessment/);
  assert.match(withEditor, /VERDICT: READY/);
  const plain = reviewPrompt("Doc body");
  assert.match(plain, /Overall assessment/); assert.match(plain, /VERDICT: REVISE/);
});

test("paper prompt carries the brief and clamps rounds", () => {
  assert.match(paperPrompt("Proposal on X", "3"), /Brief: Proposal on X[\s\S]*up to 3 rounds/);
  assert.match(paperPrompt("b"), /up to 2 rounds/);
  assert.match(paperPrompt("b", "1"), /up to 1 round\./);
  assert.match(paperPrompt("b", "99"), /up to 5 rounds/);
  assert.match(paperPrompt("  "), /ask me what the paper is about/);
});
