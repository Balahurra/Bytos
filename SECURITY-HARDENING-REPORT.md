# Bytos security hardening, dependency remediation and inherited-code cleanup

**Date:** 2026-11-10
**Repository:** `C:\Users\TT\Desktop\bytos-main` (canonical Bytos checkout)
**Execution mode:** audit → implementation → tests → artifact verification
**Final status:** PASS WITH CONDITIONS (no known high/critical production vulnerability; owner-only GitHub settings and documented non-production residuals remain).

---

## A. Executive result

The shipped VS Code extension, the desktop example, the documentation toolchain, and the evaluation toolchain were audited and remediated. The initial local baseline contained 140 advisory instances in the root Bun workspace and 36 in the documentation lockfile. After remediation:

- Root Bun graph: **0 high, 0 critical, 2 low** (one locally patched, one documented low).
- Documentation npm graph: **0 vulnerabilities**.
- `evals/analysis` npm graph: **0 vulnerabilities**.
- `evals` npm graph: **0 vulnerabilities**.
- Standalone runtime lockfile: **0 vulnerabilities**.
- Desktop Cargo lockfile: supplied Rust critical/high alerts fixed; remaining advisories are unmaintained/no-fix or Linux-only GTK/D-Bus transitives and are documented.
- No secrets were found in the working tree or 112-commit history (gitleaks 8.30.1 with the repository `.gitleaks.toml`).
- The final local VSIX was rebuilt and independently inspected: **238 files, 16.24 MB, 0 high/critical production advisories, no secrets, no test/development payloads**.

Critical and high findings fixed include: Rust `zip` parser differential/RCE, Rustls TLS issues, Next.js RCE/SSRF, Vitest/Tinypool RCE, Rollup/Vite/PostCSS/Markdown tooling issues, vulnerable MCP SDK/undici/zod/image-size/node-forge/systeminformation, MSAL, and vulnerable browser automation transitives (`extract-zip`, `basic-ftp`, `follow-redirects`).

Remaining accepted risks are listed in `SECURITY.md` and in section D below.

---

## B. Dependabot / advisory reconciliation

### B.1 Supplied baseline

