import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
export const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const fakeCodex = join(fixtures, process.platform === "win32" ? "codex.cmd" : "codex");
