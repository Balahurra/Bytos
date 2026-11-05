<p align="center">
  <img src="assets/branding/bytos-app-icon.svg" width="96" height="96" alt="Bytos" />
</p>

<h1 align="center">Bytos</h1>

<p align="center">
  <strong>Open-source AI coding agent for Visual Studio Code.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-4F8CFF.svg" /></a>
  <a href="https://github.com/Balahurra/Bytos/actions/workflows/ext-vscode-test.yml"><img alt="Extension CI" src="https://github.com/Balahurra/Bytos/actions/workflows/ext-vscode-test.yml/badge.svg" /></a>
  <a href="apps/vscode/package.json"><img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-1.101%2B-22D3EE.svg" /></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg" />
</p>

<p align="center">
  <a href="docs/">Documentation</a> |
  <a href="CONTRIBUTING.md">Contributing</a> |
  <a href="SECURITY.md">Security</a> |
  <a href="https://github.com/Balahurra/Bytos/issues">Issues</a>
</p>

---

<p align="center">
  <img src="assets/docs/demo.gif" alt="Bytos running inside Visual Studio Code" width="820" />
</p>

Bytos is a chat-first AI coding agent for Visual Studio Code. It plans before it
edits, asks before it acts, and keeps you in control at every step. It reads your
repository, writes and refactors code, runs commands, browses the web, and calls
MCP tools with your approval.

This release is a free, **bring-your-own-key (BYOK)** build. There is no Bytos
account, subscription, or hosted backend: you connect the model provider you
already pay for. API keys are stored in VS Code SecretStorage, never in a
plaintext settings file, and are never sent to the webview.

## Why Bytos

- **Plan first, then execute.** Bytos breaks work into steps, shows the plan, and
  checks in before risky actions.
- **Whole-repository context.** File tree, symbols, diagnostics, terminal output,
  browser state, and MCP tools in one loop.
- **Fail-closed approval by default.** File reads, edits, terminal commands,
  browser access, and MCP tools require your explicit approval until you enable
  that category. Auto-approval is opt-in.
- **Bring your own key.** OpenRouter, Anthropic, OpenAI, Google Gemini, AWS
  Bedrock, Azure, GCP Vertex, Cerebras, Groq, any OpenAI-compatible endpoint, and
  local models through Ollama or LM Studio.
- **Sequential Auto Phase plans.** Define up to ten phases, each with its own
  provider, model, prompt, attachments, and MCP allowlist. Phases run one after
  another - not in parallel.
- **Extensible.** MCP servers, hooks, skills, worktrees, checkpoints, and a typed
  SDK.

## What is in this repository

Bytos is distributed as a **Visual Studio Code extension**. Only `apps/vscode`
is packaged for the Marketplace.

| Component | Path | Distribution |
| --- | --- | --- |
| **VS Code extension** | `apps/vscode` | **The product.** Build the VSIX with `node scripts/package-release.mjs` (Marketplace listing pending) |
| Agent core | `sdk/packages` | Internal engine used by the extension; not published to npm yet |
| CLI, hub, desktop, examples | `apps/cli`, `apps/bytos-hub`, `apps/examples` | Workspace sources kept for development; **not included in the VSIX and not distributed in this release** |

The packaged extension contains no CLI binary and no OpenCode runtime or CLI
integration.

## Install

The Marketplace listing is pending. Until it is published, install the verified
VSIX from a release artifact or build it from source:

```bash
bun install
cd apps/vscode
node scripts/package-release.mjs
code --install-extension ../../bytos-1.0.1.vsix
```

Then open the Bytos view in the activity bar.

### Configure a provider

1. Open **Settings > API Configuration**.
2. Choose a provider and paste your API key.
3. Select a model.

Your key is written to VS Code SecretStorage. The webview only receives a
length-based mask and a configured/not-configured status.

### Use the agent

Describe a task in the chat box. Bytos proposes a plan, reads the files it needs,
and asks before it edits files, runs commands, opens a browser, or calls an MCP
tool. You can review diffs, stop a task, compare checkpoints, and restore the
workspace to an earlier step.

## Auto Phase

Auto Phase is sequential multi-phase orchestration, not a parallel multi-agent
system. Open the mode selector in the chat input and choose **Auto Phase**:

- up to ten phases run in order; each phase is its own Act-mode task;
- every phase has its own prompt, provider, model, attachments, and MCP server
  allowlist;