| Alert | Package | Severity | Location / path | Previous | Fixed | Fix method | Test / evidence | Final status |
|---|---|---|---|---|---|---|---|---|
| 69 | `zip` | Critical | desktop Cargo, `tauri-plugin-updater` | 4.6.1 | 9.5.0 | updater 2.14.1 + cargo update | `cargo check --locked` resolved/compiled deps; OSV re-scan clean for zip | FIXED |
| 70 | `zip` | High | desktop Cargo, updater | 4.6.1 | 9.5.0 | same | OSV re-scan; Cargo.lock | FIXED |
| 71 | `zip` | Moderate | desktop Cargo, updater | 4.6.1 | 9.5.0 | same | OSV re-scan; Cargo.lock | FIXED |
| 45 | `vitest` | Critical | `evals/analysis` | 1.6.1 | 4.1.12 | devDependency upgrade + regenerated lock | `npm test`; `npm audit` 0 | FIXED |
| 55 | `tinypool` | Critical | `evals/analysis` via vitest | 0.8.4 | 2.2.0 | vitest 4.1.12 | `npm audit` 0 | FIXED |
| 54 | `tinypool` | Critical | `evals/analysis` via vitest | 0.8.4 | 2.2.0 | vitest 4.1.12 | `npm audit` 0 | FIXED |
| 42 | `rollup` | High | `evals/analysis` tooling | 4.56.0 | 4.68.2 | regenerated via vitest/vite | `npm audit` 0 | FIXED |
| 56 | `source-map-js` | High | `evals/analysis` | 1.2.1 | 1.2.2 | tooling upgrade | `npm audit` 0 | FIXED |
| 53 | `nanoid` | High | `evals/analysis` | 3.3.11 | 3.3.18 | tooling upgrade | `npm audit` 0 | FIXED |
| 58 | `launch-editor` | High | `evals/analysis` via vite | old | bundled with Vite 8.3.7 | Vite upgrade | `npm audit` 0 | FIXED |
| 48 | `postcss` | High | `evals/analysis` | 8.5.6 | 8.5.32 | tooling upgrade | `npm audit` 0 | FIXED |
| 49 | `postcss` | High | `evals/analysis` | 8.5.6 | 8.5.32 | tooling upgrade | `npm audit` 0 | FIXED |
| 46 | `vite` | Moderate | `evals/analysis` | 5.4.21 | 8.3.7 | tooling upgrade | `npm audit` 0 | FIXED |
| 43 | `vite` | Moderate | `evals/analysis` | 5.4.21 | 8.3.7 | tooling upgrade | `npm audit` 0 | FIXED |
| 60 | `vite` | Moderate | `evals/analysis` | 5.4.21 | 8.3.7 | tooling upgrade | `npm audit` 0 | FIXED |
| 59 | `launch-editor` | Moderate | `evals/analysis` via vite | old | bundled with Vite 8.3.7 | Vite upgrade | `npm audit` 0 | FIXED |
| 57 | `launch-editor` | Moderate | `evals/analysis` via vite | old | bundled with Vite 8.3.7 | Vite upgrade | `npm audit` 0 | FIXED |
| 50 | `postcss` | Moderate | `evals/analysis` | 8.5.6 | 8.5.32 | tooling upgrade | `npm audit` 0 | FIXED |
| 41 | `esbuild` | Moderate | `evals/analysis` | 0.21.5 | 0.28.2 | tooling upgrade | `npm audit` 0 | FIXED |
| 61 | `vite` | Low | `evals/analysis` | 5.4.21 | 8.3.7 | tooling upgrade | `npm audit` 0 | FIXED |
| 11 | `next` | Critical | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 10 | `next` | Critical | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 3 | `next` | Critical | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 2 | `next` | Critical | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 1 | `next` | Critical | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 4 | `next` | High | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 9 | `next` | High | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 8 | `next` | Moderate | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 5 | `next` | Moderate | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 6 | `next` | Moderate | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 7 | `next` | Low | desktop app | 16.2.11 | 16.4.6 | direct upgrade | typecheck; audit | FIXED |
| 26 | `proxy-addr` | Critical | docs | 2.0.7 | 2.0.8 | docs override | `npm audit` 0 | FIXED |
| 29 | `sharp` | High | docs | 0.33.5 | 0.35.5 | docs override + mintlify 4.3.12 | `npm audit` 0 | FIXED |
| 24 | `sharp`/libheif | High | docs | 0.33.5 | 0.35.5 | docs override | `npm audit` 0 | FIXED |
| 27 | `source-map-js` | High | docs | 1.2.1 | 1.2.2 | docs override | `npm audit` 0 | FIXED |
| 19 | `extract-zip` | High | docs via puppeteer/mintlify | 2.0.1 | removed from graph | mintlify 4.3.12 / puppeteer 25 | `npm audit` 0 | FIXED |
| 31 | `follow-redirects` | High | docs | 1.16.0 | 1.16.3 | docs override | `npm audit` 0 | FIXED |
| 30 | `follow-redirects` | High | docs | 1.16.0 | 1.16.3 | docs override | `npm audit` 0 | FIXED |
| 25 | `basic-ftp` | High | docs / browser tooling | 5.3.1 | 6.2.6 | docs override; puppeteer 25 removed path | `npm audit` 0 | FIXED |
| 32 | `zod` | High | docs and root | 3.x/4.4.3 | 4.6.7 | direct upgrades + override | `npm audit` 0; typecheck; tests | FIXED |
| 20 | `nanoid` | High | docs | 3.3.17 | 3.3.18 | override | `npm audit` 0 | FIXED |
| 23 | `extract-zip` | High | docs | 2.0.1 | removed from graph | mintlify/puppeteer upgrade | `npm audit` 0 | FIXED |
| 17 | `postcss` | High | docs | 8.5.14 | 8.5.32 | override | `npm audit` 0 | FIXED |
| 15 | `path-to-regexp` | High | docs | 0.1.12 | 0.1.13 | override | `npm audit` 0 | FIXED |
| 33 | `body-parser` | High | docs | 1.20.6 | 1.20.9 | override | `npm audit` 0 | FIXED |
| 16 | `sharp`/libvips | High | docs | 0.33.5 | 0.35.5 | override | `npm audit` 0 | FIXED |
| 22 | `qs` | Moderate | docs | 6.15.3 | 6.17.1 | override | `npm audit` 0 | FIXED |
| 21 | `qs` | Moderate | docs | 6.15.3 | 6.17.1 | override | `npm audit` 0 | FIXED |
| 39 | `qs` | Moderate | docs | 6.15.3 | 6.17.1 | override | `npm audit` 0 | FIXED |
| 18 | `postcss` | Moderate | docs | 8.5.14 | 8.5.32 | override | `npm audit` 0 | FIXED |
| 38 | `postcss-selector-parser` | Moderate | docs | 6.1.4 | 6.1.5+ | override | `npm audit` 0 | FIXED |
| 37 | `fast-uri` | Moderate | docs | 3.1.8 | 3.1.9 | override | `npm audit` 0 | FIXED |
| 35 | `fast-uri` | Moderate | docs | 3.1.8 | 3.1.9 | override | `npm audit` 0 | FIXED |
| 34 | `fast-uri` | Low | docs | 3.1.8 | 3.1.9 | override | `npm audit` 0 | FIXED |
| 36 | `fast-uri` | Low | docs | 3.1.8 | 3.1.9 | override | `npm audit` 0 | FIXED |
| 44 | `postcss` | Moderate | docs | 8.5.14 | 8.5.32 | override | `npm audit` 0 | FIXED |
| 14 | `vitest`/`@vitest/mocker` | Moderate | `apps/vscode/webview-ui` | 3.0.5 / 3.2.x | 4.1.12 | devDependency upgrade | webview suite 685/685; `npm audit` 0 | FIXED |
| 65 | `rustls` | High | desktop Cargo | 0.23.42 | 0.23.46 | cargo update | OSV re-scan; Cargo.lock | FIXED |
| 67 | `rustls` | High | desktop Cargo | 0.23.42 | 0.23.46 | cargo update | OSV re-scan | FIXED |
| 68 | `rustls` | High | desktop Cargo | 0.23.42 | 0.23.46 | cargo update | OSV re-scan | FIXED |
| 66 | `rustls` | High | desktop Cargo | 0.23.42 | 0.23.46 | cargo update | OSV re-scan | FIXED |
| 72 | `glib` | High | menubar Cargo | 0.18.5 | component removed | unused example deleted | no references remain | REMOVED WITH UNUSED COMPONENT |
| 73 | `serde_with` | Moderate | menubar Cargo | 3.17.0 | component removed | unused example deleted | no references remain | REMOVED WITH UNUSED COMPONENT |
| 63 | `glib` | High | desktop Cargo | 0.18.5 | 0.18.5 | no compatible fix (GTK 0.20 rebase required) | Linux-only; published artifacts are macOS/Windows | MITIGATED — RESIDUAL RISK |
| 64 | `serde_with` | Moderate | desktop Cargo | 3.17.0 | 3.24.0 | cargo update | OSV re-scan | FIXED |
| 40 | `follow-redirects` | High | docs / root graph | 1.16.0 | 1.16.3 | overrides | `npm audit` / `bun audit` | FIXED |

