# Bytos

<p align="center">
  <img src="https://raw.githubusercontent.com/bytos/bytos/main/assets/branding/bytos-app-icon.png" width="96" alt="Bytos" />
</p>
<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://github.com/Balahurra/Bytos" target="_blank"><strong>Source code</strong></a>
</td>
<td align="center">
<a href="https://github.com/Balahurra/Bytos/discussions" target="_blank"><strong>Discussions</strong></a>
</td>
<td align="center">
<a href="https://github.com/Balahurra/Bytos/issues" target="_blank"><strong>Report an issue</strong></a>
</td>
<td align="center">
<a href="https://github.com/Balahurra/Bytos/security/advisories/new" target="_blank"><strong>Report a vulnerability</strong></a>
</td>
</tbody>
</table>
</div>

Bytos is an open-source coding agent that runs **inside VS Code**. It reads your
workspace, plans a change, edits files, runs commands, drives a browser, and calls
MCP tools - and it asks before each of those things unless you explicitly
auto-approve them.

> **Requirements**
>
> - **VS Code 1.101.0 or newer** (`engines.vscode` is `^1.101.0`).
> - **Your own model provider API key.** This build is free and
>   bring-your-own-key: there is no Bytos account, subscription, credit balance,
>   or Bytos backend.

## What it does

1. Describe a task in the Bytos view in the activity bar. You can attach images
   (mockups, screenshots) and files.
2. Bytos reads your file tree, searches the code, and pulls in only the files it
   needs, so large repositories do not flood the context window.
3. It then plans, and with your approval:
   - creates and edits files, reviewing diffs in the editor and reacting to
     linter/compiler errors;
   - runs commands in a VS Code terminal and reads their output;
   - for web work, opens the site in a browser, clicks, types, scrolls, and
     captures screenshots and console logs;
   - calls MCP servers you have configured.
4. Every change is recorded in your files' Timeline, and each step of a task has a
   checkpoint you can compare against or restore.

## Providers and models

Bytos talks to providers directly with your key. Supported integrations include
OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex,
Cerebras, and Groq, plus any OpenAI-compatible endpoint and local models through
Ollama or LM Studio. Token usage and estimated cost are tracked per request and
per task.

If you already hold a Cline API key, the **ClinePass** compatibility provider
calls Cline's hosted API directly (`https://api.cline.bot/api/v1`) so you can keep
that key and billing relationship. Cline's pricing and terms apply; this is a
compatibility provider, not a Bytos subscription.

## Permissions and data handling

- **Fail-closed by default.** File reads, edits, terminal commands, browser
  access, MCP tools, and skills each require approval until you enable that
  category. Auto-approval is opt-in and per category.
- **Keys stay in the OS credential store.** Provider API keys are written to VS
  Code SecretStorage, never to a plaintext settings file, and are never sent to
  the webview - the UI only ever receives a length-based mask.
- **Telemetry is off by default.** It is enabled only by an explicit opt-in in
  Settings - General, and disabling it stops PostHog events and feature flags.
- **No Bytos backend.** Model requests go from your machine to the provider you
  picked.

