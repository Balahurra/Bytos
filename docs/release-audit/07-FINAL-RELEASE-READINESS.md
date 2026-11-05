# 07 - Final release readiness

Date: 2026-11-05
Release: Bytos 1.0.0
Artifact: `C:\Users\TT\Desktop\bytos-main\bytos-1.0.0.vsix`
Commit under test: `15c620b` (`release: prepare Bytos 1.0.0`)

## 1. Executive summary

Bytos 1.0.0 is technically ready for a first public release. The extension
version, manifest, README, changelog, licence files, and VSIX agree on `1.0.0`.
The final archive was built from the release commit, installed into a clean VS Code
profile, launched, and activated successfully. The chat-first BYOK UI rendered,
the extension host logged no errors, and the E2E suite passed 14 tests on Windows
(one Windows PowerShell 7 test skipped because that shell is not installed).

The release is **not** cleared for Marketplace publication without human action:
the `bytos` publisher identity and PAT ownership are not verified, `__metadata` is
written only by the first publish, and legal follow-ups remain.

**Final decision: READY WITH MANUAL BLOCKERS.**

## 2. Repository changes

| File | Why it changed |
| --- | --- |
| `README.md` | Rewritten: VS Code-only positioning, actual features, Auto Phase, feature status, BYOK/SecretStorage, no CLI/desktop distribution claims, fixed links and mojibake, real CI badge. |
| `SECURITY.md` | Removed the unverified email, scoped the policy to the shipped extension, kept GitHub private reporting (now enabled), removed disabled-Discussions references. |
| `CONTRIBUTING.md` | Removed the disabled Discussions link; points feature requests at issues. |
| `PRIVACY.md` | Version stamp `1.0.0`. |
| `apps/vscode/PRIVACY.md` | Version stamp `1.0.0`. |
| `apps/vscode/package.json` | Version `1.0.0`; description, categories, keywords rewritten; `simple-git` `4.0.2`. |
| `apps/vscode/README.marketplace.md` | Rewritten Marketplace listing: accurate product, providers, Auto Phase, permissions, feature status, support, licence/attribution; demo GIF added. |
| `apps/vscode/src/__tests__/README.package.md` | Snapshot kept in sync with the Marketplace README; 14 packaging/README tests pass. |
| `apps/vscode/THIRD-PARTY-NOTICES.{txt,json}` | Regenerated after the dependency changes. |
| `apps/vscode/src/core/controller/worktree/checkoutBranch.ts` | `simple-git` named import. |
| `apps/vscode/src/core/controller/worktree/deleteWorktree.ts` | `simple-git` named import. |
| `apps/vscode/src/core/controller/worktree/mergeWorktree.ts` | `simple-git` named import. |
| `apps/vscode/src/utils/git-worktree.ts` | `simple-git` named import. |
| `apps/vscode/webview-ui/package.json` | `dompurify` `^3.4.17`. |
| `sdk/packages/core/package.json` | `simple-git` `4.0.2`. |
| `sdk/packages/core/src/services/workspace/workspace-manifest.ts` | `simple-git` named import. |
| `sdk/packages/core/src/services/workspace/workspace-manifest.test.ts` | `simple-git` named import. |
| `sdk/packages/core/src/runtime/host/local-runtime-host.test.ts` | `simple-git` named import. |
| `bun.lock` | Lockfile update for `simple-git@4.0.2`, `@simple-git/argv-parser@2.0.1`, `dompurify@3.4.17`. |
| `docs/docs.json` | Corrected GitHub URLs and removed the disabled Discussions navbar link. |
| `docs/release-audit/01-RELEASE-BASELINE.md` | New baseline report. |
| `docs/release-audit/02-SECURITY-AUDIT.md` | New security audit. |
| `docs/release-audit/03-DISTRIBUTION-AUDIT.md` | New distribution/VSIX audit. |
| `docs/release-audit/04-LICENSE-NOTICE-AUDIT.md` | New licence/notice audit. |
| `docs/release-audit/05-DISCOVERABILITY-AUDIT.md` | New website/SEO audit. |
| `docs/release-audit/06-MARKETPLACE-METADATA.md` | New Marketplace metadata proposal. |
| `docs/release-audit/07-FINAL-RELEASE-READINESS.md` | This report (created after the commit; docs-only). |