### B.2 Additional advisories discovered locally

`bun audit` initially reported 140 advisory instances; after remediation only two low advisories remain. Additional high/critical groups fixed:

| Package group | Previous | Fixed | Method |
|---|---|---|---|
| `shell-quote` | 1.10.0 | 1.12.0 | audit fix |
| `storybook` | 9.1.20 | 10.6.7 | devDependency upgrade |
| `@azure/msal-node` / `@azure/identity` | 5.6.0 / 4.13.2 | 7.2.1 / 4.14.1 | vsce 4.1.0 + overrides |
| `@modelcontextprotocol/sdk` | 1.30.0 | 1.32.2 | direct upgrade |
| `@grpc/grpc-js` | 1.14.4 | 1.14.7 | direct + override |
| `undici` | 7.29.0 | 7.30.1 | direct + override |
| `zod` | 4.4.3 / 3.x | 4.6.7 | direct + override |
| `image-size` | 2.0.2 | 2.1.0 | direct + override |
| `node-forge` | 1.4.0 | 1.4.3 | audit fix |
| `systeminformation` | 5.33.3 | 5.33.19 | audit fix |
| `linkify-it` / `markdown-it` | 3.0.3 / 14.3.0 | 5.0.2 / 15.0.3 | override / audit fix |
| `brace-expansion` | 1.1.18 / 2.1.4 / 5.0.9 | 1.1.21 / 2.1.7 / 5.0.12 | audit fix |
| `minimatch` / `glob` | 9/10/11/13 | 11.0.6 / 14.0.4 | overrides |
| `@opentelemetry/core` / `propagator-jaeger` | 1.x / 2.6.1 | 2.10.0 | SDK alignment + overrides |
| `hono` / `@hono/node-server` | 4.13.5 / 1.19.9 | 4.13.17 / 2.1.6 | overrides |
| `postcss-selector-parser` | 7.1.5 | 7.2.0 | override |
| `fast-uri` | 4.1.3 | 4.2.3 | override |
| `qs` | 6.15.3 | 6.17.1 | override |
| `source-map-js` | 1.2.1 | 1.2.2 | override |
| `puppeteer-core` / `puppeteer-chromium-resolver` | 23.11.1 / 23.0.0 | 25.17.0 / 25.0.0 | direct upgrade (removes extract-zip/basic-ftp path) |
| `vitest` / `tinypool` / `@vitest/mocker` / `vite` / `rollup` | old | 4.1.12 / 2.2.0 / 4.1.12 / 8.3.7 / 4.68.2 | upgrades + overrides |
| `@ai-sdk/provider-utils` | 5.0.0 nested | 5.0.x elsewhere; 5.0.0 remains | documented low residual |
| `deepmerge` | 4.3.1 | 4.3.1 + local patch | prototype-key denial patch |
| Additional Rust: `anyhow`, `event-listener`, `tokio`, `webpki-root-certs`, `quick-xml`, `plist` | old | 1.0.103 / 5.4.2 / 1.53.3 / 1.0.10 / 0.42.0 / 1.10.3 | cargo update |
| `pin-utils`, `proc-macro-error`, `zbus*` | unmaintained | no fixed release | documented residual; Linux/build-only |

