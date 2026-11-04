# 04 - Security and privacy audit

No secret value appears in this document. Findings name files and remediation
only.

## 1. How the search was done

- Recursive file scan of `apps/`, `sdk/`, `docs/` for `.env*`, `secrets.json`,
  `*.pem`, `*.key`, `id_rsa*` outside `node_modules`.
- Content scan of every `.ts/.tsx/.js/.mjs/.json` outside
  `node_modules|dist|build|generated` for `sk-…`, `sk-ant-…`, `AIza…`, `ghp_…`,
  `xox[baprs]-…`, and `-----BEGIN (RSA|OPENSSH|PRIVATE) KEY-----`.
- Manual review of the credential storage and webview-boundary code, the CSP, the
  telemetry providers, and the outbound network calls the BYOK build makes.
- Inspection of the artefacts that would ship (`.vscodeignore`, `vsce ls`, and the
  packaged VSIX archive).
- The repository already carries a `.gitleaks.toml`; the gate below complements it
  and runs on every package.

## 2. Credential handling (by design)

| Property | Implementation | Verified by |
|---|---|---|
| Provider keys are not written to plaintext settings | `vscode-secret-storage.ts` + `vscode-provider-credential-store.ts` wrap VS Code SecretStorage; `provider-settings-manager.ts` writes keys there, not into `providers.json`. | Code reading; `vscode-provider-credential-store.test.ts`, `vscode-secret-storage.test.ts`, `state-migrations.test.ts`. |
| Legacy plaintext credentials are migrated, not abandoned | Migration writes every value to SecretStorage, reads it back, and only then rewrites the legacy file. On failure the file is left intact. | `state-migrations` tests; `PRIVACY.md` documents the behaviour. |
| Keys never reach the webview | `getStateToPostToWebview.ts` and `redactApiConfiguration.ts` replace secrets with a length-only mask (`createSecretMask`); the webview receives `configured` flags. | `redactApiConfiguration.test.ts`; `apiKeyMasking.ts` in the webview. |
| Logs do not print keys | `Logger` call sites pass masks; `redactApiConfiguration` is used on the update path. | Code reading. |

## 3. Secrets and personal data found

| ID | Location | Type | Risk | Action |
|---|---|---|---|---|
| S-01 | `apps/vscode/.env.example` | Documented **placeholder** values only (`your-posthog-telemetry-api-key`, etc., all commented out). Mentions that real values live in an internal 1Password vault. | Low - no real value, but development-only and it tells readers where keys live. | Excluded from the VSIX in `.vscodeignore`. Kept in the repository because contributors need it. |
| S-02 | `sdk/packages/core/src/hub/client/__fixtures__/localhost-cert.pem` | Self-signed **test certificate** for the hub TLS client. | Low. | Not packaged (SDK source is not in the VSIX). No action. |
| S-03 | Test files: `apps/vscode/src/core/controller/state/redactApiConfiguration.test.ts` (`sk-ant-secret`), `src/sdk/provider-migration.test.ts` (`sk-ant-legacy-key`), `src/sdk/legacy-state-reader.test.ts` (`sk-ant-test`, `sk-ant-test123`), `src/core/storage/__tests__/state-migrations.test.ts` (`sk-ant-123`), `apps/cli/src/tests/cli/auth.test.ts` (`sk-ant-test`), `apps/cli/src/bin/ca-certs.test.ts` (fake PEM blocks containing `SECRET`). | Obviously fake fixture strings. | None. | No action; listed so a future scanner does not chase them. |
| S-04 | 23 committed `.vsix` archives at the repository root (4.1.25-4.2.0) | Binary build artefacts, each embedding a snapshot of `dist/extension.js` and the webview at package time. | **Medium** - they are not excluded by an effective ignore rule, so past builds sit permanently in the working tree. | **Resolved 2026-11-04:** none was ever tracked in Git (`git ls-files "*.vsix"` is empty); the 20 pre-4.2.0 archives were deleted locally and only the verified `bytos-4.2.0.vsix` remains. `*.vsix` stays ignored. |
| S-05 | `apps/vscode/dist/extension.js.map` (local debug build) | Source map of a non-production build. | Low. | `*.map` is in `.vscodeignore`; never packaged. |

**No live API key, access token, private key, or personal record was found in the
repository or in a would-be distribution artefact.**

If a real credential is ever committed, deleting it from the current tree is not
sufficient: it must be rotated and the history cleaned (or the exposure accepted
in writing). Nothing in this audit found such a case.

## 4. Extension surface risk review

