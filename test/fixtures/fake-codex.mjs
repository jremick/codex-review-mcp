// Fake `codex` used by tests. Behaviour is chosen with FAKE_CODEX_MODE.
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? "ok";
if (args[0] === "--version") { console.log("codex-cli 0.0.0-fake"); process.exit(0); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (mode === "hang") return setInterval(() => {}, 1000);
  if (mode === "notloggedin") { process.stderr.write("Error: Not logged in. Please run `codex login`.\n"); process.exit(1); }
  if (mode === "sandbox") { process.stderr.write("sandbox: read-only\nError: windows sandbox setup failed: access denied\n"); process.exit(1); }
  if (mode === "fail") { process.stderr.write("sandbox: read-only\nboom: model exploded\n"); process.exit(3); }
  const write = () => {
    const out = args[args.indexOf("--output-last-message") + 1];
    writeFileSync(out, JSON.stringify({ args, cwd: process.cwd(), stdinChars: input.length, stdinHead: input.slice(0, 4000) }));
  };
  if (mode === "slow") setTimeout(write, Number(process.env.FAKE_CODEX_DELAY_MS ?? 1500));
  else write();
});