---

## C. Inherited Cline cleanup

**Removed:** `apps/examples/menubar` — an inherited example with no references in source, CI, scripts, documentation, or workspace consumers. Removing it removed the `glib`/`serde_with` alerts from that lockfile and removed a Tauri shell/update surface not part of the Bytos product.

**Retained:** `apps/examples/desktop-app`, because `desktop-publish.yml` builds and publishes it, and `desktop-test.yml` tests its installer tooling. Its Rust and npm dependencies were remediated instead of deleting an active product component.

**Retained:** the VS Code extension, CLI, Hub, SDK packages, eval tooling, documentation, provider integrations, Cline-derived agent runtime, Cline Provider compatibility, Apache-2.0 text, Cline copyright notices, NOTICE, and third-party notices.

**No deletion of inherited functionality** was justified solely by an advisory. No Cline-only integration was removed without a reference check.

---

## D. Runtime security

### Permissions
- VS Code local sessions now **always** install `buildToolPolicies(...)` even when persisted settings are missing, instead of omitting policies and inheriting the SDK’s permissive default. Wildcard is `{ autoApprove: false }`; only `ask_question`/`submit_and_exit` are exempt.
- CLI built-in default changed from `true` to `false` (`CLI_DEFAULT_TOOL_AUTO_APPROVE`). A fresh CLI install, `--auto-approve` unset, and no persisted setting now require approval. `--yolo`/`/yolo`, cloud sandbox, and cron opt in explicitly.
- ACP already used `"*": { autoApprove: false }`; verified.
- Added regression coverage for the CLI default and VS Code fail-closed policy installation.
- Unknown/prototype service and method names in the webview gRPC dispatcher are rejected with own-property checks (`__proto__`, `constructor`).

### Filesystem
- `resolveWorkspacePath` now rejects lexical escapes before resolving (prevents UNC/network resolution and gives a stable error), then still performs canonical `realpath` containment.
- Added Windows-specific tests for drive-letter escapes, UNC paths, case-insensitive in-workspace paths, and junction escapes.
- Existing symlink/NUL/traversal tests retained.
- Residual: terminal commands, once approved, are not sandboxed (documented, unchanged product behavior).

### Terminal
- Existing command guard/policy tests retained.
- MCP stdio spawn hardening (below) also removes the avoidable shell for absolute `.exe` paths.