| Area | Observation | Status |
|---|---|---|
| Webview CSP | `WebviewProvider.ts` drops `unsafe-eval` and `https://*` wildcards, limits `connect-src` to PostHog hosts and the packaged origin, and uses a per-load nonce. | Fail-closed. |
| Tool approvals | `sdk-tool-policies.ts` defaults every category (reads, edits, terminal, browser, MCP, skills, unknown/future tools) to "ask". Unknown categories inherit the strictest policy. | Fail-closed. |
| Filesystem boundary | `path-safety.ts` and the file executors canonicalize paths (absolute, traversal, Windows drive/UNC, symlink) against the workspace root. | Enforced. |
| Outbound network | No Bytos backend. Egress is limited to the chosen model provider, `api.cline.bot` (only if ClinePass is selected), OpenRouter OAuth (only on sign-in), GitHub (only when installing a plugin), PostHog (only after opt-in), and MCP servers the user configures. The marketplace catalog URL is empty by default. | Documented in `PRIVACY.md`. |
| Telemetry | Disabled by default; enabling is an explicit settings action; both the extension-side and webview-side PostHog providers check the setting. | Opt-in. |
| Dangerous execution | Terminal execution is a first-class, approved tool; no unapproved shell path was found. `disableCurrentDirectoryExecutableSearch` is applied at activation so workspace-local executables are not picked up. | Mitigated. |
| Machine-specific paths in shipped code | None in the packaged bundle; absolute paths exist only in test fixtures and the local debug source map. | Clean. |

## 5. Privacy findings

| ID | Finding | Status |
|---|---|---|
| P-01 | `apps/vscode/PRIVACY.md` described version 4.1.45 while the manifest is 4.2.0. | Fixed: stamped 4.2.0. |
| P-02 | The root `PRIVACY.md` was a second copy of the same text, so the two could disagree. | Fixed: the root file is now a short pointer that names `apps/vscode/PRIVACY.md` as authoritative and summarises the guarantees. |
| P-03 | No document stated which providers receive data as a consequence of using a compatibility provider. | Covered: `PRIVACY.md` lists `api.cline.bot` and the conditions under which it is contacted. |
| P-04 | `docs/` and `docs/pr-assets/` are in the repository but excluded from the VSIX, so documentation-site assets cannot leak into the package. | Verified with `vsce ls`. |

## 6. Privacy posture for the Marketplace listing

The listing text must not overclaim. The README states: no Bytos account or
backend, keys in SecretStorage, telemetry off by default. `PRIVACY.md` states that
it "is not a legal certification and does not claim GDPR compliance". The README
regression test (`src/__tests__/readme-and-packaging.test.ts`) fails if a
"GDPR compliant" or "SOC 2 certified" claim is added.

## 7. Residual risk

- The extension executes terminal commands by design. Approval defaults are
  fail-closed, but a user who enables terminal auto-approval inherits that risk;
  it is documented in the README and in the auto-approval UI.
- MCP servers are user-supplied processes; the extension does not sandbox them.
  Documented, not mitigated.
- PostHog, when enabled, receives a device identifier. This is stated in
  `PRIVACY.md`.

## 8. Re-verification (2026-11-04, evening)

A second pass over the working tree and tracked history (29 commits on `--all`,
single squashed lineage plus one dangling stash) confirmed the conclusions of
sections 1–7 and added three process findings:

| ID | Finding | Risk | Disposition |
|---|---|---|---|
| S-06 | The credential-redaction stack (`src/core/controller/state/redactApiConfiguration.ts` + test, `src/shared/storage/secret-mask.ts`, `src/hosts/vscode/vscode-{provider-credential-store,secret-storage}.ts` + tests) is **untracked** — it exists only in the working tree and in a dangling stash commit (`e848c91`). The earlier "no secrets" conclusion holds, but the code that keeps keys out of the webview state is not yet under version control. | Process | **Resolved 2026-11-04:** committed in the pre-publication release commits. |
| S-07 | 97 files are **tracked** inside directories that `.gitignore` also ignores (`.agents/` 65, `.claude/` 12, `.bytos/skills/` 15 — the last not covered by any ignore rule — `.greptile/` 3, `.codex/` 1, `.kanban/` 1). Tracked files override ignore rules, so the rules are ineffective for them. Inspector sweeps found no tokens in the sampled configs (`settings.json`, `config.json`, `environment.toml`, publish skills). | Low | **Resolved 2026-11-04:** the agent-state directories (`.agents/`, `.claude/`, `.codex/`, `.greptile/`, `.kanban/`) were untracked with `git rm --cached` (files kept locally). `.bytos/` product skills stay tracked, and `.worktreeinclude` is no longer ignored because the product reads it. |
| S-08 | Untracked local review documents at the repository root (`FINAL-AUDIT-REPORT.md`, `RELEASE-BLOCKERS.md`, etc.) contain a local absolute path. They match `.gitignore` rules (`*-REPORT.md`, `*-AUDIT.md`), so they cannot reach GitHub; they are not packaged. | Low | Keep local only, or scrub paths before sharing. |

Re-scanned evidence: token-shaped strings in tracked files resolve exclusively to
fake test fixtures (`sk-ant-test`, `sk-ant-123`, `xoxb-team-to****`, the AWS
documentation example key, a fake PEM with body `SECRET`); `.env`-like tracked
files are limited to the commented `.env.example`; `git log --all -S` picks for
`sk-`, `AKIA`, `PRIVATE KEY`, `xoxb-` all resolve to those same fixtures; zero
matches for `ghp_`, `github_pat_`, `AIza`, `sk_live`, `sk-proj-`; zero personal
provider email domains; zero local-machine paths in tracked content. No `.vsix`
file is tracked in git.

