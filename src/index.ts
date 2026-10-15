#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CodexError, type Config, codexVersion, loadConfig, loadInstructions, resolveCodex, runCodex } from "./codex.js";
import { Jobs, type Settled } from "./jobs.js";
import { CHECK_PROMPT, askPrompt, paperPrompt, reviewPrompt } from "./prompts.js";

const server = new McpServer({ name: "codex-review-mcp", version: "0.2.0" });
const jobs = new Jobs();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function reply(s: Settled, waitMs: number) {
  const text = (t: string, isError = false) => ({ ...(isError && { isError: true }), content: [{ type: "text" as const, text: t }] });
  switch (s.state) {
    case "done": return text(s.text);
    case "error": return text(`ChatGPT review failed: ${s.message}`, true);
    case "running": return text(`ChatGPT is still working (${s.seconds}s so far). Call chatgpt_result with job_id "${s.id}" to collect the answer. Each call waits up to ${Math.round(waitMs / 1000)}s.`);
    case "unknown": return text(`There's no ChatGPT job "${s.id}". It may have expired, or Claude restarted this extension. Run the request again.`, true);
  }
}

/** Start the work as a job and wait briefly; long work comes back as a job ID instead of timing out. */
async function startAndWait(cfg: Config, work: () => Promise<string>) {
  return reply(await jobs.settle(jobs.start(work), cfg.waitMs), cfg.waitMs);
}

function tooLarge(chars: number, cfg: Config) {
  return new CodexError(`Input is ${chars.toLocaleString()} characters; the limit is ${cfg.maxChars.toLocaleString()} (CODEX_REVIEW_MAX_CHARS). Send a shorter excerpt.`, "TOO_LARGE");
}

server.registerTool(
  "chatgpt_review",
  {
    title: "Review a document with ChatGPT",
    description:
      "Send a document to ChatGPT (via the user's Codex CLI / ChatGPT subscription) for an independent review. " +
      "If the user has set an editor instructions file, ChatGPT reviews as that editor. The review ends with 'VERDICT: READY' or 'VERDICT: REVISE'. " +
      "The document text is sent to OpenAI. If ChatGPT is still working after about 45s, this returns a job_id: call chatgpt_result with it to get the review.",
    inputSchema: {
      document: z.string().min(1).describe("Full text of the document to review (Markdown or plain text)."),
      focus: z.string().optional().describe("What to focus on, e.g. 'clarity for executives' or 'factual accuracy'."),
      rubric: z.string().optional().describe("Optional rubric or checklist to assess against."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ document, focus, rubric }) => {
    const cfg = loadConfig();
    let prompt: string, header: string;
    try {
      const editor = loadInstructions(cfg);
      const chars = document.length + (focus?.length ?? 0) + (rubric?.length ?? 0) + (editor?.text.length ?? 0);
      if (chars > cfg.maxChars) throw tooLarge(chars, cfg);
      prompt = reviewPrompt(document, focus, rubric, editor?.text);
      header = editor ? `Editor instructions: ${editor.name}` : "Editor instructions: none set (built-in reviewer)";
    } catch (e) {
      return reply({ state: "error", message: message(e) }, cfg.waitMs);
    }
    return startAndWait(cfg, async () => `${header}\n\n${(await runCodex(prompt, cfg)).text}`);
  },
);

server.registerTool(
  "chatgpt_ask",
  {
    title: "Ask ChatGPT",
    description:
      "Ask ChatGPT (via the user's Codex CLI / ChatGPT subscription) a question, optionally with context. The text is sent to OpenAI. " +
      "If ChatGPT is still working after about 45s, this returns a job_id: call chatgpt_result with it to get the answer.",
    inputSchema: {
      question: z.string().min(1).describe("The question to ask."),
      context: z.string().optional().describe("Optional supporting text."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ question, context }) => {
    const cfg = loadConfig();
    const chars = question.length + (context?.length ?? 0);
    if (chars > cfg.maxChars) return reply({ state: "error", message: tooLarge(chars, cfg).message }, cfg.waitMs);
    const prompt = askPrompt(question, context);
    return startAndWait(cfg, async () => (await runCodex(prompt, cfg)).text);
  },
);

server.registerTool(
  "chatgpt_result",
  {
    title: "Get a ChatGPT result",
    description: "Collect the answer to a chatgpt_review, chatgpt_ask or chatgpt_check call that returned a job_id. Waits up to about 45s; if ChatGPT is still working, call it again.",
    inputSchema: { job_id: z.string().min(1).describe("The job_id from the earlier call.") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ job_id }) => {
    const cfg = loadConfig();
    return reply(await jobs.settle(job_id.trim(), cfg.waitMs), cfg.waitMs);
  },
);

async function checkSetup(cfg: Config): Promise<string> {
  const lines: string[] = [];
  let ready = true;
  const problem = (e: unknown) => { ready = false; lines.push(`Problem: ${message(e)}`); };
  let bin: string | undefined;
  try { bin = resolveCodex(cfg); lines.push(`OK: Codex found at ${bin}`); } catch (e) { problem(e); }
  if (bin) {
    try { lines.push(`OK: ${await codexVersion(bin)}`); } catch (e) { problem(e); }
  }
  try {
    const editor = loadInstructions(cfg);
    lines.push(editor
      ? `OK: editor instructions loaded from ${editor.name} (${editor.text.length.toLocaleString()} characters).`
      : "Note: no editor instructions file is set, so reviews use the built-in reviewer.");
  } catch (e) { problem(e); }
  lines.push(`Settings: model ${cfg.model ?? "Codex default"}, reasoning effort ${cfg.effort ?? "Codex default"}, timeout ${Math.round(cfg.timeoutMs / 60_000)} min.`);
  if (bin) {
    try {
      const r = await runCodex(CHECK_PROMPT, cfg);
      lines.push(`OK: ChatGPT answered a test question in ${Math.round(r.durationMs / 1000)}s, so sign-in and the read-only sandbox work.`);
    } catch (e) { problem(e); }
  }
  return `${ready ? "Ready: ChatGPT review is set up." : "Not ready: fix the problems below, then run the check again."}\n\n${lines.join("\n")}`;
}

server.registerTool(
  "chatgpt_check",
  {
    title: "Check the ChatGPT setup",
    description: "Check that ChatGPT review is set up: finds Codex, checks the editor instructions file, and sends ChatGPT a one-word test question. Use it after installing, or when a review fails. Returns a job_id if it takes longer than about 45s.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    const cfg = loadConfig();
    return startAndWait(cfg, () => checkSetup(cfg));
  },
);

server.registerPrompt(
  "write_paper",
  {
    title: "Write a paper with ChatGPT as editor",
    description: "Claude drafts the paper, ChatGPT reviews it with your editor instructions, Claude revises, for up to two rounds; you get a Word document and an edit log.",
    argsSchema: {
      brief: z.string().describe("What the paper is about, who it's for, and which attached files to use."),
      rounds: z.string().optional().describe("Number of editor rounds, 1 to 5 (default 2)."),
    },
  },
  ({ brief, rounds }) => ({ messages: [{ role: "user", content: { type: "text", text: paperPrompt(brief, rounds) } }] }),
);

await server.connect(new StdioServerTransport());
