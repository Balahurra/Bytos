# 05 - VSIX packaging audit

The VSIX is built from `apps/vscode`. `.vscodeignore` decides its contents;
`.gitignore` decides what the repository tracks. They are evaluated separately
because they answer different questions.

## 1. `.gitignore` (repository) vs `.vscodeignore` (package)

`.gitignore` - what must not be committed:

| Rule | Why |
|---|---|
| `*.vsix`, `*.sig`, `**/*.vsix`, `**/*.sig` | Build artefacts. 23 stale archives were in the tree. |
| `tmp/`, `.agents/`, `.claude/`, `.codex/`, `.greptile/`, `.kanban/`, `.worktreeinclude` | Agent/review scratch state. |
| `*-AUDIT.md`, `*-REPORT.md`, `POST-AUDIT-IMPLEMENTATION-PLAN.md`, `RELEASE-BLOCKERS.md`, `REMAINING-ISSUES.md` | Local working documents. The release-facing set lives in `docs/release-audit/` and **is** tracked. |
| `apps/vscode/webview-ui/build/`, `dist`, `node_modules`, `coverage`, `.env`, `secrets.json`, `.vscode-test/` | Pre-existing rules, still correct. |

`.vscodeignore` - what must not be packaged:

| Rule | Effect |
|---|---|
| `src/**`, `tests/**`, `testing-platform/**`, `standalone/**`, `proto/**`, `scripts/**` | No TypeScript source, tests, or build tooling. |
| `node_modules/`, `webview-ui/node_modules/**`, `testing-platform/node_modules/**` | Dependencies are bundled by esbuild, so no `node_modules` tree ships. |
| `.github/**`, `.husky/**`, `.vscode/**`, `.vscode-test/**`, `.agents/**`, `.claude/**`, `.bytos/**`, `.codex/**`, `.bytosrules/**` | CI, hooks, editor config, agent state. |
| `.env`, `.env.example`, `.gitleaks.toml`, `biome.json`, `vitest.config.ts`, `playwright.config.ts`, `knip.json`, `tsconfig*.json`, `e2e-build.mjs`, `skills-lock.json` | Build/test metadata nothing reads at runtime (grouped and extended in this audit). |
| `webview-ui/src/**`, `webview-ui/public/**`, `webview-ui/index.html`, `webview-ui/package*.json`, `components.json`, `tailwind.config.mjs`, `tsconfig*.json`, `.storybook/**` | Webview sources; only `webview-ui/build/**` ships. |
| `**/.gitignore`, `**/*.map`, `**/*.stories.tsx`, `storybook-static`, `coverage/**`, `test-results/**` | Editor state, source maps, stories, coverage. |
| `README.marketplace.md`, `.README.github.bak`, `package.json.backup` | The source README and the swap backup must never ship (vsce reads `README.md`). |
| `!node_modules/@vscode/codicons/dist/codicon.css`, `!.../codicon.ttf` | Re-included so codicons render in the webview. |
| `docs/**`, `old_docs/**`, `evals/**`, `sdk/**` | Documentation site, evals, and the SDK monorepo (already bundled). |

Measured with `vsce ls --no-dependencies`: **189 files**. The delta against the
pre-audit list is one moved file (`webview-ui/index.html` replaced by
`webview-ui/build/index.html`; see section 4).

## 2. What ships, and why

| Item | Why it must ship |
|---|---|
| `dist/extension.js` | `main` entry point. |
| `dist/plugin-runtime/**` (`plugin-sandbox-bootstrap.js`, `package.json`) | Loaded at runtime to run MCP/plugin sandboxes; copied by `esbuild.mjs`. |
| `webview-ui/build/**` (`index.html`, `index.js`, `index.css`, diagram/KaTeX/mermaid/cytoscape chunks, Geist Mono + codicon fonts) | The UI. `index.js` alone is ~5.9 MB. |
| `assets/icons/*` (`icon.png`, `icon.svg`, `icon-light.svg`, `icon-dark.svg`, `bytos-bot.svg`) | Manifest icon, activity-bar and menu icons. |
| `assets/icons/social/*` | In-UI links (trademark question, see `03`). |
| `walkthrough/step1..5.md` | Referenced by `contributes.walkthroughs`; removing them breaks the walkthrough. |
| `package.json` | Manifest. |
| `README.md` | Marketplace listing body; vsce requires it. |
| `CHANGELOG.md` | Marketplace "Changelog" tab. |
| `LICENSE` (as `LICENSE.txt`) | Apache-2.0 Section 4(a). |
| `NOTICE` | Attribution and disclaimer. |
| `THIRD-PARTY-NOTICES.txt` | Third-party attribution. |
| `THIRD-PARTY-NOTICES.json` | Machine-readable inventory so the shipped package can be audited standalone. |
| `PRIVACY.md` | Data-handling statement referenced from the README. |

## 3. What must never ship (and is now checked)

`src/`, `scripts/`, `tests/`, `proto/`, `.github/`, `.env*`, `secrets.json`,
`.vscode-test/`, `README.marketplace.md`, `webview-ui/src/`, `node_modules/`.
`check-licenses.mjs --vsix` fails the release if any of these are inside the
archive; `package-release.mjs` fails if any appear in the `vsce ls` output or if a
required file is missing.

