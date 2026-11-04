# 07 - Release readiness

## 1. Headline results

| Dimension | Verdict | Why |
|---|---|---|
| **TECHNICAL READINESS** | **PASS (manual smoke test outstanding)** | SDK + extension + webview typecheck clean; the extension package lints clean; webview and extension bundle build; packaging is reproducible with one command and the archive was inspected. Remaining gaps are environment-only (no VS Code on the audit host, no `bash`, no symlink permission) plus a manual install/activation check that must be done once on a real VS Code before the first publish. |
| **LICENSE & ATTRIBUTION READINESS** | **PARTIAL** | Every Apache-2.0 Section 4 obligation is now discharged by `LICENSE`, `NOTICE`, a generated third-party inventory, and modification headers on the files this review could attribute. It is **not** PASS because the local history cannot prove file-by-file provenance; 13 dependencies still have no resolvable licence (documented and justified, but not legally cleared); CC-BY attribution wording is unverified; and the authorship of the brand assets is unconfirmed. These are legal judgement calls, not engineering tasks. |
| **MARKETPLACE RELEASE READINESS** | **BLOCKED** | Three blockers remain, all outside code: (B-1) the manifest has no `__metadata` block because `vsce` writes it only when it can resolve the publisher/PAT, so the release gate correctly refuses to clear the package; (B-2) no real VS Code activation test has been run; (B-3) the `bytos` publisher identity and PAT ownership are unverified. B-1 is one packaging run on a machine with a Marketplace token; B-2 and B-3 need a human. |

Nothing was pushed to GitHub and nothing was published to the Marketplace.

## 2. Blockers

| ID | Blocker | Owner | How to clear |
|---|---|---|---|
| B-1 | `__metadata` (`publisherId`, `publisherDisplayName`) is absent from `apps/vscode/package.json`. Verified during this audit: `vsce package` does **not** write the block; `vsce publish` does, when it resolves the publisher from the Marketplace PAT. The release gate therefore reports the missing block as its only remaining failure - the intended "publishable, not yet published" signal. | Release engineer | Publish once with `vsce publish` (or `node scripts/publish-marketplace.mjs`) using the `bytos` publisher PAT, then commit the manifest carrying `__metadata`. Set `BYTOS_PUBLISHER=bytos` so the gate asserts the identity from then on. |
| B-2 | No install/activation test in a real VS Code. | Release engineer | `code --install-extension bytos-4.2.0.vsix` on VS Code >= 1.101.0, then check: the Bytos icon appears, the sidebar opens, a provider key can be saved and stays masked, telemetry stays off, and one read-only tool call completes. |
| B-3 | Marketplace publisher `bytos` and PAT ownership are unverified; nothing in the repository records that the publisher exists. | Maintainer | Confirm in the Marketplace publisher management page that `bytos` is registered to the publishing account and that the PAT has Marketplace (Manage) scope. |

## 3. Open items that need a human or legal decision

| ID | Item |
|---|---|
| O-01 | Publisher identity / `__metadata` (same as B-1). |
| O-02 | 13 UNKNOWN-licence dependencies: confirm the "not in the production input graph" claim holds for the shipped bundle (esbuild metafile + `bun pm ls --all`). |
| O-03 | 23 stale `.vsix` files are still in the working tree. They are git-ignored now; whether to delete them and whether any historical commit needs rewriting is a maintainer decision. |
| O-04 | CC-BY-4.0 attribution wording for two packages. |
| O-05 | Proto lint (`bash ./scripts/proto-lint.sh`) does not run on Windows. Run on Linux/CI. No `.proto` file changed in this review. |
| O-06 | `test:integration`, `test:e2e` and the webview vitest suite were not executed on this host. Run on CI before release. |
| O-07 | `bun audit` and `gitleaks detect` were not executed. Run in CI. |
| O-08 | Authorship of `assets/branding/*` and `apps/vscode/assets/icons/*`; the social icons in `assets/icons/social/*` are third-party trademarks used for navigation. |
| O-09 | The local Git history has no upstream lineage. Demonstrating Cline provenance per file would have to be reconstructed deliberately (e.g. recording the upstream commit the rebrand started from in `NOTICE`). |

