// Fake `codex` used by tests. Behaviour is chosen with FAKE_CODEX_MODE.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? "ok";
if (args[0] === "--version") { console.log("codex-cli 0.0.0-fake"); process.exit(0); }

// Stay alive with a descendant in this process group. If the work dir disappears first, record that.
function hang() {
  const child = spawn(process.execPath, ["-e", `
    const fs = require("node:fs");
    const cwd = process.cwd();
    const race = process.env.FAKE_CODEX_RACEFILE;
    setInterval(() => {
      if (!race || fs.existsSync(cwd)) return;
      try { fs.writeFileSync(race, "removed-while-alive\\n"); } catch {}
    }, 15);
  `], { stdio: "ignore", windowsHide: true });
  const pidFile = process.env.FAKE_CODEX_PIDFILE;
  if (pidFile) writeFileSync(pidFile, JSON.stringify({ pid: process.pid, childPid: child.pid, cwd: process.cwd() }));
  return setInterval(() => {}, 1000);
}

// Leave a descendant in its own process group that holds stderr open, as an MCP server Codex starts might.
// A process-group kill misses it on POSIX. It exits by itself after 20s.
function escape() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { detached: true, stdio: ["ignore", "ignore", "inherit"], windowsHide: true });
  const pidFile = process.env.FAKE_CODEX_PIDFILE;
  if (pidFile) writeFileSync(pidFile, JSON.stringify({ pid: process.pid, childPid: child.pid, cwd: process.cwd() }));
  return setInterval(() => {}, 1000);
}

// Record the process tree at startup so a timeout test can observe it before the kill.
if (mode === "hang") hang();
if (mode === "escape") escape();

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (mode === "hang" || mode === "escape") return;
  if (mode === "notloggedin") { process.stderr.write("Error: Not logged in. Please run `codex login`.\n"); process.exit(1); }
  if (mode === "authcache") { process.stderr.write("Error loading config: authentication_cache has invalid type\n"); process.exit(1); }
  if (mode === "stray401") { process.stderr.write("Error: windows sandbox setup failed: diagnostic reference 401\n"); process.exit(1); }
  if (mode === "authbenign") { process.stderr.write("Authentication succeeded earlier\nboom: model exploded\n"); process.exit(3); }
  if (mode === "unauthorized") { process.stderr.write("ERROR: unexpected status 401 Unauthorized\n"); process.exit(1); }
  if (mode === "sandbox") { process.stderr.write("sandbox: read-only\nError: windows sandbox setup failed: access denied\n"); process.exit(1); }
  if (mode === "badmodel") {
    process.stderr.write('2026-10-15T05:02:06Z ERROR rmcp::transport::worker: worker quit with fatal: HTTP 401 Unauthorized\n');
    process.stderr.write(`ERROR: {"type":"error","status":400,"error":{"message":"The 'gpt-x' model is not supported when using Codex with a ChatGPT account."}}\n`);
    process.exit(1);
  }
  if (mode === "badrules") { process.stderr.write("Error loading rules:\nC:\\Users\\me\\.codex\\rules\\default.rules:1: starlark error: error: Parse error: invalid string escape sequence `Us`\n"); process.exit(1); }
  if (mode === "fail") { process.stderr.write("sandbox: read-only\nboom: model exploded\n"); process.exit(3); }
  const write = () => {
    const out = args[args.indexOf("--output-last-message") + 1];
    writeFileSync(out, JSON.stringify({ args, cwd: process.cwd(), stdinChars: input.length, stdinHead: input.slice(0, 4000) }));
  };
  if (mode === "slow") setTimeout(write, Number(process.env.FAKE_CODEX_DELAY_MS ?? 1500));
  else write();
});
