import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

export type CodexErrorCode = "NOT_FOUND" | "NOT_LOGGED_IN" | "SANDBOX" | "TIMEOUT" | "TOO_LARGE" | "CONFIG" | "FAILED";

export class CodexError extends Error {
  constructor(message: string, public readonly code: CodexErrorCode) {
    super(message);
  }
}

const isWin = process.platform === "win32";

export const EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

export interface Config {
  codexPath?: string;
  timeoutMs: number;
  waitMs: number;
  maxChars: number;
  model?: string;
  effort?: string;
  instructionsFile?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Unfilled .mcpb placeholders arrive as literal "${user_config.x}"; treat them as unset.
  const str = (v: string | undefined) => { const t = v?.trim(); return t && !t.startsWith("${") ? t : undefined; };
  const num = (v: string | undefined, d: number) => {
    const s = str(v);
    const n = Number(s);
    return s && Number.isFinite(n) && n > 0 ? n : d;
  };
  // "default" leaves the effort to the user's own Codex config.
  const effort = str(env.CODEX_REVIEW_EFFORT)?.toLowerCase() ?? "medium";
  return {
    codexPath: str(env.CODEX_PATH),
    timeoutMs: num(env.CODEX_REVIEW_TIMEOUT_MS, 10 * 60_000),
    waitMs: num(env.CODEX_REVIEW_WAIT_MS, 45_000),
    maxChars: num(env.CODEX_REVIEW_MAX_CHARS, 200_000),
    model: str(env.CODEX_REVIEW_MODEL),
    effort: effort === "default" ? undefined : effort,
    instructionsFile: str(env.CODEX_REVIEW_INSTRUCTIONS),
  };
}

export interface Instructions { name: string; text: string }

/** Read the editor instructions file, if one is set. A file that is set but unusable is an error, never a silent fallback. */
export function loadInstructions(cfg: Config): Instructions | undefined {
  const file = cfg.instructionsFile;
  if (!file) return undefined;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new CodexError(`The editor instructions file "${file}" can't be read. Check the path in the extension's settings, or clear it to use the built-in reviewer.`, "CONFIG");
  }
  // Skill files start with YAML front matter (name, description); the reviewer only needs the body.
  const text = raw.replace(/^﻿/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
  if (!text) throw new CodexError(`The editor instructions file "${file}" is empty. Paste your editor instructions into it, or clear the setting.`, "CONFIG");
  return { name: basename(file), text };
}

const isFile = (p: string) => {
  try { return statSync(p).isFile(); } catch { return false; }
};

/** Candidate directories to search for codex, beyond PATH (GUI apps on macOS don't inherit the shell PATH). */
function extraDirs(env: NodeJS.ProcessEnv): string[] {
  const home = homedir();
  if (isWin) {
    const appData = env.APPDATA ?? join(home, "AppData", "Roaming");
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return [
      join(local, "Programs", "OpenAI", "Codex", "bin"), // OpenAI's standalone installer (install.ps1)
      join(appData, "npm"), join(local, "Microsoft", "WinGet", "Links"), join(home, ".local", "bin"), join(home, "scoop", "shims"),
    ];
  }
  return [
    "/opt/homebrew/bin", "/usr/local/bin", join(home, ".local", "bin"), join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"), join(home, "bin"), "/usr/bin",
    ...(env.NVM_BIN ? [env.NVM_BIN] : []),
  ];
}

/** On Windows, npm installs a codex.cmd shim; find the real codex.exe it wraps so we never need a shell. */
function findVendoredExe(shimDir: string): string | undefined {
  const root = join(shimDir, "node_modules", "@openai");
  const walk = (dir: string, depth: number): string | undefined => {
    if (depth > 6) return undefined;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return undefined; }
    for (const e of entries) {
      const p = join(dir, e);
      if (e.toLowerCase() === "codex.exe" && isFile(p)) return p;
    }
    for (const e of entries) {
      const p = join(dir, e);
      try { if (statSync(p).isDirectory()) { const r = walk(p, depth + 1); if (r) return r; } } catch { /* ignore */ }
    }
    return undefined;
  };
  return existsSync(root) ? walk(root, 0) : undefined;
}

export function resolveCodex(cfg: Config, env: NodeJS.ProcessEnv = process.env): string {
  if (cfg.codexPath) {
    if (!isFile(cfg.codexPath)) throw new CodexError(`CODEX_PATH is set to "${cfg.codexPath}" but no file exists there.`, "NOT_FOUND");
    return cfg.codexPath;
  }
  const names = isWin ? ["codex.exe", "codex.cmd", "codex.bat"] : ["codex"];
  const dirs = [...(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean), ...extraDirs(env)];
  for (const name of names) {
    for (const d of dirs) {
      const p = join(d, name);
      if (isFile(p)) return p;
    }
  }
  throw new CodexError(
    "Could not find the Codex CLI. Install it (see the README), run `codex login`, " +
      "or set the Codex executable setting to the full path of codex.",
    "NOT_FOUND",
  );
}

// Arguments we pass are fixed flags plus temp-dir paths; this guards the Windows .cmd fallback.
const SAFE_ARG = /^[A-Za-z0-9_\-.:\\/ ~=]+$/;