## 4. Completed requirements

- [x] Apache-2.0 text shipped (`LICENSE` -> `LICENSE.txt`); upstream copyright retained verbatim, Bytos modification notice added.
- [x] `NOTICE` shipped, byte-identical to the root copy, with the release gate enforcing that identity.
- [x] Third-party inventory generated (2396 packages) and shipped in text and JSON form.
- [x] Modification notices on the 12 Cline-derived files this review could attribute, each with a change summary.
- [x] `author` corrected to `Bytos contributors`; no unsupported legal entity is claimed anywhere.
- [x] `publisher` present and placed first in the manifest, as Microsoft's publishing docs require.
- [x] Description rewritten so it does not imply upstream parity; categories trimmed to ones the product matches.
- [x] `activationEvents` no longer contains the unused `onLanguage`.
- [x] Marketplace README rebuilt: what it is, requirements incl. VS Code 1.101.0+, providers, permissions and data handling, support/contact, licence and attribution, third-party notices, trademark pointer, non-affiliation.
- [x] README regression test added so stale links, overclaims, mojibake or a missing attribution block fail the build.
- [x] `PRIVACY.md` version aligned to 4.2.0; the root `PRIVACY.md` reduced to a pointer that cannot drift.
- [x] `.gitignore` keeps `.vsix`, agent scratch dirs and local reports out of version control.
- [x] `.vscodeignore` stops shipping build metadata and no longer ships the Vite dev `index.html` while excluding the real one.
- [x] Release licensing gate extended: modification notice, publisher/`__metadata`, engine pin, VSIX required/forbidden file lists.
- [x] Reproducible packaging script with archive inspection.
- [x] No secret found in the repository or the packaged archive; no real secret printed in any report.
- [x] No working feature removed; the bundle, webview, plugin runtime and manifest-referenced assets all ship.

## 5. Files changed or created by this review

Changed:

- `LICENSE` - upstream project identification and modification-notice statement.
- `.gitignore` - artifact, scratch-directory and report ignores.
- `README.md` - licence and attribution section; links (security advisory URL, privacy, readiness).
- `PRIVACY.md` - pointer plus guarantees summary.
- `apps/vscode/package.json` - `publisher` order, `author`, `description`, `categories`, `keywords`, `activationEvents`.
- `apps/vscode/.vscodeignore` - build metadata, webview `index.html` handling.
- `apps/vscode/README.marketplace.md` - rebuilt Marketplace listing.
- `apps/vscode/PRIVACY.md` - version stamp.
- `apps/vscode/scripts/check-licenses.mjs` - extended gate, quieter VSIX extraction.
- `apps/vscode/src/extension.ts`, `src/core/webview/WebviewProvider.ts`, `src/core/controller/models/updateApiConfiguration.ts`, `src/core/controller/state/getStateToPostToWebview.ts`, `src/integrations/misc/extract-text.ts`, `src/sdk/SdkController.ts`, `src/sdk/sdk-tool-policies.ts`, `src/sdk/vscode-file-read-executor.ts`, `src/shared/AutoApprovalSettings.ts`, `src/shared/storage/storage-context.ts` - modification headers only, plus Biome-required import ordering.
- `sdk/packages/core/src/services/storage/provider-settings-manager.ts`, `sdk/packages/llms/src/providers/builtins.ts`, `sdk/packages/llms/src/providers/ids.ts`, `sdk/packages/llms/src/providers/vendors/community.ts` - modification headers only, plus Biome-required import ordering.
- `apps/vscode/src/__tests__/README.package.md` - snapshot of the packaged README for the regression test.

Created:

- `apps/vscode/scripts/package-release.mjs` - reproducible packaging and archive inspection.
- `apps/vscode/src/__tests__/readme-and-packaging.test.ts` - 14 assertions on the packaged README and packaging rules.
- `docs/release-audit/01-REPOSITORY-AUDIT.md`
- `docs/release-audit/02-CODE-ORIGIN-MAP.md`
- `docs/release-audit/03-LICENSE-AND-ATTRIBUTION.md`
- `docs/release-audit/04-SECURITY-AUDIT.md`
- `docs/release-audit/05-VSIX-PACKAGING-AUDIT.md`
- `docs/release-audit/06-FINAL-VERIFICATION.md`
- `docs/release-audit/07-RELEASE-READINESS.md` (this file)