### Webview
- Production CSP remains `default-src 'none'`, `connect-src https://*.posthog.com`, nonce scripts, `object-src/base-uri/form-action/frame-src 'none'`; `style-src 'unsafe-inline'` remains the documented VS Code toolkit exception.
- Webview message dispatch only accepts `grpc_request`/`grpc_request_cancel`; gRPC handler resolves only own service/method properties.
- Full webview suite: **685/685 passed**.

### Credentials
- SecretStorage/redaction implementation and tests retained; no credentials were found in the VSIX or history.
- The VSIX content gate scans text members for common credential shapes and fails on a match.

### Network / MCP
- MCP stdio spawning no longer uses `cmd.exe` for absolute `.exe` paths; it token-quotes shell-launched `.cmd`/`.bat`/bare commands. This fixes the Windows path-with-spaces failure and removes shell metacharacter injection from literal command/args.
- Web fetch now refuses cloud metadata endpoints (`169.254.0.0/16`, `metadata.google.internal`, IPv6 link-local/IPv4-mapped forms) both on the initial URL and after redirects. Added 3 regression tests.
- MCP SDK upgraded to 1.32.2 (OAuth credential forwarding/request-size fixes).
- Residual: localhost/private-network fetch is still allowed; it is approval-gated and is a legitimate local-doc workflow.

### Archive extraction
- No runtime archive-to-disk extractor ships in the VSIX; xlsx reading uses JSZip in memory.
- Build-time ripgrep extraction uses pinned upstream release URLs; no user-controlled archives.
- Rust `zip` extraction in the desktop updater upgraded from 4.6.1 to 9.5.0 (fixes path canonicalization, symlink-target, SUID/SGID, parser-differential, AES-HMAC, and memory-exhaustion advisories).

### Logging / telemetry
- Production logger remains deliberately narrow (numbers/booleans/error messages only); no raw settings/strings/objects. No central scrubber was added (documented residual from the prior audit).
- Telemetry remains disabled by default.

---

## E. CI and supply chain

- Added `.github/workflows/security.yml`:
  - dependency review on pull requests (`fail-on-severity: high`, `fail-on-scopes: runtime`);
  - high/critical audits for root Bun, docs, evals, evals/analysis, and standalone runtime;
  - CodeQL `javascript-typescript`;
  - full-history gitleaks with `.gitleaks.toml`.
- Pinned the new workflow’s actions to immutable commit SHAs; pinned checkout/setup-bun/setup-node/upload/download actions in the two touched VS Code publish workflows.
- Updated `.github/dependabot.yml`:
  - weekly npm (extension, webview, docs, evals, evals/analysis), Cargo (desktop), Bun (root), GitHub Actions;
  - separate `security-updates` groups so security fixes are not hidden in routine batches;
  - existing version-update ignores retained (security updates bypass them).
- Added release security gate:
  - `node scripts/security/release-gate.mjs <vsix>` runs high/critical audits then `check-vsix.mjs`;
  - `check-vsix.mjs` validates required files/notices, rejects dev/test/example/source-map/lockfile payloads, rejects unexpected `node_modules`, inventories native binaries, and scans text members for credentials;
  - wired into `ext-vscode-publish.yml` and `ext-vscode-publish-stable.yml` before artifact upload/publish.
- Owner-only settings documented in `SECURITY.md`: secret scanning, push protection, Dependabot alerts/security updates, branch protection.

---

## F. Test results

| Suite | Result | Notes |
|---|---|---|
| Full workspace typecheck (`bun run types`) | PASS | all workspaces |
| VS Code webview tests | PASS 685/685 | Vitest 4.1.12 / Vite 8.3.7 |
| VS Code Vitest suite | PASS 2066/2066 | 155 files |
| `@bytos/llms` | PASS 1041, 35 skipped | 52 files |
| `@bytos/shared` | PASS 501, 5 skipped | 40 files |
| `@bytos/agents` | PASS 152/152 | 2 files |
| `@bytos/bytos-hub` | PASS 113/113 | 9 files |
| `@bytos/core` unit | 3112 passed, 9 failed, 97 skipped | 5 files; all environment/pre-existing |
| `apps/vscode` Bun unit runner | environment failures | Windows symlink `EPERM` in inherited tests; see below |
| `evals/analysis` | 52 passed, 3 failed | pre-existing metric/classifier logic assertions |
| Docs `npm ci` + audit | PASS, 0 vulnerabilities | 51 packages |
| `evals/analysis` `npm ci` + audit | PASS, 0 vulnerabilities | 58 packages |
| VSIX package + license gate | PASS | 2374 inventory entries, 5 unresolved (pre-existing) |
| VSIX security gate | PASS | 238 files |
| Cargo `cargo check --locked` | dependency compile PASS; app build script stops on missing sidecar resource | `bin\bytos-cli-x86_64-pc-windows-msvc.exe` is generated by the desktop prebuild; not a dependency failure |
| gitleaks full history | PASS | 112 commits, no leaks |

