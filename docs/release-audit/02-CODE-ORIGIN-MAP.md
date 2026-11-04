# 02 - Code origin map

This document classifies the source in this repository by origin. It is the
input to the Apache-2.0 Section 4 obligations in `03-LICENSE-AND-ATTRIBUTION.md`.

**Read this first - instrument limitations.** The local Git history is a single
squashed import (`822988f "Initial Bytos: rebranded coding agent, ..."`) with no
upstream remote, no merge base, and a single synthetic author. Therefore:

- No file can be proven "byte-identical to Cline at commit X" from this repo.
- Classification below uses three kinds of evidence: (1) path/structure
  equivalence with `github.com/cline/cline`, (2) in-file statements that name the
  upstream layout ("Replaces classic `src/core/controller/index.ts`"), and (3) the
  scoped, reviewable diff this audit produced against `HEAD`.
- Where evidence is missing the file is marked **inferred** rather than asserted.
- No file was deleted or relicensed on the basis of a guess.

Categories:

- **A** - taken from Cline unchanged (inferred; strong path/structure match).
- **B** - taken from Cline and modified by Bytos.
- **C** - rebuilt on Cline infrastructure with substantial new design.
- **D** - created independently by Bytos.
- **E** - third-party source vendored into this repository.
- **F** - origin or licence status unclear.

## A. Cline-derived, believed unchanged

These are visible in the VSIX only inside the esbuild bundle and the copied
plugin runtime, so the licence obligation is discharged at the bundle level by
`LICENSE` + `NOTICE`.

| Area | Evidence |
|---|---|
| `apps/vscode/proto/**`, `apps/vscode/walkthrough/**`, `apps/vscode/tsconfig*.json`, `apps/vscode/biome.jsonc` | Identical structure and content to the upstream layout; no Bytos-specific content. |
| `apps/vscode/src/core/controller/**` outside `models/updateApiConfiguration*.ts` and `state/getStateToPostToWebview.ts` | Handler-per-request structure preserved (`Empty`, `convertProtoToApiProvider`, `subscribeTo*` naming). |
| `apps/vscode/src/integrations/{browser,terminal,git,diagnostics,theme}/**` | Upstream integration layout; Bytos changes live in `misc/extract-text.ts` only. |
| `sdk/packages/{shared,llms,agents,core}` outside the files listed in B and C | Upstream SDK package layout (`src/providers`, `src/extensions/tools`, `src/services`). |

Confidence: **inferred**. Functionally these are the Apache-2.0 "Work"; they are
distributed inside `dist/extension.js` and `dist/plugin-runtime`.

## B. Cline-derived and modified by Bytos

As of this audit these files carry a header naming the upstream copyright, the
Bytos modification, the upstream URL, and a one-line change summary.

| File | Bytos change |
|---|---|
| `apps/vscode/src/extension.ts` | Credential store, fail-closed tool policy, Bytos command IDs, host-bridge init; account/cloud/catalog boot paths removed. |
| `apps/vscode/src/core/webview/WebviewProvider.ts` | CSP drops `unsafe-eval` and wildcard sources; host bridge initialized before webview creation. |
| `apps/vscode/src/core/controller/models/updateApiConfiguration.ts` | API keys redacted before persistence and before echoing back. |
| `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts` | Webview state never carries keys; only masks/flags. |
| `apps/vscode/src/sdk/vscode-file-read-executor.ts` | Paths outside the workspace boundary rejected before the host reads them. |
| `apps/vscode/src/sdk/sdk-tool-policies.ts` | Fail-closed approval defaults; unknown categories inherit the strictest policy. |
| `apps/vscode/src/integrations/misc/extract-text.ts` | Additional attachment formats (PDF, office, media) and normalized output. |
| `apps/vscode/src/shared/storage/storage-context.ts` | Credentials resolved through the host credential store. |
| `apps/vscode/src/shared/AutoApprovalSettings.ts` | New tool categories and fail-closed defaults. |
| `sdk/packages/core/src/services/storage/provider-settings-manager.ts` | Credentials moved out of `providers.json` into SecretStorage with verified migration. |
| `sdk/packages/llms/src/providers/builtins.ts` | Vendor SDK providers removed from the built-in registry. |
| `sdk/packages/llms/src/providers/ids.ts` | Provider ID list trimmed and Bytos aliases added. |
| `apps/vscode/src/sdk/SdkController.ts` | The SDK-backed controller adds Bytos session, checkpoint, credential, and Auto Phase wiring on top of the classic SDK session bridge. |
| `sdk/packages/llms/src/providers/vendors/community.ts` | The MVP provider-manager core was reduced to the providers that ship in this build; Claude Code subscription, SAP AI Core, and other providers whose SDK licenses do not permit redistribution here were removed. |

