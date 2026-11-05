# Bytos

<p align="center">
  <img src="https://raw.githubusercontent.com/Balahurra/Bytos/main/assets/branding/bytos-app-icon.png" width="96" alt="Bytos" />
</p>

Bytos is an open-source AI coding agent that runs **inside Visual Studio Code**.
It reads your workspace, plans a change, edits files, runs commands, drives a
browser, and calls MCP tools - and it asks before each of those things unless you
explicitly auto-approve them.

Bytos is **chat-first and bring-your-own-key**. There is no Bytos account,
subscription, credit balance, or Bytos backend in this build: you connect the
model provider you already pay for.

<p align="center">
  <img src="https://raw.githubusercontent.com/Balahurra/Bytos/main/assets/docs/demo.gif" alt="Bytos chat-first agent inside Visual Studio Code" width="820" />
</p>

> **Requirements**
>
> - **VS Code 1.101.0 or newer** (`engines.vscode` is `^1.101.0`).
> - **Your own model provider API key.**

## Quick start

1. Install the extension and open the Bytos view in the activity bar.
2. Open **Settings > API Configuration**.
3. Choose a provider, paste your API key, and select a model.
4. Describe a task in the chat box.

Your key is written to VS Code SecretStorage, never to a plaintext settings file,
and is never sent to the webview - the UI only receives a length-based mask.

## What it does

1. Describe a task in the Bytos view. You can attach images, files, folders,
   workspace problems, and URLs.
2. Bytos reads your file tree, searches the code, and pulls in only the files it
   needs, so large repositories do not flood the context window.
3. It plans, and with your approval:
   - creates and edits files, showing a diff you can review;
   - runs commands in a VS Code terminal and reads their output;
   - for web work, opens a page in a browser, clicks, types, scrolls, and
     captures screenshots and console logs;
   - calls MCP servers you have configured;
   - uses hooks, skills, and worktrees when you enable them.
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

## Auto Phase

Auto Phase is sequential multi-phase orchestration. You define a plan of up to ten
phases, and Bytos runs them one after another; each phase is its own Act-mode
task:

- each phase has its own prompt, provider, model, attachments, and MCP server
  allowlist;
- the plan is saved in extension state, and phase API keys are stored in VS Code
  SecretStorage;
- each phase can receive the previous phase's short completion report as context;
- when a phase fails or reports `BLOCKED` / `FAILED`, you can stop the run,
  continue with the next phase automatically, or be asked each time;
- every run writes a detailed Markdown report to
  `.bytos/auto-phase-reports/<run-id>/report.md`, and the chat shows a short
  summary with a link to that report;
- an optional AI-generated final summary is available and off by default;
- starting Auto Phase shows a confirmation warning, and you can stop the run at
  any time;
- phases are sequential, not parallel.

Auto Phase is opt-in. Normal chat does not use it.

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

## Feature status

Available in this release:

- chat-first agent workflow with plan/act modes and per-tool approval;
- multi-provider BYOK model configuration;
- file editing with diffs, terminal execution, browser automation, and MCP tools;
- hooks, skills, worktrees, checkpoints, and task history;
- sequential Auto Phase plans with per-phase settings;
- opt-in telemetry, disabled by default.

Not part of this extension package:

- the CLI, hub, desktop, and example applications in the repository;
- any Bytos account, subscription, or hosted backend;
- an OpenCode runtime or CLI dependency.

The CLI, hub, desktop, and example directories are workspace sources kept for
development. They are not packaged in the VSIX and are not distributed through
this listing.

## Support

- **Bugs and feature requests:** https://github.com/Balahurra/Bytos/issues
- **Security reports:** https://github.com/Balahurra/Bytos/security/advisories/new (see SECURITY.md)

## License and attribution

Bytos is licensed under the [Apache License 2.0](https://github.com/Balahurra/Bytos/blob/main/LICENSE). Bytos includes software derived from [Cline](https://github.com/cline/cline), Copyright 2026 Cline Bot Inc., licensed under the Apache License 2.0. The upstream copyright notice is preserved in LICENSE and described in NOTICE. Every bundled dependency, its declared license, license text, and copyright notice is listed in [THIRD-PARTY-NOTICES.txt](https://github.com/Balahurra/Bytos/blob/main/apps/vscode/THIRD-PARTY-NOTICES.txt). The Bytos name and logo are covered by [TRADEMARKS.md](https://github.com/Balahurra/Bytos/blob/main/TRADEMARKS.md).

Bytos is an independent project. It is not endorsed by, sponsored by, or affiliated with the Cline project or its maintainers.