No source feature was removed. No test, workflow, or security gate was weakened.
The old `apps/vscode/CHANGELOG.md` history is preserved; the `1.0.0` entry was
added above it.

## 3. Version

| Check | Result |
| --- | --- |
| `apps/vscode/package.json` `version` | `1.0.0` |
| VSIX `extension/package.json` `version` | `1.0.0` |
| `CHANGELOG.md` top entry | `1.0.0` |
| Privacy notices | `1.0.0` |
| README install command | `bytos-1.0.0.vsix` |
| Other workspace packages | unchanged; they are not the extension release |

## 4. Security

Full evidence is in `02-SECURITY-AUDIT.md`.

| Item | Result |
| --- | --- |
| Git history secret scan (`gitleaks`) | 52 commits, no leaks |
| VSIX secret scan | no `.env`, keys, tokens, or private keys |
| Critical advisories in shipped bundle | none after fixing `simple-git` and `dompurify` |
| Critical advisories in non-shipped packages (`next`, `proxy-addr`, `shell-quote`) | not shipped |
| Residual high advisories in bundled packages (`undici`, `sharp`, MCP/gRPC, `zod`, etc.) | open; planned upgrade pass |
| API keys | VS Code SecretStorage; webview receives a length mask only |
| Tool approvals | fail-closed; auto-approval opt-in |
| Workspace boundary | canonical path checks incl. traversal, drive/UNC, symlinks |
| Telemetry | off by default |
| Private vulnerability reporting | enabled during this pass |
| Dependabot security updates | enabled on 2026-11-05 (including vulnerability alerts) |

## 5. CLI and OpenCode

- The VSIX contains **no CLI executable, bin entry point, or CLI installer code**.
- The VSIX contains **no OpenCode runtime integration or CLI dependency**.
- `opencode` strings in the bundle are provider documentation URLs, a plugin
  sandbox host-environment marker (`OPENCODE`), and historical changelog text.
- `@bytos/cli-*` appears only as a fallback module-resolution string in the plugin
  sandbox; no CLI package or binary is bundled.
- The core `hub/` and `cloud/` library modules are present in the plugin runtime
  as non-executable library payload; this is documented as a low-severity future
  pruning item, not a shipped hub application.
- The CLI, hub, desktop, and example workspaces remain in the repository for
  development and are not distributed by this VSIX.

## 6. Licence and NOTICE

- Apache-2.0 text ships as `LICENSE.txt`.
- The upstream `Copyright 2026 Cline Bot Inc.` notice and Apache-2.0 obligations
  are preserved.
- `NOTICE` ships and disclaims affiliation.
- `THIRD-PARTY-NOTICES.{txt,json}` ship with 2,398 packages.
- 13 UNKNOWN-licence packages remain (legal review required); they are
  enumerated and gated by `license-exceptions.json`.
- CC-BY-4.0 attribution wording for `@vscode/codicons` and `caniuse-lite` remains
  open.
- Brand asset authorship remains open; `TRADEMARKS.md` covers the mark separately
  from the licence.
- No GPL or AGPL was found; LGPL entries are documented.

## 7. GitHub