function buildSpawn(bin: string, args: string[]): { cmd: string; args: string[]; opts: Record<string, unknown> } {
  if (isWin && /\.(cmd|bat)$/i.test(bin)) {
    const exe = findVendoredExe(dirname(bin));
    if (exe) return { cmd: exe, args, opts: {} };
    // Last resort: run the shim through cmd.exe. Only fixed, validated arguments are ever passed;
    // all user content goes through stdin, never the command line.
    for (const a of [bin, ...args]) {
      if (!SAFE_ARG.test(a)) throw new CodexError(`Refusing to run codex shim with unsafe argument. Set CODEX_PATH to codex.exe instead.`, "FAILED");
    }
    const line = [bin, ...args].map((a) => `"${a}"`).join(" ");
    return { cmd: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], opts: { windowsVerbatimArguments: true } };
  }
  return { cmd: bin, args, opts: {} };
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (isWin) spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(pid, "SIGKILL");
  } catch { /* already gone */ }
}

interface Spawned { code: number | null; stdout: string; stderr: string }

/** Run codex without a shell, feeding `input` on stdin, and kill it if it runs past the timeout. */
async function spawnCodex(bin: string, args: string[], o: { cwd: string; input: string; timeoutMs: number }): Promise<Spawned> {
  const s = buildSpawn(bin, args);
  const child = spawn(s.cmd, s.args, { cwd: o.cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false, ...s.opts });
  let stdout = "", stderr = "";
  child.stdout.on("data", (d) => { stdout = (stdout + d).slice(-20_000); });
  child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-20_000); });
  child.stdin.on("error", () => { /* child exited early; reported below */ });
  child.stdin.end(o.input, "utf8");
  const code = await new Promise<number | null>((resolve, reject) => {
    const t = setTimeout(() => { killTree(child.pid); reject(new CodexError(`Codex did not finish within ${Math.round(o.timeoutMs / 1000)}s. Raise the timeout setting or send a shorter document.`, "TIMEOUT")); }, o.timeoutMs);
    child.on("error", (e) => { clearTimeout(t); reject(new CodexError(`Failed to start codex (${bin}): ${e.message}`, "NOT_FOUND")); });
    child.on("close", (c) => { clearTimeout(t); resolve(c); });
  });
  return { code, stdout, stderr };
}

const LOGIN_RE = /not logged in|please (run )?`?codex login|login required|unauthori[sz]ed|\b401\b|authenticat/i;
const SANDBOX_RE = /sandbox (setup|error|failed|denied|is not (set ?up|available|supported))|failed to (create|apply|initiali[sz]e) (the )?sandbox|windows sandbox|CreateRestrictedToken|CreateProcessAsUser/i;

/** The codex arguments for one read-only, non-interactive turn. Exported for tests. */
export function codexArgs(cfg: Config, work: string, outFile: string): string[] {
  if (cfg.effort && !(EFFORTS as readonly string[]).includes(cfg.effort)) {
    throw new CodexError(`Reasoning effort "${cfg.effort}" isn't one of ${EFFORTS.join(", ")}.`, "CONFIG");
  }
  return [
    "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never",
    "-C", work, "--output-last-message", outFile,
    ...(cfg.model ? ["--model", cfg.model] : []),
    ...(cfg.effort ? ["-c", `model_reasoning_effort=${cfg.effort}`] : []),
    "-",
  ];
}

export interface RunResult { text: string; durationMs: number }

/** Run one read-only, non-interactive Codex turn. The prompt goes over stdin. */
export async function runCodex(prompt: string, cfg: Config = loadConfig()): Promise<RunResult> {
  const bin = resolveCodex(cfg);
  const work = mkdtempSync(join(tmpdir(), "codex-review-"));
  const outFile = join(work, "last-message.md");
  const started = Date.now();
  try {
    const { code, stdout, stderr } = await spawnCodex(bin, codexArgs(cfg, work, outFile), { cwd: work, input: prompt, timeoutMs: cfg.timeoutMs });
    const out = existsSync(outFile) ? readFileSync(outFile, "utf8").trim() : "";
    if (code !== 0 || !out) {
      const detail = (stderr || stdout).trim().split(/\r?\n/).slice(-8).join("\n");
      if (LOGIN_RE.test(detail)) throw new CodexError("Codex is not signed in. Run `codex login` in a terminal (choose \"Sign in with ChatGPT\"), then try again.", "NOT_LOGGED_IN");
      if (SANDBOX_RE.test(detail)) throw new CodexError(`Codex couldn't start its read-only sandbox. Open the ChatGPT app in Codex mode (or run \`codex\` in a terminal) once to finish its setup, then try again.\n${detail}`, "SANDBOX");
      throw new CodexError(`Codex exited with code ${code}${out ? "" : " and no answer"}.${detail ? `\n${detail}` : ""}`, "FAILED");
    }
    return { text: out, durationMs: Date.now() - started };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** `codex --version`, for the setup check. */
export async function codexVersion(bin: string): Promise<string> {
  const work = mkdtempSync(join(tmpdir(), "codex-review-"));
  try {
    const { code, stdout, stderr } = await spawnCodex(bin, ["--version"], { cwd: work, input: "", timeoutMs: 30_000 });
    const v = (stdout || stderr).trim().split(/\r?\n/)[0] ?? "";
    if (code !== 0 || !v) throw new CodexError(`\`codex --version\` failed (exit code ${code}).`, "FAILED");
    return v;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
