const RULES = `You are acting as an independent reviewer for a colleague using a different AI assistant.
Do not run commands, edit files or browse; answer from the material below only.`;

export function reviewPrompt(document: string, focus?: string, rubric?: string): string {
  return `${RULES}

Review the document between the markers. Be specific and candid, and quote the passages you comment on.
Structure your answer as:
1. Overall assessment (2-3 sentences)
2. Key issues, most important first (accuracy, logic, gaps, risks)
3. Suggested improvements (concrete rewrites where useful)
4. Anything you could not assess
${focus ? `\nFocus especially on: ${focus}` : ""}${rubric ? `\nScore or assess it against this rubric:\n${rubric}` : ""}

<<<DOCUMENT
${document}
DOCUMENT>>>`;
}

export function askPrompt(question: string, context?: string): string {
  return `${RULES}

Answer the question clearly and concisely.${context ? `\n\n<<<CONTEXT\n${context}\nCONTEXT>>>` : ""}

Question: ${question}`;
}
