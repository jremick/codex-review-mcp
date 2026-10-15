// Builds codex-review-mcp.mcpb: manifest + dist + production node_modules.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
rmSync("bundle", { recursive: true, force: true });
mkdirSync("bundle");
for (const f of ["manifest.json", "package.json", "package-lock.json", "README.md", "LICENSE", "dist"]) cpSync(f, `bundle/${f}`, { recursive: true });
execFileSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: "bundle", stdio: "inherit", shell: process.platform === "win32" });
execFileSync(process.execPath, ["node_modules/@anthropic-ai/mcpb/dist/cli/cli.js", "pack", "bundle", "codex-review-mcp.mcpb"], { stdio: "inherit" });