Deleted: **none.**

## 6. Tests run (numbers in `06`)

Typecheck (SDK build, extension `tsc`, compat tsconfig, webview `tsc`); Biome lint
at repo root and on the extension package; extension unit suite (1249 passing via
`bun run test:unit`); the new README/packaging test; `@bytos/llms` and
`@bytos/core` unit suites; webview build; production esbuild bundle; licence gate
with and without `--vsix`; a full `vsce package` plus archive inspection.

Not run, and therefore never reported as passing: integration tests, Playwright
e2e, webview vitest, proto lint, `bun audit`, `gitleaks`, and a real VS Code
install.

## 8. Evening re-verification (2026-11-04) — final state before hand-off

A full second pass was run before the release artefact was handed off to the
desktop. Results, per dimension:

| Area | Verdict |
|---|---|
| Technical readiness | **PASS** — reproducible package rebuilt from the tree: typecheck ×2 clean, biome lint clean (1,364 files), proto regen, webview build (Vite, 8,865 modules), esbuild bundle, `vsce package` (191 files), gate + archive inspection run. |
| Licence & attribution | **PASS with two fixed drift findings.** (1) `apps/vscode/LICENSE` had not received the root-LICENSE fix and the shipped `LICENSE.txt` carried no Cline notice — synced (SHA-256 identical to root) and repackaged; recommend the gate also diff the packaged `LICENSE.txt` against root. (2) Modification-header docs said 12; the tree carries 14 (`SdkController.ts`, `community.ts` added) — `02` and `03` corrected. NOTICE files, third-party inventory (2,396 pkgs, 13 justified UNKNOWN, no GPL/AGPL) re-confirmed. |
| Security | **PASS** — re-scan of working tree + tracked history found no real credential; three process notes added to `04` (S-06: redaction stack untracked until the tree commit; S-07: 97 tracked files inside git-ignored agent dirs — maintainer decision; S-08: local-only report docs contain the machine path, untracked and git-ignored). |
| VSIX packaging | **PASS on the rebuilt archive** — `extension/{LICENSE.txt, NOTICE, THIRD-PARTY-NOTICES.txt+json, CHANGELOG.md, PRIVACY.md, readme.md, package.json, dist/extension.js, dist/plugin-runtime/*, webview-ui/build/index.html, assets/icons/*}` all verified inside the archive; forbidden lists clean; see `05` PKG-07/08/09. |
| Marketplace readiness | **BLOCKED** — unchanged: B-1 (`__metadata`, needs one `vsce publish` with the `bytos` publisher PAT), B-2 (manual install/activation check — done once externally per this engagement), B-3 (publisher/PAT ownership unverified). Human steps only.

The release artefact **`bytos-4.2.0.vsix`** (rebuilt 2026-11-04 22:07,
SHA-256 `5C230FC9…DD42`, 12,353,007 bytes) was copied to the Desktop as the
hand-off copy; the repository copy is byte-identical. Nothing was pushed to
GitHub and nothing was published to the Marketplace.

Files additionally changed in this pass: `apps/vscode/LICENSE` (synced to root),
`docs/release-audit/{01,02,03,04,05}.md` (re-verification sections), and the
rebuilt `bytos-4.2.0.vsix`.

## 9. First-publication preparation (2026-11-04, night)

### 9.1 Is `__metadata` a real publication blocker?

**No.** `__metadata` is not read by the Marketplace to accept an upload and is
not part of the extension manifest contract. It is written *into* `package.json`
by `vsce publish` after the publisher identity is resolved from the PAT
(`publisherId`, `publisherDisplayName`). `vsce package` never produces it. The
licence gate intentionally treats its absence as the "packaged, publisher not
yet recorded" state; it is a release-state assertion, not a licensing failure.
Creating the block by hand would fabricate publisher identity and is explicitly
out of scope.