| Item | State |
| --- | --- |
| Repository | `https://github.com/Balahurra/Bytos` |
| Description | "Open-source AI coding agent for Visual Studio Code. BYOK, approval-first, with MCP tools and sequential Auto Phase plans." (updated) |
| Homepage | `https://bytos.dev` (set) |
| Topics | `ai-coding-agent`, `artificial-intelligence`, `byok`, `coding-assistant`, `developer-tools`, `llm`, `mcp`, `multi-provider`, `open-source`, `typescript`, `vscode-extension` (set) |
| README | Rewritten and pushed |
| LICENSE / NOTICE | Present, preserved |
| SECURITY.md | Rewritten; private reporting enabled |
| CHANGELOG | `1.0.0` entry |
| Discussions | Disabled; links removed rather than left dead |
| Release / tag | **Created**: `v1.0.0` GitHub release with `bytos-1.0.0.vsix` and SHA-256 asset (2026-11-05) |
| Draft release notes | Published with the GitHub `v1.0.0` release; Marketplace publication remains separate |

### Draft `v1.0.0` release notes

> **Bytos 1.0.0 - first public release**
>
> Bytos is an open-source, bring-your-own-key AI coding agent for Visual Studio
> Code. This release includes the chat-first agent workflow, multi-provider model
> configuration, approval-gated file/terminal/browser/MCP tools, hooks, skills,
> worktrees, checkpoints, and sequential Auto Phase plans with per-phase provider,
> model, attachments, and MCP allowlist settings.
>
> Install the VSIX from this release. The Marketplace listing is pending. API keys
> are stored in VS Code SecretStorage; telemetry is off by default.
>
> Bytos includes software derived from Cline, Copyright 2026 Cline Bot Inc.,
> licensed under Apache-2.0. See LICENSE, NOTICE, and THIRD-PARTY-NOTICES.

The GitHub release is published. Marketplace publication remains separate and must not proceed until the publisher identity, `__metadata`, and legal items are cleared.

## 8. SEO and discoverability

Full evidence is in `05-DISCOVERABILITY-AUDIT.md`.

- Source lives in the separate `Balahurra/web2` repository; changes are local and
  not deployed.
- Fixed live title/meta mojibake.
- Added canonical, Open Graph, Twitter card, and JSON-LD to `/` and `/features`.
- Added `robots.txt` and `sitemap.xml`.
- Replaced the dead `href="#"` install button with the GitHub install section.
- Corrected the GitHub organisation and removed overclaims.
- Added `noindex` to auth pages.
- Search Console/Bing submission and deployment remain manual.

## 9. Marketplace metadata

Full proposal is in `06-MARKETPLACE-METADATA.md`.

- Name: `bytos`; display name: `Bytos`; version: `1.0.0`.
- Publisher: `bytos` (**unverified**).
- Categories: AI, Chat, Programming Languages.
- 15 keywords; no `cline` keyword.
- Icon: PNG 256x256.
- Demo GIF: 1200x675, HTTPS raw GitHub URL.
- Engine: VS Code `^1.101.0`.
- Pricing: free BYOK; no Bytos subscription or backend.
- No Marketplace URL is used publicly until the listing exists.

## 10. VSIX

| Field | Value |
| --- | --- |
| Path | `C:\Users\TT\Desktop\bytos-main\bytos-1.0.0.vsix` |
| GitHub release | `https://github.com/Balahurra/Bytos/releases/tag/v1.0.0` (VSIX + SHA-256 attached) |
| Size | 12,277,434 bytes |
| SHA-256 | `A0ABBCBAF4D171374AE726A80D159E0DF5485000140407057F25C97B4918AA44` |
| Entries | 189 |
| Embedded version | `1.0.0` |
| Publisher | `bytos` |
| Name | `bytos` |
| Display name | `Bytos` |
| Entry point | `./dist/extension.js` |
| Icon | `assets/icons/icon.png` |
| Installation test | Installed into a temporary VS Code profile as `bytos.bytos@1.0.0`; VS Code launched; extension activated in **402.6 ms**; chat webview rendered; extension host logged **0 ERROR** lines |
| Secret scan | clean |
| CLI/OpenCode | none shipped |
| Licences | required files present; gate passes everything except the expected missing `__metadata` |

