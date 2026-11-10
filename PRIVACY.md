# Bytos privacy and data handling

**Applies to:** Bytos VS Code extension 1.0.2 in this repository.

This document describes what the current build does. It is not a legal
certification and does not claim GDPR compliance. The published website policy
at <https://bytos.dev/privacy> remains the governing privacy document. A local
Terms of Service draft is maintained in the repository at
`docs/legal/TERMS-OF-SERVICE-DRAFT.md`; the public
<https://bytos.dev/tos> route is not yet published and is tracked as
an external release blocker.

## The Bytos account is optional

Chat, BYOK provider configuration, and local models work without a Bytos
account. On the first run the extension offers the account screen once as an
optional intro; closing it dismisses the intro and does not lock the agent.

The optional account flow works as follows:

- Sign-up and sign-in open `https://bytos.dev` in your browser. The website uses
  Supabase Auth.
- The extension stores a short-lived pending handoff (state, PKCE verifier,
  redirect URI, expiry) in VS Code SecretStorage.
- The handoff completes through the Bytos API worker at
  `https://bytos-api.contact-altinay.workers.dev` by default
  (`BYTOS_API_BASE_URL` can override it, and local development uses
  `http://127.0.0.1:8787`).
- If you choose to stay signed in, the Supabase session (access token, refresh
  token, and basic user identity) is stored in VS Code SecretStorage. If you do
  not, the session stays in memory only.
- Signed-in account screens can send the account token to the Bytos API at
  `https://api.bytos.dev` to load account and organization data, credits and
  usage, remote configuration, and, when the feature is enabled, BytosPass
  subscription links.

Model requests are separate from the account system: prompts and code go from
your machine to the model provider you configure. Bytos does not proxy model
prompts or code through a Bytos model backend.

## Data stored on your machine

| Data | Location | Protection |
|---|---|---|
| Provider API keys and OAuth tokens | VS Code SecretStorage (OS credential store) | OS user account |
| Legacy provider credentials in `providers.json` | `~/.bytos/data/settings/providers.json` | Migrated to SecretStorage and removed on successful migration |
| Bytos account session (Supabase tokens + basic identity) | VS Code SecretStorage key `bytos.supabase.session` when you keep signed in; memory only otherwise | OS user account |
| Pending Bytos sign-in handoff | VS Code SecretStorage key `bytos.supabase.pending` | OS user account; expires after 10 minutes |
| Bytos account identity shown in the UI | Extension global state and memory | User profile |
| Bytos/BytosPass provider auth state (when that optional provider is used) | Managed by the provider settings layer under `~/.bytos/data/settings/` | User profile |
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
| Bytos website (`bytos.dev`) | Account pages and the public Supabase configuration | When you open sign-up or sign-in |
| Supabase Auth | Email, password (hashed by Supabase), session tokens, and profile metadata | Sign-up, sign-in, session refresh, and sign-out |
| Bytos sign-in exchange worker | One-time authorization code, PKCE verifier, redirect URI, client id, and state | Completing extension sign-in |
| Bytos API (`api.bytos.dev`) | Account token and account/organization identifiers; profile, credits, usage, remote-config requests | Signed-in account screens and account features |

Bytos does not proxy model requests through a Bytos backend.

## Telemetry

Telemetry is **disabled by default**. It is enabled only by an explicit positive
opt-in in **Settings > General > Telemetry**. When disabled, the extension and
webview do not send PostHog events or feature-flag requests. The setting is
stored locally and survives restarts.

Telemetry never includes API keys, access tokens, prompt text, source code, file
contents, or credentials. Production logging keeps only error messages, numbers,
and booleans; strings and objects are dropped. If telemetry is enabled and you
are signed in, account identifiers such as the account id, display name, and
active organization may be attached to analytics events so usage can be
attributed to the account.

## Local data controls

- **Sign out:** Account > Log out clears the local account session and asks
  Supabase to end it. Signing out does not delete server-side account data.
- **Delete a task:** History > delete the task.
- **Delete all task history:** History > delete all.
- **Reset extension settings:** Settings > General > Reset.
- **Remove credentials:** clear the provider key in Settings > API Configuration.
- **Remove all local Bytos data:** close VS Code and delete `~/.bytos/data` (and
  `~/Documents/Bytos` if you created rules/workflows there).

## Account data deletion and export

The 1.0.2 build has no in-product account-deletion or data-export control. The
Bytos owner must publish an account deletion/export process and a privacy contact
in the website policy and Terms of Service before the account feature is
presented as a complete service. Until then, a signed-in user can sign out to
remove the local session, but server-side data remains subject to the website
policy and the owner's process.