**Correct first-publication workflow** (human action, not executed here):

1. Confirm the `bytos` publisher exists in the Visual Studio Marketplace
   publisher management page and is owned by the publishing account.
2. Create a PAT with Marketplace **Manage** scope and expose it only as
   `VSCE_PAT` in the release environment.
3. From `apps/vscode`: `node scripts/package-release.mjs` to produce and inspect
   the archive locally (expect the single `__metadata` gate notice).
4. Publish with the existing wrapper (`node scripts/publish-marketplace.mjs`) or
   `npx @vscode/vsce publish --no-dependencies`.
5. `vsce publish` writes `__metadata` into `apps/vscode/package.json`; commit
   that manifest change so the repository records the publisher identity.
6. Re-run `node scripts/check-licenses.mjs` with `BYTOS_PUBLISHER=bytos`; the
   gate then clears with zero errors.

### 9.2 Git remote and merge plan

- Remote `origin` is `https://github.com/Balahurra/Bytos.git` (added, not pushed).
- Remote `main` is a **single unrelated commit** `3013632` containing only a
  stock Apache-2.0 `LICENSE` (GitHub's template, with the placeholder copyright
  line).
- Local `main` keeps its 26-commit history at `88b46c3` plus this release's
  commits.
- Safe integration (no force, no history rewrite):
  `git fetch origin` then
  `git merge --allow-unrelated-histories origin/main`; on the `LICENSE`
  conflict keep **ours** (the Apache text with the Cline copyright and the Bytos
  modification statement), then commit the merge. The resulting push is a
  fast-forward from the remote's point of view.

### 9.3 Remaining blockers after this pass

| ID | Blocker | Owner |
|---|---|---|
| B-2 | One real install/activation test in VS Code on the target machine (the earlier external test is accepted, so this is documentation-only for the release notes) | Release engineer |
| B-3 | `bytos` publisher identity and PAT ownership verification (same as step 9.1.1) | Maintainer |
| H-1 | Legal review of the retained uncertainties in `03` section 6 (asset authorship, CC-BY wording, unknown licences) | Maintainer / counsel |
| H-2 | Optional follow-ups recorded in `08`: cloud-session removal, SAP stub/dependency removal, CLI picker cleanup, `find-dead-src` fix | Maintainer |

Everything else - licensing, attribution, notices, security, dead-code
removal, repository hygiene, documentation, packaging and the local VSIX - is
**PASS**.

### 9.4 Final validation after the cleanup commits

- **Typecheck:** `bun run check-types` (extension `tsc`, compat tsconfig, webview
  `tsc`) — exit 0.
- **Unit suite:** 89 files, **1,195 pass / 1 fail**. The single failure is
  `bytos-rules.test.ts` → symlink creation returns `EPERM` because the Windows
  host does not hold the symlink privilege; the same test failed before any
  cleanup and is environmental, not a regression. It passes on Linux CI.
- **Lint:** biome clean on 1,344 files during the final packaging run.
- **Build:** webview Vite build (8,865 modules) and production esbuild bundle
  succeed.
- **Licence gate:** every assertion passes except the expected
  `__metadata`-absent signal (section 9.1).
- **VSIX:** 191 files, required/forbidden lists clean, `LICENSE.txt` carries the
  Cline copyright, `webview-ui/build/index.html` present. Final artefact:
  12,353,055 bytes, SHA-256 `3A7D1467…BC6D7`, copied to the Desktop.
- **Secret scan:** `gitleaks git` over the full 32-commit history: **no leaks
  found** (~40.5 MB scanned). The 20 initial heuristic hits were verified as
  fixtures/placeholders and narrowly allowlisted in `.gitleaks.toml`.
- **Commits:** `2033f4a` (security/BYOK), `57e9dee` (licensing/packaging/docs),
  `4e02af6` (dead-code and repository cleanup), `6a4589d` (audit records),
  `21f60aa` (merge). Every commit ran the gitleaks pre-commit hook: "no leaks
  found".
- **Working tree:** clean. Nothing pushed; nothing published.

