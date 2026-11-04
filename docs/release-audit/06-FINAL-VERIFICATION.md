# 06 - Final verification

Every command below was executed on the audit host (Windows 11, `bun 1.4.4`,
`node v26.13.0`) against this working tree after the fixes in `01`-`05`. Nothing
is marked PASS unless it was actually run. Where a suite did not pass, the reason
is given and the failure was checked to be environmental rather than introduced by
this change.

## 1. Typecheck

| Command | Result |
|---|---|
| `bun run build:sdk` (repo root) | **PASS** - `@bytos/shared`, `@bytos/ui`, `@bytos/llms`, `@bytos/agents`, `@bytos/core`, `@bytos/sdk` all exit 0. |
| `cd apps/vscode && bunx tsc --noEmit` | **PASS** - 0 diagnostics. |
| `cd apps/vscode && bun run check-types:compat` | **PASS** - 0 diagnostics. |
| `cd apps/vscode/webview-ui && bunx tsc --noEmit` | **PASS** - 0 diagnostics. |

## 2. Lint and format

| Command | Result |
|---|---|
| `cd apps/vscode && bunx biome lint --config-path ./biome.jsonc --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error` | **PASS** - 1363 files, no errors (exit 0). |
| `cd apps/vscode && bunx biome check <touched files>` | **PASS** after `--write` formatting of the two new scripts and the new test. |
| `bun run lint` (repo root) | **PASS with warnings** - 0 errors, 39 warnings + 79 infos, all pre-existing `a11y/noStaticElementInteractions` findings in `apps/cli` TUI components. Exit 0. |
| `cd apps/vscode && bun run lint:proto` | **NOT RUN** - the script is `bash ./scripts/proto-lint.sh` and this host has no `bash`. No `.proto` file was modified. See `07` O-05. |

## 3. Unit tests

| Command | Result |
|---|---|
| `cd apps/vscode && bun run test:unit` | **1249 pass / 1 fail** across 93 files. The failure is `src/core/context/instructions/user-instructions/__tests__/bytos-rules.test.ts > setRuleDisabledInFrontmatter > skips paths outside the allowed roots, including through symlinks`, failing with `EPERM: operation not permitted, symlink ...` - Windows needs Developer Mode or elevation to create symlinks. Deterministic, environmental, unrelated to any file changed here. |
| `cd apps/vscode && bun test src/__tests__/readme-and-packaging.test.ts` | **PASS** - 14/14 (new test). |
| `bun -F @bytos/llms test` | **PASS** - 54 files, 1076 tests. (First run had one file fail; the package passes on re-run with no code change and that file passes in isolation - flaky under full-graph load.) |
| `bun -F @bytos/core test:unit` | **3134 pass / 10 fail**, 7 failing files. All ten are host-environment gaps: `spawnSync bun ENOENT` (the sandbox cannot spawn `bun` from inside a test), `spawn bash ENOENT` (no `bash` on Windows), `symlink EPERM`, and a `bun:test` import inside a vitest run (`user-input-builder.test.ts`). |
| `cd apps/vscode && bun run test:integration` / `test:e2e` | **NOT RUN** - both need a real VS Code Electron download plus a GUI display, unavailable on this host. Run on Linux/CI before publishing. |
| `cd apps/vscode/webview-ui && bun run test` | **NOT RUN** in this pass (the webview typechecks and builds). Tracked in `07`. |

## 4. Build

| Command | Result |
|---|---|
| `cd apps/vscode && bun run build:webview` | **PASS** - Vite build in ~23 s (`index.js` 5,921.38 kB plus diagram/font chunks). |
| `cd apps/vscode && bun esbuild.mjs --production` | **PASS** - `dist/extension.js` and `dist/plugin-runtime/` written. |

## 5. Licence gate

