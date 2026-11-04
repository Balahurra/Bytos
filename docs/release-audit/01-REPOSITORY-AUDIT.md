# 01 - Repository audit

Date of audit: 2026-11-04
Audit scope: the repository root (Bytos monorepo).
Nothing was published to GitHub or to the Visual Studio Marketplace as part of
this audit.

## 1. Method

1. Read the workspace rules (`AGENTS.md`), the root `package.json`, and the Git
   metadata before touching any file.
2. Enumerated every top-level directory, every workspace member, and every
   manifest, then read the VS Code extension manifest, the packaging rules, the
   existing licence/notice files, and the existing release-gate script.
3. Compared the working tree against `HEAD` (`git diff --stat`) to separate
   "what this review changed" from "what was already here".
4. Attempted a provenance comparison against the upstream Cline repository
   (`https://github.com/cline/cline`, Apache-2.0) - see section 4 for what was and
   was not possible.
5. Ran the toolchain (typecheck, lint, unit tests, webview build, esbuild bundle,
   licence gate, VSIX packaging) to get a real baseline before changing anything.
   Results are in `06-FINAL-VERIFICATION.md`.

## 2. Top-level layout

| Path | Purpose | Release relevance |
|---|---|---|
| `sdk/packages/{shared,llms,agents,core,sdk,ui}` | The agent engine: provider registry, tool executors, session runtime, settings services, shared UI theme package. Compiled to `dist/` and consumed by every surface. | Bundled into `dist/extension.js` and `dist/plugin-runtime/`. Ships as object code inside the VSIX. |
| `apps/vscode` | The VS Code extension: extension host code (`src/`), webview (`webview-ui/`), protobuf schemas (`proto/`), gRPC codegen, tests, packaging scripts. | **This is the package that gets distributed.** |
| `apps/cli` | `@bytos/cli` terminal UI; spawns `@bytos/bytos-hub`. | Not in the VSIX. Distributed separately. |
| `apps/bytos-hub` | Local daemon + browser dashboard (`@bytos/bytos-hub`). | Not in the VSIX. |
| `apps/examples/*` | Desktop app (Tauri + Next.js + Bun sidecar), small sample agents, menubar app. | Not in the VSIX. |
| `apps/vscode-rollout` | Release-rollout harness with its own `src/`, `scripts/`, `esbuild.mjs`. | Development only. Not in the VSIX. |
| `docs/` | Documentation site (`*.mdx`, `docs.json`). | Not in the VSIX (`.vscodeignore` excludes `docs/**`). |
| `evals/` | Smoke-test harness for prompts. | Development only. |
| `patches/` | Bun `patchedDependencies` for three packages. | Applied at install time, not distributed separately. |
| `assets/` | Branding assets (app icon, social images). | Only `apps/vscode/assets/icons/*` ships in the VSIX. |
| `.agents/`, `.claude/`, `.codex/`, `.greptile/`, `.kanban/` | Agent and review tooling state. | Must never ship; now git-ignored. |
| `tmp/` | Scratch directory used while building and packaging during this audit. | Git-ignored; created by this audit. |
| `*.vsix` (23 files at the repository root, versions 4.1.25 - 4.2.0) | **Old build artifacts present in the working tree.** | Must never ship or be committed. |
| `*-AUDIT.md`, `*-REPORT.md`, `*-PLAN.md`, `RELEASE-BLOCKERS.md`, `REMAINING-ISSUES.md` (20 files at the repository root) | Earlier review write-ups, untracked. | Working documents, not product source. Now git-ignored; the release-facing audits live in `docs/release-audit/`. |
| `LICENSE`, `NOTICE`, `README.md`, `PRIVACY.md`, `SECURITY.md`, `TRADEMARKS.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | Repository-level legal and project documents. | `LICENSE`, `NOTICE` and the extension `CHANGELOG.md`/`PRIVACY.md` ship in the VSIX. |

## 3. Extension anatomy (`apps/vscode`)

| Area | Files | Notes |
|---|---|---|
| Entry point | `src/extension.ts` | `activate()`/`deactivate()`. Wires the credential store, host bridge, webview provider, commands, migrations. |
| Host bridge | `src/hosts/vscode/**`, `src/generated/**` | gRPC/ProtoBus transport between the webview, the extension host, and the SDK. Generated files are git-ignored and rebuilt by `bun run protos`. |
| Controllers | `src/core/controller/**` | One handler per webview request. `models/updateApiConfiguration*.ts` and `state/getStateToPostToWebview.ts` are the credential boundary. |
| Webview provider | `src/core/webview/WebviewProvider.ts` | Creates the webview, sets the CSP, injects the nonce, routes messages. |
| SDK bridge | `src/sdk/**` | `SdkController.ts` replaces the classic controller and adapts SDK events to webview gRPC streams. |
| Integrations | `src/integrations/**` (browser, terminal, git, diagnostics, theme, misc/extract-text) | Host-side tools. |
| Services | `src/services/**` (mcp, telemetry, auth, cloud, error, logging) | `cloud/` and much of `auth/` exist for cloud features that the BYOK build does not enable. |
| Shared | `src/shared/**` (storage, proto conversions, state keys) | `storage/BytosStorage.ts`, `storage-context.ts`, `state-keys.ts` define what is persisted where. |
| Webview UI | `webview-ui/src/**` (399 files) | React + Vite. Built to `webview-ui/build/`, which is what actually ships. |
| Tests | `src/**/__tests__/**`, `src/**/*.test.ts`, `src/test/**`, `webview-ui/src/**/*.test.tsx` | 93 bun-runner unit files plus mocha/`@vscode/test-cli` integration and Playwright e2e. |
| Packaging | `package.json`, `.vscodeignore`, `esbuild.mjs`, `scripts/*` | See `05-VSIX-PACKAGING-AUDIT.md`. |

Counts at audit time: 978 TypeScript files / ~312k lines in `apps/vscode/src`;
399 files in `webview-ui/src`; 408 files in `apps/cli/src`; SDK `core` 604,
`llms` 150, `shared` 142, `ui` 97, `agents` 5.

## 4. Git metadata and provenance limits

- **The local Git history is a single squashed import.** The oldest commit is
  `822988f "Initial Bytos: rebranded coding agent, VS Code extension, CLI,
  desktop, and hub"` (2026-11-03), followed by 25 commits on `main`. There is
  **no** commit that references the upstream Cline tree, no upstream remote, and
  no merge point.
- Author identity across all history is a single synthetic identity
  (`Bytos <dev@bytos.dev>`).
- **Consequence:** per-file provenance cannot be derived from Git. No file in
  this repository records "this came from Cline commit X". Any claim of the form
  "file Y is unchanged from Cline" would be a guess. `02-CODE-ORIGIN-MAP.md`
  therefore classifies files from explicit evidence (path/structure match with
  upstream, in-file notes such as "Replaces classic src/core/controller/index.ts",
  and the scoped diff this audit produced) and marks everything else as inferred.
- The upstream baseline that *is* verifiable: `https://github.com/cline/cline`
  `package.json` has the same shape as this repository's root manifest (same
  workspace list, same script names, same `overrides`, same `patchedDependencies`)
  with `@cline/*` replaced by `@bytos/*`; `apps/vscode` still contains Cline-era
  paths and notes ("classic" controller, `origin/main` references). That is the
  basis for treating this repository as a rebranded Cline derivative rather than
  an independent reimplementation, which matches the project's own `NOTICE`.
- Upstream `LICENSE` carries `Copyright 2026 Cline Bot Inc.` in the appendix.
  There is **no** NOTICE file upstream (the raw URL returns 404), so the
  Apache-2.0 Section 4(d) obligation is discharged by this project's own NOTICE.


## 5. Working-tree state at audit start

84 modified and 43 untracked paths before this review (documentation rewrites,
the BYOK credential-storage change, provider removals, webview CSP change, and
pre-existing audit write-ups). This review did not revert or discard any of them.

## 6. Findings that drove the fixes

| ID | Finding | Severity | Where fixed |
|---|---|---|---|
| R-01 | Root `.gitignore` did not keep `*.vsix` artifacts, agent scratch dirs (`.agents/`, `.claude/`, `.codex/`, `.greptile/`, `.kanban/`), or local audit reports out of version control; 23 `.vsix` files were sitting in the tree. | High | `.gitignore` |
| R-02 | The Marketplace README had duplicated navigation, a Marketplace link for a listing that may not exist, mojibake (`A-hat`, `a-euro-sc`) sequences, and no supported-version, data-handling, contact, or attribution section. | High | `apps/vscode/README.marketplace.md`, new test `src/__tests__/readme-and-packaging.test.ts` |
| R-03 | `apps/vscode/package.json` had an unqualified `author`, an overclaiming description, and two categories ("Education", "Snippets") that do not describe the product. | Medium | `apps/vscode/package.json` |
| R-04 | `activationEvents` contained `onLanguage`, a language-scoped activation this extension never handles. | Low | `apps/vscode/package.json` |
| R-05 | The licence gate did not check the Apache-2.0 Section 4(b) modification notice, the Microsoft-required `publisher`/`__metadata` fields, or the VSIX for leaked source/config files. | High | `apps/vscode/scripts/check-licenses.mjs` |
| R-06 | Packaging could not be reproduced on a non-Bash host: `vscode:prepublish` ends in `bash ./scripts/proto-lint.sh`. | Medium | `apps/vscode/scripts/package-release.mjs` (new) |
| R-07 | `LICENSE` preserved the upstream copyright but did not state which files carry Bytos modifications nor name the upstream project. | High | `LICENSE` |
| R-08 | Twelve substantially modified Cline-derived source files carried no modification notice. | High | File headers (see `03-LICENSE-AND-ATTRIBUTION.md`); 14 by the 2026-11-04 pass |
| R-09 | `apps/vscode/PRIVACY.md` was stamped 4.1.45 while the manifest says 4.2.0, and the root `PRIVACY.md` duplicated it. | Medium | `PRIVACY.md` (root), `apps/vscode/PRIVACY.md` |
| R-10 | `.vscodeignore` shipped build metadata nothing reads at runtime (`.env.example`, `.gitleaks.toml`, `biome.json`, `vitest.config.ts`, `playwright.config.ts`, `knip.json`, `e2e-build.mjs`, duplicated `skills-lock.json`). | Low | `apps/vscode/.vscodeignore` |

## 7. Things the audit could not establish

- Whether the Bytos brand assets (`assets/branding/*`, `apps/vscode/assets/icons/*`)
  are original work or derived from upstream art. They are visually distinct, but
  authorship cannot be proven from the repository. **Requires human confirmation**
  before any trademark claim is relied on.
- Whether a publisher named `bytos` exists on the Marketplace and is the one that
  will hold the PAT used to publish. The manifest says `bytos`; the first publish
  claims the ID, and nothing in the repository records that the publisher was
  registered.

## 8. Pre-publication cleanup (2026-11-04, evening)

This pass prepared the repository for its first public GitHub release at
`https://github.com/Balahurra/Bytos`. Nothing was pushed or published.

| Item | Resolution |
|---|---|
| S-06 - security corrections untracked | Resolved by the release commit: the credential-redaction stack, the SecretStorage-backed credential store, the path-safety executor and their tests are now under version control. |
| S-07 - 46 tracked files inside git-ignored agent directories (`.agents/`, `.claude/`, `.codex/`, `.greptile/`, `.kanban/`) | Untracked from Git with `git rm --cached`; the local files are preserved on disk. `.bytos/` (product skills and rules) stays tracked. `.worktreeinclude` is no longer ignored because the product reads it (`src/utils/worktree-include.ts`). |
| O-03 - stale VSIX archives | The 20 pre-4.2.0 archives were deleted locally; only the verified `bytos-4.2.0.vsix` remains. No VSIX is tracked in Git. |
| Temporary files and scratch state | `tmp/` emptied, the stray root `README.marketplace.md` removed. Local-only review reports remain untracked and git-ignored. |
| Dead code | See `08-DEAD-CODE-AND-LEGACY-CLEANUP.md`: 13 source/test files, 6 webview components, 2 developer scripts, 1 docs data file, the 17-file `apps/vscode-rollout` harness, 2 orphaned workflows and 17 direct dependencies removed after reachability analysis and typecheck/unit verification. |
| Public-facing repository URLs | README, SECURITY, CONTRIBUTING, the GitHub issue/PR templates, the Marketplace README and the extension manifest's `repository`/`bugs` now point to `Balahurra/Bytos`. Historical changelog links and test fixtures are intentionally untouched. |
| Third-party notice entry point | Root `THIRD-PARTY-NOTICES.md` added; it summarises the licence families and points at the generated `.txt`/`.json` inventory that ships in the VSIX. |
| Remote state | `origin` added (no push). Remote `main` is a single unrelated Apache-2.0 `LICENSE` commit (`3013632`); a no-force merge plan is recorded in `07` section 9. |


