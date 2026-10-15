import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export class CodexError extends Error {
  constructor(message: string, public readonly code: "NOT_FOUND" | "NOT_LOGGED_IN" | "TIMEOUT" | "TOO_LARGE" | "FAILED") {
    super(message);
  }
}

const isWin = process.platform === "win32";

export interface Config {
  codexPath?: string;
  timeoutMs: number;
  maxChars: number;
  model?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return v && Number.isFinite(n) && n > 0 ? n : d;
  };
  // Unfilled .mcpb placeholders arrive as literal "${user_config.x}"; treat them as unset.
  const str = (v: string | undefined) => { const t = v?.trim(); return t && !t.startsWith("${") ? t : undefined; };
  env = { ...env, CODEX_PATH: str(env.CODEX_PATH), CODEX_REVIEW_TIMEOUT_MS: str(env.CODEX_REVIEW_TIMEOUT_MS), CODEX_REVIEW_MODEL: str(env.CODEX_REVIEW_MODEL) };
  return {
    codexPath: env.CODEX_PATH,
    timeoutMs: num(env.CODEX_REVIEW_TIMEOUT_MS, 5 * 60_000),
    maxChars: num(env.CODEX_REVIEW_MAX_CHARS, 200_000),
    model: env.CODEX_REVIEW_MODEL?.trim() || undefined,
  };
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
    return [join(appData, "npm"), join(local, "Programs", "codex"), join(home, ".local", "bin"), join(home, "scoop", "shims")];
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
    "Could not find the Codex CLI. Install it with `npm install -g @openai/codex`, run `codex login`, " +
      "or set CODEX_PATH to the full path of the codex executable.",
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

const LOGIN_RE = /not logged in|please (run )?`?codex login|login required|unauthori[sz]ed|401|authenticat/i;

export interface RunResult { text: string; durationMs: number }

/** Run one read-only, non-interactive Codex turn. The prompt goes over stdin. */
export async function runCodex(prompt: string, cfg: Config = loadConfig()): Promise<RunResult> {
  const bin = resolveCodex(cfg);
  const work = mkdtempSync(join(tmpdir(), "codex-review-"));
  const outFile = join(work, "last-message.md");
  const started = Date.now();
  try {
    const args = [
      "exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never",
      "-C", work, "--output-last-message", outFile,
      ...(cfg.model ? ["--model", cfg.model] : []),
      "-",
    ];
    const s = buildSpawn(bin, args);
    const child = spawn(s.cmd, s.args, { cwd: work, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false, ...s.opts });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout = (stdout + d).slice(-20_000); });
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-20_000); });
    child.stdin.on("error", () => { /* child exited early; reported below */ });
    child.stdin.end(prompt, "utf8");

    const code = await new Promise<number | null>((resolve, reject) => {
      const t = setTimeout(() => { killTree(child.pid); reject(new CodexError(`Codex did not finish within ${Math.round(cfg.timeoutMs / 1000)}s. Raise CODEX_REVIEW_TIMEOUT_MS or send a shorter document.`, "TIMEOUT")); }, cfg.timeoutMs);
      child.on("error", (e) => { clearTimeout(t); reject(new CodexError(`Failed to start codex (${bin}): ${e.message}`, "NOT_FOUND")); });
      child.on("close", (c) => { clearTimeout(t); resolve(c); });
    });

    const out = existsSync(outFile) ? readFileSync(outFile, "utf8").trim() : "";
    if (code !== 0 || !out) {
      const detail = (stderr || stdout).trim().split(/\r?\n/).slice(-8).join("\n");
      if (LOGIN_RE.test(detail)) throw new CodexError("Codex is not signed in. Run `codex login` in a terminal (choose \"Sign in with ChatGPT\"), then try again.", "NOT_LOGGED_IN");
      throw new CodexError(`Codex exited with code ${code}${out ? "" : " and no answer"}.${detail ? `\n${detail}` : ""}`, "FAILED");
    }
    return { text: out, durationMs: Date.now() - started };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