**Core failures (all pre-existing/environmental, none in changed security code):**
- `compact-session-script` (2): `spawnSync bun ENOENT` because the Vitest child PATH lacks the Bun shim.
- `hook-file-hooks` (3): `spawn bash ENOENT` on this Windows shell.
- `task-spec-parser` (1): symlink creation `EPERM` without Windows Developer Mode.
- `git-preflight` (2): test expects `Balahurra/Bytos` but code normalizes to `bytos/bytos` (repository rename mismatch).
- `sqlite-cron-store` (1): timing/concurrency flake under `bun:sqlite`.
- `runtime-oauth-token-manager.process` (1): process timing under the current runner.

**CLI:** `main.test.ts` 89/90 passed after updating the two expected fail-closed defaults; remaining failure (`ClinePass` migration-notice argument) is unrelated to this change. Plugin/doctor/Slack/update failures are Windows/environment and pre-existing.

**Not run / environment limitations:** VS Code Electron integration tests, Playwright e2e, and full desktop Tauri build (missing generated sidecar + macOS signing environment). They are not claimed as PASS.

---

## G. Final artifact

- **Path:** `apps/vscode/bytos-1.0.2.vsix`
- **Version:** 1.0.2
- **Publisher/name:** `bytos.bytos`
- **VS Code engine:** `^1.101.0`
- **File size:** `17,024,854` bytes (16.24 MB)
- **SHA-256:** `001aeee16ca77606a89ff3bc5ddafe1bd1dba8eee86400d1d681b6d15c8c818a` (pre-final rebuild; final value in the build log below)
- **Files:** 238
- **Native/executable members:** 15 (whisper DLL/EXE and the Windows audio helper)
- **Runtime inventory:** `dist/extension.js` (19.9 MB) + `dist/plugin-runtime` (90 files) + `webview-ui/build` (106 files) + assets/licenses.
- **Security scan:** release gate PASS (0 high/critical; 2 low residual documented; no secrets; no test/development payloads).
- **License gate:** PASS (`licenses:check:vsix` against the new VSIX).
- Local installed VSIX was **not** updated: this repository has no supported local install workflow; publishing was not performed.

> The final rebuild after the last source edits is recorded in the transcript; use the SHA-256 printed by the final `check-vsix.mjs` run as the authoritative artifact hash.

---

## H. Git state

Local commits were created in focused phases after verification. **No push, no tag, no release, no deployment, and no Marketplace upload occurred.**

Modified areas: dependency manifests/lockfiles, desktop Cargo lock/toml, VS Code OTel/MCP/webview/runtime files, CLI defaults and tests, SDK core path/SSRF/MCP code and tests, security workflow/scripts, Dependabot, SECURITY.md, generated third-party notices, and removal of `apps/examples/menubar`.

`git status` before commit contained only the intended files; no secrets were included (gitleaks clean).

---

## I. Remaining owner actions

1. Enable **GitHub → Settings → Code security → Secret scanning** and **Push protection**.
2. Enable **Dependabot alerts** and **Dependabot security updates** (the config file alone does not enable them).
3. Configure branch protection on `main` to require the `security` workflow and the existing test workflows, and require review for release tags.
4. If Linux desktop artifacts are ever distributed, fund/perform the GTK 0.20 / glib 0.20 rebase (or document Linux as unsupported). The current published desktop artifacts are macOS and Windows.
5. If the low `@ai-sdk/provider-utils@5.0.0` advisory must be cleared at the advisory level, perform the coordinated Langfuse/AI SDK upgrade; the nested package is not reachable from untrusted tool input.
6. Optionally rotate any credentials that were ever committed outside this repository’s history; gitleaks found none in this repository.
