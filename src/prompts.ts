const RULES = `You are acting as an independent reviewer for a colleague using a different AI assistant.
Do not run commands, edit files or browse; answer from the material below only.`;

const VERDICT = `End your answer with a final line that is exactly "VERDICT: READY" if no material edits remain, or "VERDICT: REVISE" otherwise.`;

export function reviewPrompt(document: string, focus?: string, rubric?: string, editor?: string): string {
  const how = editor
    ? `Review the document between the DOCUMENT markers as the editor described in the EDITOR INSTRUCTIONS.
Follow those instructions, including any output format they set. If they don't set one, return a numbered list of
specific edits, each naming the section or paragraph and quoting the passage it applies to. Do not rewrite the whole document.

<<<EDITOR INSTRUCTIONS
${editor}
EDITOR INSTRUCTIONS>>>`
    : `Review the document between the markers. Be specific and candid, and quote the passages you comment on.
Structure your answer as:
1. Overall assessment (2-3 sentences)
2. Key issues, most important first (accuracy, logic, gaps, risks)
3. Suggested improvements (concrete rewrites where useful)
4. Anything you could not assess`;
  return `${RULES}

${how}
${focus ? `\nFocus especially on: ${focus}` : ""}${rubric ? `\nScore or assess it against this rubric:\n${rubric}` : ""}

${VERDICT}

<<<DOCUMENT
${document}
DOCUMENT>>>`;
}

export function askPrompt(question: string, context?: string): string {
  return `${RULES}

Answer the question clearly and concisely.${context ? `\n\n<<<CONTEXT\n${context}\nCONTEXT>>>` : ""}

Question: ${question}`;
}

export const CHECK_PROMPT = "Reply with exactly the word OK and nothing else.";

/** The draft → ChatGPT edit → revise loop, as a prompt the user picks in Claude. */
export function paperPrompt(brief: string, rounds?: string): string {
  const n = Math.min(5, Math.max(1, Number.parseInt(rounds ?? "", 10) || 2));
  return `Write a paper for me, have ChatGPT edit it, and give me the final Word document.

Brief: ${brief.trim() || "(none given: ask me what the paper is about and which sources to use, then continue)"}

Work through these steps without stopping to check in, unless a step says to ask me.

1. Draft. Write the paper from the brief and any files I've attached or named. Follow my writing instructions (my writing skill, or this project's instructions) if I have them. Use only facts from the brief and the sources. Where a fact is missing, write [CHECK: what is needed] instead of guessing.

2. Editor rounds. Run up to ${n} round${n === 1 ? "" : "s"}. In each round:
   a. Call chatgpt_review with the full current draft as the document. If it says ChatGPT is still working, call chatgpt_result with the job_id it gives, and repeat until the review arrives.
   b. Apply each edit that improves the paper and keeps to my writing instructions. Decline an edit that breaks them or changes a fact, and note why.
   c. If the review's last line is VERDICT: READY, skip any remaining rounds.
   If a review fails, stop the rounds, keep the latest draft and tell me the error. Never skip a review or write one yourself.

3. Final document. Create a Word document (.docx) of the final paper. If you can't create a .docx here, give me the final paper as Markdown and say why.

4. Report, in under 150 words: the rounds run; for each round, the edits applied and the edits declined, with a one-line reason for each decline; and every remaining [CHECK: ...] item. Don't paste the whole paper into the chat when the .docx exists.`;
}