The full data map - what is stored locally, what is sent to which provider, and
how to delete it - is in
[PRIVACY.md](https://github.com/Balahurra/Bytos/blob/main/apps/vscode/PRIVACY.md).

## Feature details

### Use any API and Model

Any provider in the list below works with a key you own: OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras, Groq, any OpenAI-compatible endpoint, and local models through Ollama or LM Studio. With OpenRouter, Bytos reads their live model list so new models appear as soon as they are published. If you already have a Cline API key, pick **ClinePass** to call Cline's hosted API directly; Cline's pricing and terms apply.

Token counts and estimated cost are tracked for every request and for the whole task, so you can see spend as it happens.

You pay your provider directly. There is no Bytos account, subscription, or Bytos backend in this build.

<!-- Transparent pixel to create line break after floating image -->

<br>



### Run Commands in Terminal

Bytos can execute commands and receive their output to install packages, run build scripts, deploy applications, manage databases, and run tests, all while adapting to your dev environment & toolchain to get the job done right.

By default, commands run in a visible VS Code terminal, using the [shell integration API introduced in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api) to stream output as commands run and let you watch or interact with them directly. You can switch to running commands in a background process instead (Settings > Terminal > Terminal Execution Mode).

<!-- Transparent pixel to create line break after floating image -->

<br>



### Create and Edit Files

Bytos can create and edit files directly in your editor, presenting you a diff view of the changes. You can edit or revert Bytos's changes directly in the diff view editor, or provide feedback in chat until you're satisfied with the result. Bytos also monitors linter/compiler errors (missing imports, syntax errors, etc.) so he can fix issues that come up along the way on his own.

All changes made by Bytos are recorded in your file's Timeline, providing an easy way to track and revert modifications if needed.

<!-- Transparent pixel to create line break after floating image -->

<br>



### Use the Browser

With Claude Sonnet's new [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) capability, Bytos can launch a browser, click elements, type text, and scroll, capturing screenshots and console logs at each step. This allows for interactive debugging, end-to-end testing, and even general web use! This gives him autonomy to fixing visual bugs and runtime issues without you needing to handhold and copy-pasting error logs yourself.

Try asking Bytos to "test the app", and watch as he runs a command like `npm run dev`, launches your locally running dev server in a browser, and performs a series of tests to confirm that everything works. [See a demo here.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<br>



### "add a tool that..."

Thanks to the [Model Context Protocol](https://github.com/modelcontextprotocol), Bytos can extend his capabilities through custom tools. While you can use [community-made servers](https://github.com/modelcontextprotocol/servers), Bytos can instead create and install tools tailored to your specific workflow. Just ask Bytos to "add a tool" and he will handle everything, from creating a new MCP server to installing it into the extension. These custom tools then become part of Bytos's toolkit, ready to use in future tasks.

-   "add a tool that fetches Jira tickets": Retrieve ticket ACs and put Bytos to work
-   "add a tool that manages AWS EC2s": Check server metrics and scale instances up or down
-   "add a tool that pulls the latest PagerDuty incidents": Fetch details and ask Bytos to fix bugs

<!-- Transparent pixel to create line break after floating image -->

<br>



### Add Context

**`@url`:** Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Bytos the latest docs

**`@problems`:** Add workspace errors and warnings ('Problems' panel) for Bytos to fix

**`@file`:** Adds a file's contents so you don't have to waste API requests approving read file (+ type to search files)

**`@folder`:** Adds folder's files all at once to speed up your workflow even more

<!-- Transparent pixel to create line break after floating image -->

<br>



### Checkpoints: Compare and Restore

As Bytos works through a task, the extension takes a snapshot of your workspace at each step. You can use the 'Compare' button to see a diff between the snapshot and your current workspace, and the 'Restore' button to roll back to that point.

For example, when working with a local web server, you can use 'Restore Workspace Only' to quickly test different versions of your app, then use 'Restore Task and Workspace' when you find the version you want to continue building from. This lets you safely explore different approaches without losing progress.

<!-- Transparent pixel to create line break after floating image -->

<br>

## Support and contact

- **Bugs and feature requests:** https://github.com/Balahurra/Bytos/issues
- **Questions and community:** https://github.com/Balahurra/Bytos/discussions
- **Security reports:** https://github.com/Balahurra/Bytos/security/advisories/new (see SECURITY.md)

## Enterprise

Get the same Bytos experience with enterprise-grade controls: SSO (SAML/OIDC), global policies and configuration, observability with audit trails, private networking (VPC/private link), and self-hosted or on-prem deployments, and enterprise support. Learn more at our [enterprise page](https://bytos.dev/enterprise) or [talk to us](https://bytos.dev/contact-sales).

## License and attribution

Bytos is licensed under the [Apache License 2.0](https://github.com/Balahurra/Bytos/blob/main/LICENSE). Bytos includes software derived from [Cline](https://github.com/cline/cline), Copyright 2026 Cline Bot Inc., licensed under the Apache License 2.0. The upstream copyright notice is preserved in LICENSE and described in NOTICE. Every bundled dependency, its declared license, license text, and copyright notice is listed in [THIRD-PARTY-NOTICES.txt](https://github.com/Balahurra/Bytos/blob/main/apps/vscode/THIRD-PARTY-NOTICES.txt). The Bytos name and logo are covered by [TRADEMARKS.md](https://github.com/Balahurra/Bytos/blob/main/TRADEMARKS.md).

Bytos is an independent project. It is not endorsed by, sponsored by, or affiliated with the Cline project or its maintainers.