- the plan is stored in extension state and phase API keys are stored in VS Code
  SecretStorage;
- each phase can receive the previous phase's short completion report as context;
- when a phase fails or reports `BLOCKED` / `FAILED`, the run can stop, continue
  with the next phase automatically, or ask you each time;
- every run writes a detailed Markdown report to
  `.bytos/auto-phase-reports/<run-id>/report.md`, and the chat shows a short
  summary with a link to that report;
- an optional AI-generated final summary is available and off by default;
- starting a run shows a confirmation warning, and the run can be stopped at any
  time.

## Feature status

Available in this release:

- chat-first agent workflow with plan/act modes and per-tool approval;
- multi-provider BYOK model configuration;
- file editing with diffs, terminal execution, browser automation, and MCP tools;
- hooks, skills, worktrees, checkpoints, and task history;
- sequential Auto Phase plans with per-phase settings;
- opt-in telemetry, disabled by default.

Not shipped in this release:

- Marketplace publication (preparation is complete; the listing is pending);
- CLI, hub, desktop, and example applications;
- any Bytos account, subscription, or hosted backend;
- SDK publication to npm.

## Security and privacy

- **Telemetry is off by default.** It is enabled only by an explicit opt-in in
  Settings > General. Disabling it stops PostHog events and feature flags.
- **No Bytos backend.** Model requests go from your machine to the provider you
  picked.
- **Fail-closed permissions.** Reads, edits, terminal commands, browser access,
  MCP tools, and unknown tools require approval by default.
- **Workspace boundaries.** File tools enforce a canonical workspace boundary,
  including absolute paths, traversal, Windows drive/UNC paths, and symlinks.

Read [SECURITY.md](SECURITY.md) to report a vulnerability and
[apps/vscode/PRIVACY.md](apps/vscode/PRIVACY.md) for the full data map.

## Development

Requirements: **Bun 1.4.2** and **Node.js 22+**.

```bash
bun install
bun run build:sdk                         # build the shared SDK packages
bun run types                             # typecheck every workspace
bun run test                              # unit and integration tests
bun run lint                              # Biome
cd apps/vscode
bun run test:e2e                          # Playwright end-to-end tests
node scripts/package-release.mjs          # reproducible VSIX build
```

Useful entry points:

```bash
bun run cli            # terminal UI in development mode (not distributed)
bun run code           # VS Code extension in development mode
bun run build          # build the SDK and CLI (CLI is not packaged)
```

## Repository conventions

- **Bun workspaces** for every package; no npm or yarn lockfiles.
- **Biome** for formatting and linting.
- **Vitest** and Bun's test runner for unit tests, Playwright for end-to-end tests.
- **Typed protobuf** for host/webview messages.
- **Conventional commits** and a green `bun run check` before opening a PR.

## Brand and license

Bytos is licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) and
[NOTICE](NOTICE).

Bytos includes software derived from the [Cline](https://github.com/cline/cline)
open-source project, Copyright 2026 Cline Bot Inc., licensed under the Apache
License 2.0. The upstream copyright notice is preserved in [LICENSE](LICENSE);
[NOTICE](NOTICE) explains the relationship and disclaims affiliation; files
acquired from Cline and then modified by Bytos carry a
`Copyright 2026 Cline Bot Inc. | Bytos modifications` header. Every bundled
dependency and its license text is listed in
[apps/vscode/THIRD-PARTY-NOTICES.txt](apps/vscode/THIRD-PARTY-NOTICES.txt).
See [docs/release-audit/04-LICENSE-NOTICE-AUDIT.md](docs/release-audit/04-LICENSE-NOTICE-AUDIT.md)
for the full obligation map.

The Bytos name, logo, and visual identity are original to this project and are
**not** covered by the Apache license. See [TRADEMARKS.md](TRADEMARKS.md) before
using them in a fork or distribution.

## Links

- Source: <https://github.com/Balahurra/Bytos>
- Documentation: [docs/](docs/)
- Issues: <https://github.com/Balahurra/Bytos/issues>
- Security: <https://github.com/Balahurra/Bytos/security/advisories/new> (see [SECURITY.md](SECURITY.md))
- Privacy: [apps/vscode/PRIVACY.md](apps/vscode/PRIVACY.md)
- Marketplace metadata preparation: [docs/release-audit/06-MARKETPLACE-METADATA.md](docs/release-audit/06-MARKETPLACE-METADATA.md)
