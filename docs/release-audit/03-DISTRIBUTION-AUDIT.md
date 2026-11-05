# 03 - Distribution audit

Date: 2026-11-05
Artifact: `C:\Users\TT\Desktop\bytos-main\bytos-1.0.0.vsix`

## 1. Artifact identity

| Field | Value |
| --- | --- |
| File | `bytos-1.0.0.vsix` |
| Size | 12,277,434 bytes (11.71 MiB) |
| SHA-256 | `A0ABBCBAF4D171374AE726A80D159E0DF5485000140407057F25C97B4918AA44` |
| ZIP entries | 189 |
| Extension root | `extension/` |
| Manifest name | `bytos` |
| Display name | `Bytos` |
| Embedded version | **1.0.0** |
| Publisher | `bytos` (identity not yet verified against the Marketplace account) |
| Entry point | `./dist/extension.js` |
| Icon | `assets/icons/icon.png` |

## 2. File inventory

`vsce ls --no-dependencies` and a direct ZIP inspection agree on 189 files.

| Type | Count | Notes |
| --- | --- | --- |
| `.js` | 149 | Extension bundle, plugin runtime, webview chunks, diagram/KaTeX lazy chunks |
| `.svg` | 9 | Activity bar, light/dark icons, social icons |
| `.json` | 8 | Manifest, plugin-runtime package, third-party inventory |
| `.md` | 8 | README, changelog, privacy, walkthrough steps |
| `.woff2` | 6 | Geist/Inter/codicon fonts |
| `.txt` | 2 | LICENSE, third-party notices |
| `.css` | 1 | Webview styles |
| `.html` | 1 | `webview-ui/build/index.html` |
| `.ttf` | 1 | Codicon font |
| no extension | 1 | `LICENSE`/`NOTICE` family accounting is covered above |

Required files present: `LICENSE` (as `LICENSE.txt`), `NOTICE`,
`THIRD-PARTY-NOTICES.txt`, `THIRD-PARTY-NOTICES.json`, `CHANGELOG.md`,
`PRIVACY.md`, `README.md`, `package.json`, `dist/extension.js`,
`dist/plugin-runtime/plugin-sandbox-bootstrap.js`,
`webview-ui/build/index.html`, and the icon assets.

Forbidden content absent: `src/`, `tests/`, `scripts/`, `proto/`, `.github/`,
`.env*`, `node_modules/` (top-level), `*.map`, `.vscode-test/`, and
`README.marketplace.md`.

## 3. CLI content

| Check | Result |
| --- | --- |
| CLI executable | **None** |
| `bytos.exe` / platform binaries | **None** |
| CLI entry point or `bin` field | **None** |
| CLI installer functions (`installBytosCli`, `checkCliInstallation`) | **None** (licence gate rejects them) |
| `@bytos/cli-*` string | Present only in the plugin sandbox's fallback module-resolution path (`plugin-sandbox.ts` / `plugin-module-import.ts`). It resolves an externally installed wrapper when a plugin asks for it; no CLI package or binary is bundled and the extension manifest does not expose it. |

The CLI, hub, desktop, and example applications are repository workspace
packages. They are not entry points of this extension and are not distributed by
the VSIX.

## 4. OpenCode content

| Check | Result |
| --- | --- |
| `@opencode-ai/*` dependency or runtime | **None** |
| `ai-sdk-provider-opencode-sdk` | **None** |
| OpenCode CLI invocation | **None** |
| OpenCode configuration or adapter | **None** |

The word `opencode` still appears in three benign places:

1. **Third-party provider metadata** in the models.dev catalogue: documentation
   URLs such as `agentrouter.org/docs/opencode.html`, `infer.flow7.org/opencode`,
   and `pendra.ai/docs/integrations/opencode`. These are links for unrelated
   providers, not an integration.
2. **Plugin sandbox host detection**: a list of environment markers
   (`CLAUDECODE`, `GEMINI_CLI`, `CODEX_SANDBOX`, `OPENCODE`, etc.) used to label
   the host environment. It does not launch or import OpenCode.
3. **Historical changelog text** describing the removal of the old integration.

The release licence gate rejects `@opencode-ai/`,
`ai-sdk-provider-opencode-sdk`, `installBytosCli`, and `checkCliInstallation`.

## 5. Library payload that is not an application

`dist/plugin-runtime/node_modules/@bytos/core/dist/` includes `hub/` and `cloud/`
library modules copied by the core plugin-runtime build. They are not the hub
application, have no executable entry point in the extension manifest, and are
not activated by the extension.

This is a **low-severity packaging observation**, not a shipped hub product.
Recommended future cleanup: trim the plugin-runtime copy to the modules actually
needed by the sandbox. It was not changed in this pass because the plugin
runtime's module graph is broad and removing files without a runtime test could
break plugin loading.

## 6. Packaging checks run

- `bunx @vscode/vsce ls --no-dependencies`: 189 files.
- ZIP inspection: manifest version `1.0.0`, publisher `bytos`, name `bytos`.
- `node scripts/check-licenses.mjs --vsix bytos-1.0.0.vsix`: all licence and
  required/forbidden file checks pass; the only failure is the expected missing
  `__metadata` block, which is written by `vsce publish`.
- `node scripts/package-release.mjs`: built the archive from the final tree after
  typecheck, webview build, production esbuild, and notice generation.

## 7. Findings

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| DIST-01 | No CLI executable or entry point ships | - | Verified |
| DIST-02 | No OpenCode runtime integration ships | - | Verified |
| DIST-03 | Core `hub/` and `cloud/` library modules are present in the plugin runtime | Low | Documented; future pruning |
| DIST-04 | `@bytos/cli-*` fallback string in plugin sandbox | Informational | Not an executable/dependency |
| DIST-05 | `__metadata` absent until first publish | Release-state | Documented blocker |
