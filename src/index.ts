#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CodexError, loadConfig, runCodex } from "./codex.js";
import { askPrompt, reviewPrompt } from "./prompts.js";

const server = new McpServer({ name: "codex-review-mcp", version: "0.1.0" });

async function call(prompt: string, inputChars: number) {
  const cfg = loadConfig();
  try {
    if (inputChars > cfg.maxChars) throw new CodexError(`Input is ${inputChars.toLocaleString()} characters; the limit is ${cfg.maxChars.toLocaleString()} (CODEX_REVIEW_MAX_CHARS). Send a shorter excerpt.`, "TOO_LARGE");
    const r = await runCodex(prompt, cfg);
    return { content: [{ type: "text" as const, text: r.text }] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { isError: true, content: [{ type: "text" as const, text: `ChatGPT review failed: ${msg}` }] };
  }
}

server.registerTool(
  "chatgpt_review",
  {
    title: "Review a document with ChatGPT",
    description: "Send a document to ChatGPT (via the user's Codex CLI / ChatGPT subscription) for an independent second-opinion review. The document text is sent to OpenAI. Takes 30s to a few minutes.",
    inputSchema: {
      document: z.string().min(1).describe("Full text of the document to review (Markdown or plain text)."),
      focus: z.string().optional().describe("What to focus on, e.g. 'clarity for executives' or 'factual accuracy'."),
      rubric: z.string().optional().describe("Optional rubric or checklist to assess against."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ document, focus, rubric }) => call(reviewPrompt(document, focus, rubric), document.length + (focus?.length ?? 0) + (rubric?.length ?? 0)),
);

server.registerTool(
  "chatgpt_ask",
  {
    title: "Ask ChatGPT",
    description: "Ask ChatGPT (via the user's Codex CLI / ChatGPT subscription) a question, optionally with context. The text is sent to OpenAI.",
    inputSchema: {
      question: z.string().min(1).describe("The question to ask."),
      context: z.string().optional().describe("Optional supporting text."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ question, context }) => call(askPrompt(question, context), question.length + (context?.length ?? 0)),
);

await server.connect(new StdioServerTransport());
