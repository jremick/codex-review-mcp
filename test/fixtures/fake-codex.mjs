// Fake `codex` used by tests. Behaviour is chosen with FAKE_CODEX_MODE.
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? "ok";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  if (mode === "hang") return setInterval(() => {}, 1000);
  if (mode === "notloggedin") { process.stderr.write("Error: Not logged in. Please run `codex login`.\n"); process.exit(1); }
  if (mode === "fail") { process.stderr.write("boom: model exploded\n"); process.exit(3); }
  const out = args[args.indexOf("--output-last-message") + 1];
  writeFileSync(out, JSON.stringify({ args, cwd: process.cwd(), stdinChars: input.length, stdinHead: input.slice(0, 4000) }));
});
