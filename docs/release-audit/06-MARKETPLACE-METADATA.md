# 06 - Marketplace metadata

Date: 2026-11-05
Status: prepared, **not published**. No `vsce publish` was run.

## 1. Final manifest metadata

| Field | Proposed / current value |
| --- | --- |
| `name` | `bytos` |
| `displayName` | `Bytos` |
| `version` | `1.0.0` |
| `publisher` | `bytos` (**identity not yet verified against the Marketplace account**) |
| `description` | See section 2 |
| `engines.vscode` | `^1.101.0` |
| `categories` | `AI`, `Chat`, `Programming Languages` |
| `keywords` | 15 terms; see section 3 |
| `icon` | `assets/icons/icon.png` (PNG, 256 x 256, 15,666 bytes) |
| `repository` | `https://github.com/Balahurra/Bytos` |
| `homepage` | `https://bytos.dev` |
| `bugs` | `https://github.com/Balahurra/Bytos/issues` |
| `license` | `Apache-2.0` |
| `galleryBanner` | `#070B14`, dark |
| `activationEvents` | `onUri`, `onStartupFinished` |
| `extensionDependencies` | none |
| `extensionPack` | none |
| `pricing` | free; BYOK, no Bytos subscription |
| `__metadata` | **absent**; written by the first `vsce publish`, not fabricated |

## 2. Description

> Bytos is an open-source AI coding agent for Visual Studio Code. It plans before
> it edits, asks before it acts, and can edit files, run commands, use the
> browser, and call MCP tools with your approval. Bring your own API key (BYOK);
> no Bytos account or backend is required.

This description is accurate for the 1.0.0 build. It does not claim a parallel
multi-agent system, a CLI/desktop distribution, or a hosted Bytos service.

## 3. Keywords

```
bytos
ai
ai-coding-agent
ai-coding-assistant
autonomous-agent
coding-assistant
developer-tools
llm
mcp
model-context-protocol
multi-provider
open-source
vs-code
vscode-extension
byok
```

Rationale:

- `ai-coding-agent`, `ai-coding-assistant`, `coding-assistant`, `developer-tools`
  match the product category.
- `llm`, `multi-provider`, `byok` match the BYOK model configuration.
- `mcp`, `model-context-protocol` match the implemented MCP integration.
- `open-source`, `vscode-extension`, `vs-code` match the distribution.
- `bytos` is the brand term.
- `cline` is **not** used as a keyword, to avoid implying an official Cline
  product. Cline lineage is disclosed in the attribution section instead.

No keyword stuffing, competitor impersonation, or unrelated terms.

## 4. Listing body and assets

| Item | Status |
| --- | --- |
| Marketplace README (`apps/vscode/README.marketplace.md`) | Rewritten for 1.0.0; packaged as `README.md` |
| README sync test | `src/__tests__/README.package.md` matches the Marketplace README; 14 tests pass |
| Icon | PNG 256 x 256, meets the Marketplace minimum |
| Demo GIF | `assets/docs/demo.gif`, 1200 x 675, 1.34 MB, referenced by an HTTPS raw GitHub URL |
| Screenshots | Demo GIF plus the website screenshots; no broken relative paths in the listing |
| Changelog | `CHANGELOG.md` has a truthful `1.0.0` entry above the preserved `4.2.0` history |
| License | Apache-2.0, shipped in the VSIX |
| Privacy | `PRIVACY.md`, shipped in the VSIX |
| Security | `SECURITY.md`; private vulnerability reporting enabled on GitHub |

The Marketplace README uses only HTTPS PNG/GIF assets. It does not use untrusted
SVG badges or a Marketplace URL that does not exist yet.

## 5. Marketplace URL

The listing does not exist yet, so no public page links to
`marketplace.visualstudio.com/items?itemName=bytos.bytos`. The website install
buttons point to the GitHub install section until publication. A placeholder URL
appears only in internal audit documents, never as a working public link.

## 6. Publication steps (manual, after authorisation)

> **Preferred path:** use `.github/workflows/publish-marketplace.yml` (GitHub
> OIDC Trusted Publishing, no PAT) and follow
> [`13-TRUSTED-PUBLISHING.md`](13-TRUSTED-PUBLISHING.md). The PAT steps below
> are the legacy fallback and are not used by the Trusted Publishing workflow.

1. Confirm the `bytos` publisher exists in the Visual Studio Marketplace
   publisher management page and is owned by the publishing account.
2. Create a PAT with Marketplace **Manage** scope. Expose it only as `VSCE_PAT`
   in the release environment; never commit it.
3. From `apps/vscode`:
   ```bash
   node scripts/package-release.mjs
   node scripts/publish-marketplace.mjs
   ```
4. `vsce publish` writes `__metadata` into `package.json`. Commit that manifest
   change afterwards.
5. Set `BYTOS_PUBLISHER=bytos` for subsequent release-gate runs.
6. Add the real Marketplace URL to the website and README in a separate change.

Do **not** run step 3 without explicit authorisation.