| Command | Result |
|---|---|
| `node apps/vscode/scripts/check-licenses.mjs` (before packaging) | **Fails by design** with `package.json is missing __metadata` - the gate refuses to clear a tree that has not been through `vsce`. |
| `node apps/vscode/scripts/check-licenses.mjs --vsix tmp/bytos-4.2.0-audit.vsix` | **PASS on content** - LICENSE/NOTICE/third-party/extension-metadata checks pass; the archive has every required file and none of the forbidden ones. The only remaining item is the `__metadata` check, because `vsce package` does not write that block (verified: packaged twice with `vsce package` and inspected the manifest; `__metadata` stayed `undefined`). It is written by `vsce publish` when the publisher is resolved. |

## 6. Packaging and archive inspection

Command used (new script, see `05` section 4):

```
cd apps/vscode && node scripts/package-release.mjs --out <path>.vsix
```

Result: **`bytos-4.2.0-audit.vsix`, 12.35 MB, 191 archive entries** (189 extension
files + `extension.vsixmanifest` + `[Content_Types].xml`), ~52.6 MB uncompressed.

Manifest identity inside the archive (`extension.vsixmanifest`):
`Id="bytos" Version="4.2.0" Publisher="bytos"`, `DisplayName` `Bytos`,
`Microsoft.VisualStudio.Code.Engine` `^1.101.0`, categories
`AI,Chat,Programming Languages,Testing`, 23 tags (the 22 keywords plus
`keybindings`, under the Marketplace limit of 30).

Archive contents by group:

| Group | Files |
|---|---|
| Licensing/legal | `LICENSE.txt`, `NOTICE`, `THIRD-PARTY-NOTICES.txt`, `THIRD-PARTY-NOTICES.json`, `PRIVACY.md`, `readme.md`, `changelog.md` |
| Manifest | `package.json`, `extension.vsixmanifest`, `[Content_Types].xml` |
| Runtime | `dist/extension.js`, `dist/plugin-runtime/**` (92 files: sandbox bootstrap, the five `@bytos/*` package manifests, pre-bundled core/sdk/llms/agents/shared chunks) |
| Webview | `webview-ui/build/**` (73 files: `index.html`, `index.js`, `index.css`, diagram/KaTeX/mermaid/cytoscape chunks, Geist Mono + codicon fonts) |
| Assets | `assets/icons/*` (10 files, incl. `icon.png`) |
| Onboarding | `walkthrough/step1..5.md` |

Verified **absent**: `src/`, `scripts/`, `tests/`, `proto/`, `.github/`,
`webview-ui/src/`, `README.marketplace.md`, `.env*`, `secrets.json`,
top-level `node_modules/`, `*.map`. Checked twice: by `check-licenses.mjs --vsix`
(unpack and test) and by `package-release.mjs` (`vsce ls` comparison).

## 7. Dependency and licence audit

| Check | Result |
|---|---|
| `THIRD-PARTY-NOTICES.txt` generated from the installed tree | 2396 packages, 13 UNKNOWN, all 13 explicitly justified in `license-exceptions.json`. |
| Gate refuses an unresolvable licence that is not listed | Enforced in code (the `unresolved` loop in `check-licenses.mjs`). |
| `bun audit` / advisory scan | **NOT RUN.** Not part of the verified pipeline and no advisory-database access was used. Run in CI before release. |
| Secret scan | Done manually and by pattern (`04`). No `gitleaks` binary is installed on this host, so `.gitleaks.toml` was not executed. Run `gitleaks detect` in CI before release. |

## 8. Real-environment smoke test

**NOT PERFORMED.** The audit host has no VS Code installation, so
`code --install-extension` and a real activation could not be exercised. Verified
instead: the extension bundle builds for `node22.15`/CommonJS with only `vscode`
external, the webview build is complete, the plugin runtime is in the archive, the
manifest's `main` (`./dist/extension.js`) and activation events resolve to shipped
files, and every file the manifest references (icon, activity-bar icon, walkthrough
markdown) exists in the archive.

## 9. Summary of what this proves and what it does not

Proven here: the repository typechecks, lints (extension package: clean), builds
both halves of the extension, packages deterministically, and the packaged archive
contains the licence/notice set and nothing that must not ship.

Not proven here: runtime behaviour inside VS Code, cross-platform test parity
(bash/symlink-dependent tests), advisory-database cleanliness, proto lint, and the
Marketplace rendering of the listing.

