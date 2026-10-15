import { randomBytes } from "node:crypto";

/**
 * Background jobs, so a long review never depends on how long the MCP client waits for one tool call.
 * Claude Desktop's MCP client gives up on a request after about 60s by default; tools wait less than
 * that, then hand back a job ID that `chatgpt_result` collects.
 */
export type Settled =
  | { state: "done"; text: string }
  | { state: "error"; message: string }
  | { state: "running"; id: string; seconds: number }
  | { state: "unknown"; id: string };

interface Job { started: number; finished?: number; text?: string; error?: string; done: Promise<void> }

const KEEP_MS = 60 * 60_000;

export class Jobs {
  private jobs = new Map<string, Job>();

  start(work: () => Promise<string>): string {
    this.sweep();
    const id = randomBytes(4).toString("hex");
    const job: Job = { started: Date.now(), done: Promise.resolve() };
    job.done = work().then(
      (text) => { job.text = text; job.finished = Date.now(); },
      (e) => { job.error = e instanceof Error ? e.message : String(e); job.finished = Date.now(); },
    );
    this.jobs.set(id, job);
    return id;
  }

  /** Wait up to `waitMs` for the job. Finished jobs stay collectable, so a reply lost in transit can be fetched again. */
  async settle(id: string, waitMs: number): Promise<Settled> {
    const job = this.jobs.get(id);
    if (!job) return { state: "unknown", id };
    if (job.finished === undefined) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([job.done, new Promise<void>((r) => { timer = setTimeout(r, waitMs); })]);
      clearTimeout(timer);
    }
    if (job.finished === undefined) return { state: "running", id, seconds: Math.round((Date.now() - job.started) / 1000) };
    return job.error !== undefined ? { state: "error", message: job.error } : { state: "done", text: job.text ?? "" };
  }

  private sweep() {
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, j] of this.jobs) if (j.finished !== undefined && j.finished < cutoff) this.jobs.delete(id);
  }
}