## 4. Findings and changes

| ID | Finding | Change |
|---|---|---|
| PKG-01 | `webview-ui/index.html` (the Vite dev template) was packaged while `webview-ui/build/index.html` was explicitly excluded, so which `index.html` survived was decided by ignore order. | `build/index.html` is no longer excluded; the root template is excluded with a glob-prefixed pattern. Verified: `vsce ls` lists `webview-ui/build/index.html` only. |
| PKG-02 | `.env.example`, `.gitleaks.toml`, `biome.json`, `vitest.config.ts`, `playwright.config.ts`, `knip.json`, `e2e-build.mjs` and a duplicate `skills-lock.json` were packaged although nothing reads them at runtime. | Added to `.vscodeignore`; the `vsce ls` file count is unchanged, so no runtime file was hit. |
| PKG-03 | Reproducing a release package required manual sequencing (prepublish steps, README swap, `vsce package`, licence gate, restore). | `scripts/package-release.mjs` performs the whole flow in one command and inspects the archive. |
| PKG-04 | `vscode:prepublish` cannot complete on a non-Bash host (`bash ./scripts/proto-lint.sh`). | `package-release.mjs` runs the real prepublish steps itself and substitutes a no-op `vscode:prepublish` only for the duration of the `vsce package` call, restoring `package.json` afterwards. |
| PKG-05 | The new gate's "must never ship" list wrongly included `THIRD-PARTY-NOTICES.json`. | Corrected: it is intentionally shipped as the audit trail for the archive. |
| PKG-06 | `vsce package` leaves the manifest untouched: it does **not** add `__metadata`. Two probe packages were produced during this audit and the manifest still had no `__metadata`, and `workspace:*` specs were not rewritten. A tree without the block is packageable but the licence gate will (correctly) refuse to clear it. | Documented as blocker B-1 in `07`; `package-release.mjs` explains the state in its header so the next maintainer does not chase a phantom bug. |

## 4a. Re-verification (2026-11-04, evening) — findings on the on-disk 4.2.0 archive

A byte-level inspection of the previously packaged `bytos-4.2.0.vsix` (built
2026-11-03 15:59:03) against the current working tree found that legal-file
fixes made on 2026-11-04 (21:13–21:40) had **never been packaged**:

| ID | Finding | Disposition |
|---|---|---|
| PKG-07 | `extension/LICENSE.txt` inside the on-disk VSIX (11,335 B) was the **stale pre-fix copy**: `Copyright 2026 Bytos` only, with **no Cline Bot Inc. copyright notice and no Bytos-modifications paragraph**. The corrected root `LICENSE` (11,938 B, fix-time 21:13) had been synced everywhere except `apps/vscode/LICENSE`, which `vsce` packages as `LICENSE.txt`; the licence gate validates the root copy but not the package copy, so the drift was invisible to the gate. | Fixed: `apps/vscode/LICENSE` overwritten with the corrected root copy (SHA-256 identical); fresh package produced (PKG-09). |
| PKG-08 | The on-disk VSIX also carried outdated embeds of `PRIVACY.md` (old 4.1.x single-product text), `CHANGELOG.md` (markdown-linked issue refs) and the marketplace README, because all were edited on 2026-11-04 after the last build. | Fixed: fresh package produced from the current tree (PKG-09). |
| PKG-09 | Rebuild performed 2026-11-04 evening via `node scripts/package-release.mjs` from `apps/vscode`: full prepublish pipeline (typecheck ×2, biome lint, proto regen, webview Vite build, notice generation) plus `vsce package`, then gate + archive inspection. Gate result: one known failure — missing `__metadata` (PKG-06 / B-1), the documented "packageable but not yet published" signal. Archive contents verified post-build: `extension/LICENSE.txt` now carries the Cline notice and Bytos-modifications paragraph; `extension/webview-ui/build/index.html` present; `extension/PRIVACY.md`, `extension/CHANGELOG.md`, `extension/readme.md`, `extension/package.json` in sync with the tree; required/forbidden lists clean. | Resolved; the rebuilt archive supersedes all 18 on-disk `.vsix` files. |

The gate's assertion that `extension/webview-ui/build/index.html` must be present
(PKG-01) was re-confirmed against the fresh archive rather than `vsce ls` alone.

## 5. What packaging alone does not verify

- Whether the VSIX installs and activates inside a real VS Code. The extension
  bundle, webview build and plugin runtime are produced, but the audit host has no
  VS Code installation to test with. This remains a **manual pre-publish step**
  (see `07`).
- Whether the packaged README renders as intended on the Marketplace. The content
  is reviewed as Markdown and asserted by test; the Marketplace renderer is not
  reproduced locally.
- Native-module portability. `better-sqlite3` appears in the dependency tree but is
  marked external only in the standalone build; the extension bundle does not
  require a prebuilt binary to activate. That was confirmed by reading
  `esbuild.mjs`, not by executing the installed extension.

