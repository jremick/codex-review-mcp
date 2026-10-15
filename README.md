# ChatGPT Review for Claude

Get a second opinion from ChatGPT without leaving Claude Desktop.

This is a small local [MCP](https://modelcontextprotocol.io) server. It adds two tools to Claude:

| Tool | What it does |
| --- | --- |
| `chatgpt_review(document, focus?, rubric?)` | ChatGPT reviews a document and returns an overall assessment, key issues, suggested rewrites and anything it couldn't assess. |
| `chatgpt_ask(question, context?)` | Ask ChatGPT a question, optionally with supporting text. |

It works through the OpenAI **Codex CLI**, so it uses **your ChatGPT subscription**. You don't need an API key.

Example prompt in Claude: *"Draft the Q4 update, then ask ChatGPT to review it for clarity for executives and fix anything it flags."*

> **Before you use this at work:** everything you send through these tools (the document, focus, rubric, question and context) goes to **OpenAI** and is handled under your ChatGPT account's terms and data settings. Check that your company's AI policy allows sharing that material with OpenAI. If in doubt, don't send confidential, customer or personal data.

## 1. Install and sign in to Codex (one time)

You need Node.js 18 or later.

```sh
npm install -g @openai/codex
codex login          # choose "Sign in with ChatGPT"
codex exec --skip-git-repo-check "say hi"   # quick check
```

## 2. Add it to Claude Desktop

### Option A: extension file (easiest)

1. Download `codex-review-mcp.mcpb` from this repo's **Releases** page.
2. In Claude Desktop, open **Settings → Extensions → Advanced settings → Install Extension…** and choose the file.
   Double-clicking the file also works.
3. Leave **Codex executable** blank unless Claude can't find codex (see Troubleshooting).

### Option B: config file

Open **Settings → Developer → Edit Config**. That opens `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Add the server, then fully quit and reopen Claude.

Until this package is on npm, clone the repo and build it with `npm ci && npm run build`. Then point Claude at it:

**macOS**
```json
{
  "mcpServers": {
    "chatgpt-review": {
      "command": "node",
      "args": ["/Users/YOU/codex-review-mcp/dist/index.js"],
      "env": { "CODEX_PATH": "/opt/homebrew/bin/codex" }
    }
  }
}
```

**Windows**
```json
{
  "mcpServers": {
    "chatgpt-review": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\codex-review-mcp\\dist\\index.js"],
      "env": { "CODEX_PATH": "C:\\Users\\YOU\\AppData\\Roaming\\npm\\codex.cmd" }
    }
  }
}
```

`CODEX_PATH` is optional. Run `which codex` (macOS) or `where codex` (Windows) to find the right value. If Claude says it can't find `node`, use its full path: `/opt/homebrew/bin/node` or `C:\Program Files\nodejs\node.exe`.

## Settings

Set these as environment variables, or in the extension's settings.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CODEX_PATH` | auto-detect | Full path to `codex` (or `codex.cmd` / `codex.exe` on Windows). |
| `CODEX_REVIEW_TIMEOUT_MS` | `300000` (5 min) | How long to wait before giving up. |
| `CODEX_REVIEW_MAX_CHARS` | `200000` | Size cap on what you send, about 50k tokens. |
| `CODEX_REVIEW_MODEL` | Codex default | Use a different model, such as `gpt-5`. |

## Limits

- **Your ChatGPT plan's limits apply.** Each call counts as one Codex task against your plan's Codex usage limits. Heavy use can hit the plan's rate limit, so wait or upgrade the plan.
- **Speed:** a review usually takes 15–60 seconds, and long documents take longer. Calls stop after the timeout.
- **Size:** inputs above `CODEX_REVIEW_MAX_CHARS` are rejected. Send the relevant section instead.
- **Text only.** Claude passes the document as text. Paste or extract text from PDFs, slides and images first.

## Does it work in Claude's Cowork (work) mode?

Short answer: it works in normal Claude Desktop chat. In Cowork, it only works for sessions that **run on your computer**, and new Cowork sessions now run in the cloud by default.

What Anthropic's documentation says (checked October 2026):

- Local MCP servers and `.mcpb` desktop extensions run only in the Claude Desktop app, not on the web or mobile ([When to use desktop and web connectors](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors); [Getting started with local MCP servers](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)).
- Cowork sessions **run in the cloud by default**. "Local MCP servers don't run in sessions in the cloud." Local Cowork sessions, where local MCP servers do load, remain for existing desktop deployments. On Pro and Max, that means only tasks started on the device before 6 October 2026 ([Claude Cowork architecture overview](https://support.claude.com/en/articles/14479288-claude-cowork-architecture-overview)).
- The plugin support table says local MCP servers, including `.mcpb` bundles, "load when the Cowork session runs on your computer" ([Plugin feature support across platforms](https://claude.com/docs/plugins/platform-support)).
- On company-managed Macs and PCs, admins can turn these off with the MDM keys `isLocalDevMcpEnabled` (local MCP servers) and `isDesktopExtensionEnabled` (`.mcpb` extensions) ([Enterprise configuration: MCP, plugins, skills, and hooks](https://claude.com/docs/third-party/claude-desktop/extensions)). If the install option is missing or greyed out, IT has probably disabled it.

**So:** use it from a regular chat in Claude Desktop. To use ChatGPT in cloud Cowork, you'd need a hosted (remote) connector. That would also need its own OpenAI credentials, which this project deliberately avoids.

## Troubleshooting

| Message | Fix |
| --- | --- |
| *Could not find the Codex CLI* | Install it (step 1), or set `CODEX_PATH`. On macOS, apps opened from the Dock don't see your shell `PATH`. The server checks `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin` and `~/.volta/bin`, and on Windows `%APPDATA%\npm`. |
| *Codex is not signed in* | Run `codex login` in a terminal. |
| *did not finish within …s* | Raise `CODEX_REVIEW_TIMEOUT_MS` or send less text. |
| Tools don't appear | Fully quit and restart Claude. Check **Settings → Developer** for server logs. |

## How it works and safety

- Each call runs `codex exec --skip-git-repo-check --sandbox read-only --ephemeral` in a fresh, empty temporary folder. That folder is deleted afterwards, along with the answer file Codex writes there (`--output-last-message`). The reviewer prompt also tells ChatGPT not to run commands or edit files.
- The document goes to Codex on **stdin**, never on the command line. Processes start **without a shell**, so document text can't be interpreted as commands. On Windows, the server runs the `codex.exe` that npm installs behind its `codex.cmd` wrapper. If it can't find that file, it falls back to `cmd.exe` with only fixed, validated arguments.
- `--ephemeral` means Codex doesn't save the session on disk. OpenAI still receives and processes the content.

## Development

```sh
npm ci
npm test            # unit + MCP protocol tests with a fake codex (no network)
npm run e2e         # real review through your logged-in codex
npm run pack:mcpb   # builds codex-review-mcp.mcpb
```

CI runs the tests on Ubuntu, macOS and Windows. Pushing a `v*` tag builds the `.mcpb` and attaches it to a GitHub release.

MIT licence.
