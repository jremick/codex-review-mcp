# ChatGPT Review for Claude

Have ChatGPT review Claude's drafts as your editor, without leaving Claude Desktop.

## Quick start

About 10 minutes, once, on your computer (Windows or Mac):

1. **Install Codex and sign in** with your ChatGPT account. [Step 1](#1-install-codex-and-sign-in).
2. **Install the extension** in Claude Desktop. [Step 2](#2-install-the-extension).
3. **Save your editor instructions as a file** and choose it in the extension's settings. [Step 3](#3-add-your-editor-instructions).
4. **Ask Claude to "check my ChatGPT setup"**. It should say *Ready*. [Step 4](#4-check-it-works).

## What it does

The extension adds these to Claude Desktop:

| Name | What it does |
| --- | --- |
| **Write a paper with ChatGPT as editor** (prompt) | Claude drafts the paper, ChatGPT reviews it with your editor instructions, and Claude revises. This repeats for up to two rounds, or stops early when ChatGPT says the paper is ready. You get a Word document and a log of which edits Claude applied or declined, and why. |
| `chatgpt_review` | ChatGPT reviews one document. If you've set an editor instructions file, it reviews as that editor. Each review ends with `VERDICT: READY` or `VERDICT: REVISE`. |
| `chatgpt_ask` | Ask ChatGPT a question, optionally with supporting text. |
| `chatgpt_result` | Collects a long review. See [Long reviews](#long-reviews). |
| `chatgpt_check` | Checks that Codex is installed and signed in, and that your editor instructions file loads. |

It works through the OpenAI **Codex CLI**, so it uses **your ChatGPT subscription**. You don't need an API key.

> **Before you use this at work:** everything you send through these tools (the document, your editor instructions, the focus, rubric, question and context) goes to **OpenAI** and is handled under your ChatGPT account's terms and data settings. Sign in to Codex with your company's ChatGPT workspace account, and check that your company's AI policy allows sharing that material with OpenAI. If in doubt, don't send confidential, customer or personal data.

## Setup

### 1. Install Codex and sign in

**Windows:** open PowerShell (Start menu → type *PowerShell*) and paste:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
```

**Mac:** open Terminal and paste:

```sh
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Those are OpenAI's official installers. If you already have Node.js, `npm install -g @openai/codex` also works.

Then, in a **new** PowerShell or Terminal window, sign in:

```sh
codex login
```

Choose **Sign in with ChatGPT**. For work documents, use your company's ChatGPT workspace account so its data settings apply. You only do this once.

### 2. Install the extension

1. Download [codex-review-mcp.mcpb](https://github.com/jremick/codex-review-mcp/releases/latest/download/codex-review-mcp.mcpb).
2. Double-click the file, or in Claude Desktop open **Settings → Extensions → Advanced settings → Install Extension…** and choose it.
3. Claude asks you to confirm and shows the extension's settings. You'll fill in the editor instructions file in the next step.

You don't need to install Node.js. Claude Desktop runs the extension with its own built-in copy.

### 3. Add your editor instructions

ChatGPT reviews as *your* editor when you give it your editor instructions.

1. Copy the instructions from your ChatGPT editor skill, or from the custom GPT or project you use for editing.
2. Paste them into a plain text file and save it somewhere permanent, for example `Documents\ChatGPT editor.md`. A `SKILL.md` file works as it is. The `---` header block at the top is ignored. If you don't have editor instructions yet, start from [the example](examples/editor-instructions.example.md).
3. In Claude Desktop, open **Settings → Extensions → ChatGPT Review (via Codex) → Configure**. Set **Editor instructions file** to that file and save.

The file is read for every review, so you can edit it at any time without reinstalling. If you leave the setting blank, ChatGPT uses a general-purpose reviewer.

### 4. Check it works

In a new Claude chat, type: **Check my ChatGPT setup.**

Claude runs `chatgpt_check`, which sends ChatGPT a one-word test question. You should see *Ready* and the name of your editor instructions file. If you see *Not ready*, the message says what to fix. See also [Troubleshooting](#troubleshooting).

## Using it

**Write a paper.** In a new chat, click **+**, choose **Write a paper with ChatGPT as editor**, and fill in the brief. For example: *"A two-page proposal to move the team to fortnightly releases, for the leadership team. Use the attached notes."* Attach any source files to the chat. To change the number of editor rounds, fill in **rounds**, from 1 to 5.

If the **+** menu doesn't show it, type the request instead: *"Write a two-page proposal on … using the attached notes. Have ChatGPT review it with chatgpt_review, apply the edits you agree with, do two rounds, then give me a Word document and a log of the edits."*

To get the Word document, Claude needs file creation turned on in Claude's settings (under Capabilities). Without it, Claude gives you the final paper as text.

If you have a Claude writing skill or project instructions, Claude follows them when drafting and when deciding which edits to accept.

**Review a draft you already have.** Paste it or attach it and say: *"Ask ChatGPT to review this."*

## Long reviews

Claude Desktop stops waiting for a tool after about a minute. Long reviews take longer than that, so each tool waits up to 45 seconds. If ChatGPT is still working, the tool replies with a job ID, and Claude collects the review with `chatgpt_result`. This happens automatically, and you'll see Claude make a second call.

## Settings

Set these in the extension's settings, or as environment variables if you use the config-file setup.

| Setting | Variable | Default | Meaning |
| --- | --- | --- | --- |
| Editor instructions file | `CODEX_REVIEW_INSTRUCTIONS` | none | Your editor instructions. ChatGPT reviews as that editor. |
| Reasoning effort | `CODEX_REVIEW_EFFORT` | `medium` | `low`, `medium`, `high` or `xhigh`. Higher is slower and more thorough. `default` uses your Codex setting. |
| Codex executable | `CODEX_PATH` | auto-detect | Full path to `codex`, `codex.exe` or `codex.cmd`. |
| Timeout (ms) | `CODEX_REVIEW_TIMEOUT_MS` | `600000` (10 min) | Longest one review may run. |
| Model | `CODEX_REVIEW_MODEL` | Codex default | Use a different model. |
| (variable only) | `CODEX_REVIEW_WAIT_MS` | `45000` | How long a tool waits before returning a job ID. |
| (variable only) | `CODEX_REVIEW_MAX_CHARS` | `200000` | Size cap on what you send, about 50k tokens. Includes the editor instructions. |

## Limits

- **Your ChatGPT plan's limits apply.** Each review counts as one Codex task against your plan's Codex usage limits. Heavy use can hit the plan's rate limit, so wait or ask for a higher plan.
- **Speed:** a short review takes about 20–60 seconds, and a long paper can take a few minutes.
- **Size:** inputs above the size cap are rejected. Send the relevant section instead.
- **Text only.** Claude passes the document as text. It reads attached Word and PDF files first.

## Does it work in Claude's Cowork mode?

It works in normal Claude Desktop chats. In Cowork, it only works for sessions that **run on your computer**, and new Cowork sessions run in the cloud by default.

What Anthropic's documentation says (checked October 2026):

- Local MCP servers and `.mcpb` desktop extensions run only in the Claude Desktop app, not on the web or mobile ([When to use desktop and web connectors](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors); [Getting started with local MCP servers](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)).
- Cowork sessions run in the cloud by default, and local MCP servers don't run there ([Claude Cowork architecture overview](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)).
- Local MCP servers, including `.mcpb` bundles, "load when the Cowork session runs on your computer" ([Plugin feature support across platforms](https://claude.com/docs/plugins/platform-support)).
- On company-managed PCs, IT can turn off local MCP servers and extensions (`isLocalDevMcpEnabled`, `isDesktopExtensionEnabled`) ([Enterprise configuration](https://claude.com/docs/third-party/claude-desktop/extensions)). If the install option is missing or greyed out, ask IT.

## Troubleshooting

| Message | Fix |
| --- | --- |
| *Could not find the Codex CLI* | Do [step 1](#1-install-codex-and-sign-in), then fully quit and reopen Claude. If it still fails, set **Codex executable** to its full path. Run `where codex` (Windows) or `which codex` (Mac) to find it. The standalone Windows installer puts it in `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`. |
| *Codex is not signed in* | Run `codex login` in PowerShell or Terminal. |
| *Codex couldn't start its read-only sandbox* | Open the ChatGPT app in Codex mode, or run `codex` in PowerShell, and give it any small task once. That finishes Codex's setup. Then try again. |
| *The model Codex is set to use isn't available with your ChatGPT sign-in* | Codex's own settings ask for a model your plan doesn't offer. Set the extension's **Model** setting to one it does, or change `model` in your Codex `config.toml`. Updating Codex can also help. |
| *Codex couldn't load its own settings* | A file in your `.codex` folder has an error, and Codex fails outside Claude too. The message names the file and line. A common cause on Windows is a path written with single backslashes (`C:\Users\…`) inside quotes in `.codex\rules\default.rules`; change them to forward slashes (`C:/Users/…`). |
| *The editor instructions file … can't be read* or *is empty* | Fix the path in the extension's settings, or fill in the file. |
| *did not finish within …* | Raise **Timeout**, lower **Reasoning effort**, or send less text. |
| Tools or the prompt don't appear | Fully quit and restart Claude. Check **Settings → Extensions** that the extension is on. |

## How it works and safety

- Each call runs `codex exec --skip-git-repo-check --sandbox read-only --ephemeral` in a fresh, empty temporary folder. That folder is deleted afterwards, along with the answer file Codex writes there (`--output-last-message`). The prompt tells ChatGPT not to run commands or edit files, and your editor instructions are included in the prompt text, so Codex doesn't need to open any files.
- The document goes to Codex on **stdin**, never on the command line. Processes start **without a shell**, so document text can't be interpreted as commands. On Windows, the server runs the `codex.exe` that npm installs behind its `codex.cmd` wrapper. If it can't find that file, it falls back to `cmd.exe` with only fixed, validated arguments.
- `--ephemeral` means Codex doesn't save the session on disk. OpenAI still receives and processes the content.
- Long jobs live only in the extension's memory. Finished results are kept for an hour so Claude can collect them, and are lost if Claude restarts.

## Config-file setup (developers)

Instead of the `.mcpb`, you can clone the repo, run `npm ci && npm run build`, then add the server in **Settings → Developer → Edit Config**:

```json
{
  "mcpServers": {
    "chatgpt-review": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\codex-review-mcp\\dist\\index.js"],
      "env": { "CODEX_REVIEW_INSTRUCTIONS": "C:\\Users\\YOU\\Documents\\ChatGPT editor.md" }
    }
  }
}
```

## Development

```sh
npm ci
npm test            # unit + MCP protocol tests with a fake codex (no network)
npm run e2e         # real review through your logged-in codex
npm run pack:mcpb   # builds codex-review-mcp.mcpb
```

CI runs the tests on Ubuntu, macOS and Windows. Pushing a `v*` tag builds the `.mcpb` and attaches it to a GitHub release.

MIT licence.