The archive was rebuilt after the last packaged-file change (the Marketplace README
and demo GIF). A stale `bytos-4.2.0.vsix` was not used.

## 11. CI and tests

Local results:

| Check | Command | Result |
| --- | --- | --- |
| Monorepo typecheck | `bun run types` | PASS (all workspaces) |
| Core workspace tests | `bunx vitest run workspace-manifest.test.ts local-runtime-host.test.ts` | PASS (117/117) |
| Extension typecheck/lint | `node scripts/package-release.mjs` prepublish | PASS (TypeScript, compat TS, Biome) |
| Extension unit tests | `bun run test:unit` | 89 files; 1,195 passes; one environmental Windows symlink `EPERM` failure (`bytos-rules.test.ts`), which passes in Linux CI |
| Extension E2E | `bun run test:e2e` | **14 passed, 1 skipped** (Windows PowerShell 7 not installed), 2.7 min |
| VSIX install/activation | temporary profile + Playwright | PASS (`bytos.bytos@1.0.0`, 402.6 ms, 0 errors) |
| Website tests | `node tests/run-all.js` | PASS (18 static checks + auth wiring suites) |
| Secret scan | `gitleaks git --redact` | PASS (no leaks) |
| Production audit | `bun audit --production` | 117 advisories; no critical in shipped bundle; residual highs documented |

GitHub Actions for commit `15c620b`:

| Workflow | Run | Result |
| --- | --- | --- |
| `ext-vscode-test` | `41960854700` | **success** — Quality Checks, Linux vscode test, Windows vscode test, platform integration, and qlty all green |
| `ext-vscode-test-e2e` | `41960854864` | **success** — Windows (14 passed, 1 skipped), macOS, and Ubuntu all green |
| `sdk-test` | `41960854764` | **success** — Quality Checks, Ubuntu Node 24, Windows Node 24 |
| `desktop-test` | `41960854763` | **success** (unrelated to the extension package) |

## 12. Blockers

| ID | Blocker | Owner | Action |
| --- | --- | --- | --- |
| B-1 | Marketplace publisher `bytos` and PAT ownership unverified | Maintainer | Confirm the publisher in the Marketplace management page; create a Manage-scope PAT; expose it only as `VSCE_PAT` |
| B-2 | `__metadata` absent | Release engineer | Run `vsce publish` once (or `node scripts/publish-marketplace.mjs`), then commit the manifest change |
| B-3 | 13 UNKNOWN-licence packages | Legal | Review the enumerated exceptions before distribution |
| B-4 | CC-BY-4.0 attribution wording | Legal | Confirm the requested attribution for codicons/caniuse-lite |
| B-5 | Brand asset authorship | Human/legal | Document the authorship/assignment |
| B-6 | Website changes not deployed | Maintainer | **Resolved 2026-11-05:** `https://bytos.dev` deployed and verified; sitemap/robots live |
| B-7 | Residual high dependency advisories | Maintainer | Plan a controlled upgrade of `undici`, `sharp`, MCP/gRPC, `zod`, etc. |
| B-8 | Dependabot security updates disabled | Maintainer | **Resolved 2026-11-05:** vulnerability alerts and automated security updates enabled |
| B-9 | Marketplace domain-verification TXT record not added | Maintainer | Add `_visual-studio-marketplace-bytos.bytos.dev` TXT `f46729b3-40c0-46a5-99e7-4280b9c4084c` in Cloudflare DNS |
| B-10 | Google/Bing ownership verification | Maintainer | Click verify in Search Console (HTML file) and Bing (XML file); then submit `https://bytos.dev/sitemap.xml` |

## 13. Final decision

**READY WITH MANUAL BLOCKERS.**

The extension package itself is built, installed, launched, and tested. It is not
"READY FOR MARKETPLACE PUBLICATION" because the publisher identity, first-publish
metadata, and legal/licence items require human decisions. It is not "NOT READY":
no critical security, packaging, or runtime issue remains in the shipped bundle.