Also modified, not individually headered (mechanical or clearly scoped changes,
covered by the bundle-level notice):
`apps/vscode/src/core/controller/models/updateApiConfigurationPartial.ts`,
`updateApiConfigurationProto.ts`, `apps/vscode/src/core/storage/utils/state-helpers.ts`,
`apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts`, `telemetry-settings-sync.ts`,
`apps/vscode/src/services/cloud/cloudSessionsFeature.ts`,
`apps/vscode/src/services/telemetry/providers/{opentelemetry,posthog}/*`,
`apps/vscode/src/shared/storage/{BytosFileStorage,BytosStorage,state-keys}.ts`,
`apps/vscode/webview-ui/src/**` (24 files), `sdk/packages/{shared,agents,llms,core}/src/**`
(remaining files except `community.ts`, listed above), `sdk/packages/*/package.json`,
root `package.json`,
`apps/vscode/package.json`, `apps/vscode/esbuild.mjs`, `apps/vscode/.vscodeignore`,
`apps/vscode/vitest.config.ts`.

Confidence: **verified for this review's diff**; **inferred** for changes made
before the import commit.

## C. Rebuilt on Cline infrastructure

| File | Why category C |
|---|---|
| `apps/vscode/src/sdk/SdkController.ts` | Its own header says it "Replaces classic `src/core/controller/index.ts`". Re-implements the controller on the Bytos SDK session bridge and adds session/checkpoint/credential/Auto Phase wiring. |
| `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts` | Extracted from the classic controller for reuse by the SDK controller ("Extracted from classic ..."). |
| `apps/vscode/webview-ui/src/**` (399 files) | Substantial UI rework on the upstream React/Vite base (branding, Auto Phase Plan, attachments, settings re-organization). Individual files are a mix of A/B/C; the tree as a whole is C. |

## D. Independently created by Bytos

| File | Purpose |
|---|---|
| `apps/vscode/scripts/check-licenses.mjs` | Release licensing gate (rewritten in this audit). |
| `apps/vscode/scripts/generate-third-party-notices.mjs` | Third-party inventory generator. |
| `apps/vscode/scripts/license-exceptions.json` | Justified exceptions for UNKNOWN-licence packages. |
| `apps/vscode/scripts/package-release.mjs` | Reproducible packaging + archive inspection (added in this audit). |
| `apps/vscode/src/__tests__/readme-and-packaging.test.ts` | README/packaging contract test (added in this audit). |
| `apps/vscode/THIRD-PARTY-NOTICES.txt`, `.json` | Generated notice inventory. |
| `NOTICE`, `PRIVACY.md`, `TRADEMARKS.md`, `apps/vscode/NOTICE`, `apps/vscode/PRIVACY.md` | Legal/project documents written for Bytos. |
| `docs/release-audit/*` | This audit set. |
| `apps/vscode/src/hosts/vscode/vscode-secret-storage.ts`, `vscode-provider-credential-store.ts`, `src/shared/storage/secret-mask.ts`, `src/core/controller/state/redactApiConfiguration.ts` | Credential layer from the BYOK work. |
| `sdk/packages/core/src/extensions/tools/executors/path-safety.ts` | Workspace boundary enforcement. |
| `apps/vscode/assets/icons/*`, `assets/branding/*` | Bytos brand assets (authorship unverified - see `01` section 7). |
| `apps/cli/**`, `apps/bytos-hub/**`, `apps/examples/**`, `apps/vscode-rollout/**` | Bytos surfaces that do not exist upstream in this form. |

## E. Third-party sources vendored into this repository

| Item | Source | Licence status |
|---|---|---|
| `apps/vscode/assets/icons/social/*.svg` | Discord/GitHub/LinkedIn/Reddit/X logos used as link icons. | Third-party **trademarks**, not software licences. Nominative use for linking, but redistribution terms are not verified. Open item, see `03`. |
| `apps/vscode/bin/ripgrep*` | ripgrep binaries fetched by `bun run download-ripgrep`. | ripgrep is MIT OR Apache-2.0; the binaries are downloaded, not committed. |
| `patches/*.patch` | Local patches to `@opentui-ui/dialog`, `ollama-ai-provider-v2`, `@shadcn/react`. | Applied at install; the patched packages keep their own licences. |
| `apps/vscode/webview-ui/build/assets/*` (generated) | Vite output including `mermaid`, `katex`, `cytoscape`, the Geist/Inter OFL fonts and `codicon`. | Listed with texts in `THIRD-PARTY-NOTICES.txt` (2,394 packages inventoried). |
| `sdk/packages/core/src/hub/client/__fixtures__/localhost-cert.pem` | Self-signed test certificate fixture for the hub TLS client. | Test material, no secret, not packaged. |

## F. Origin or licence status unclear

| Item | Why unclear | Action taken |
|---|---|---|
| 13 packages with no resolvable licence (`UNKNOWN` in `THIRD-PARTY-NOTICES.txt`) | No usable metadata or LICENSE file. | Each is enumerated with a written justification in `apps/vscode/scripts/license-exceptions.json`, and the gate fails if a new UNKNOWN appears. Several are documented as not in the production input graph. **Legal review still required.** |
| `apps/vscode/assets/icons/social/*` | Trademark rather than copyright. | Reported, not removed; deleting the navigation icons would degrade the UI. |
| Brand assets | Authorship cannot be proven from the repo. | Reported; requires human confirmation of origin. |
| Category A files | Byte-level upstream equivalence cannot be proven locally. | Treated as derivative work of the whole, which is the conservative reading. |

