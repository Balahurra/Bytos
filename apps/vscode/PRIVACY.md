# Bytos privacy and data handling

**Applies to:** the Bytos VS Code extension, CLI, hub, and desktop app in this
repository.

This file is a pointer. The authoritative, feature-by-feature data map is
maintained next to the VS Code extension, because that package is what the
Marketplace distributes:

- **[apps/vscode/PRIVACY.md](apps/vscode/PRIVACY.md)** - what is stored locally,
  what is sent to which provider, telemetry behaviour, and how to delete local
  data. (Version: Bytos VS Code extension 4.2.0.)

Summary of the guarantees this build makes:

- Provider API keys are written to the host credential store (VS Code
  SecretStorage), never to a plaintext settings file, and are never sent to the
  webview.
- Telemetry is disabled by default and is enabled only by an explicit opt-in.
- The free BYOK build does not contact a Bytos backend for accounts, credits,
  subscriptions, or cloud sessions.

This document is not a legal certification and does not claim GDPR compliance.
Only the current build's behaviour is described; features added later must update
this file before they ship. Where a governing privacy policy or terms of service
exist, they take precedence.

---

# Privacy and Data Handling

**Applies to:** Bytos VS Code extension 4.1.45 (free BYOK build)

This document describes what the current build actually does. It is not a legal
certification and does not claim GDPR compliance. The privacy policy at
<https://bytos.dev/privacy> and the terms at <https://bytos.dev/tos> remain the
governing legal documents.

## No Bytos account or backend

The free BYOK build does not require or use a Bytos account. It does not call
`api.bytos.dev`, `app.bytos.dev`, or `docs.bytos.dev`, and it does not provide
account registration, credits, payments, subscriptions, or cloud sessions.

## Data stored on your machine

| Data | Location | Protection |
|---|---|---|
| Provider API keys and OAuth tokens | VS Code SecretStorage (OS credential store) | OS user account |
| Legacy provider credentials in `providers.json` | `~/.bytos/data/settings/providers.json` | Migrated to SecretStorage and removed on successful migration |
| Settings (provider/model, approval policy, telemetry choice) | `~/.bytos/data/globalState.json` and workspace state | User profile |
| Task history, prompts, source snippets, tool results | `~/.bytos/data/tasks/<id>/` | User profile |
| Rules, workflows, skills | `~/Documents/Bytos/*` and workspace `.bytosrules`, `.bytos/skills` | User profile |
| Browser profile (if browser tool used) | VS Code global storage `puppeteer/` | User profile |

API keys are never written to a plaintext `secrets.json` by the VS Code host.
The legacy file is migrated to SecretStorage and deleted only after every value
has been written and read back successfully. If migration fails, the file is
left in place so credentials are not lost.

## Data sent to third parties

| Recipient | Data | When |
|---|---|---|
| Your chosen model provider | Prompts, code, file contents, tool results, images | Every model request |
| Cline (`api.cline.bot`) | Prompts/code and your Cline key | Only if you select the ClinePass compatibility provider |
| PostHog | Product analytics events and a device/user identifier | Only after you explicitly enable telemetry |
| OpenRouter | OAuth key exchange | Only if you use OpenRouter sign-in |
| GitHub | Repository/plugin metadata | Only if you install a plugin from GitHub |
| MCP servers you configure | Tool inputs and outputs | Only when you use that server |

Bytos does not proxy model requests through a Bytos backend.

## Telemetry

Telemetry is **disabled by default**. It is enabled only by an explicit positive
opt-in in **Settings → General → Telemetry**. When disabled, the extension and
webview do not send PostHog events or feature-flag requests. The setting is
stored locally and survives restarts.

Telemetry never includes API keys, access tokens, prompt text, source code, file
contents, or credentials. Production logging keeps only error messages, numbers,
and booleans; strings and objects are dropped.

## Local data controls

- **Delete a task:** History → delete the task.
- **Delete all task history:** History → delete all.
- **Reset extension settings:** Settings → General → Reset.
- **Remove credentials:** clear the provider key in Settings → API Configuration.
- **Remove all local Bytos data:** close VS Code and delete `~/.bytos/data` (and
  `~/Documents/Bytos` if you created rules/workflows there).

There is no server-side account to delete in this build because there is no
Bytos account. Future account integration must add server-side deletion and
export before any account feature is enabled.

## Future account boundary

When a real Bytos account backend exists, the expected scope is registration,
login, and basic identity. Payment and subscription remain optional future
capabilities. The core agent runtime must remain usable without an account.
