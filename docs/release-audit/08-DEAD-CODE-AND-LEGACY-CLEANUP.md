# 08 - Dead code and legacy cleanup

Date: 2026-11-04
Scope: repository-wide dead-code, duplicate, legacy and unused-dependency audit
performed before the first public GitHub release. Nothing was published.

## 1. Method

1. Two independent audits were run: one for `apps/vscode` (the shipped VSIX) and
   one for the rest of the monorepo.
2. Static reachability was computed from the real entry points with esbuild's
   metafile: `src/extension.ts` (extension bundle), `standalone/bytos-core.ts`
   (standalone runtime), and the webview entry. The result was cross-checked
   against the source map of the **shipped** `dist/extension.js` (7,310 sources),
   so "unreferenced" means unreferenced at code level, not merely unshipped.
3. Every candidate was then grepped across the whole repository (including
   `proto/`, `src/generated/`, `sdk/packages`, scripts, tests and the webview) to
   catch dynamic imports, glob loaders and string-based discovery.
4. `knip` was available but produced false positives (alias/entry misconfig); its
   output was treated as a pointer only and every finding was re-verified by
   hand. The repository's own `scripts/find-dead-src.mjs` is broken on Windows
   (esbuild emits absolute-path keys), so it was not used as evidence.
5. Removal was limited to items verified as unreachable from every entry point
   and from runtime discovery (MCP, plugins, skills, provider registry,
   controller/protobuf registration, manifest contributions).

## 2. Classification key

| Class | Meaning |
|---|---|
| A | Required infrastructure (build, packaging, activation, release, migration) |
| B | Active Bytos functionality |
| C | Unused legacy functionality |
| D | Duplicate implementation |
| E | Uncertain - retained pending investigation |

## 3. Removed in this release (proven unnecessary)

### 3.1 Source files - `apps/vscode` (not in either bundle, no live importer)

| File | Class | Evidence |
|---|---|---|
| `src/utils/model-utils.ts` + `src/utils/__tests__/model-utils.test.ts` | C/D | Only importer was its own test; absent from extension bundle and shipped source map |
| `src/core/api/index.ts` | C | Types-only file imported only by the dead `model-utils` |
| `src/utils/process-termination.ts` | C | Zero importers repo-wide; not bundled |
| `src/shared/array.ts` + `src/shared/array.test.ts` | C/D | Only importer was its own test |
| `src/shared/tools.ts` | C | Zero importers; not bundled |
| `src/shared/storage/index.ts` | C | Dead barrel; all call sites import the concrete storage modules directly |
| `src/core/locks/types.ts` | C | Zero importers; `SqliteLockManager` declares its own types |
| `src/services/glob/list-files.ts` + `src/services/glob/__tests__/list-files.test.ts` | C | Cline-era ripgrep listing service; only importer was its own test |
| `src/core/storage/remote-config/fetch.ts` + `src/core/storage/__tests__/fetchRemoteConfig.test.ts` | C | Legacy SaaS config fetch; the live refresh path is `sdk-control-plane.ts` |
| `src/services/account/BytosAccountService.ts` + `src/test/services/BytosAccountService.test.ts` | C | Legacy account REST client; imported only by the dead `fetch.ts` and tests. (The live `src/sdk/account-service.ts` is unaffected and retained.) |

**Corrections made during verification.** The first reachability pass missed
alias and relative importers for four modules. The typecheck step caught them, and
all four were restored from `HEAD`:

| Restored module | Actual importer |
|---|---|
| `src/core/prompts/responses.ts` (+ `src/core/ignore/BytosIgnoreController.ts` and its test) | `core/prompts/__tests__/toolSpecificMissingParamErrors.test.ts` and `writeToFileMissingContentError.test.ts` import `../responses`; both modules are test-only (not bundled) but the tests are live contract coverage |
| `src/shared/storage/index.ts` | Barrel imported as `@/shared/storage` by `remote-config/utils.ts`, `storage/utils/state-helpers.ts`, `services/logging/distinctId.ts` and its test |
| `src/core/locks/types.ts` | `core/locks/SqliteLockManager.ts` imports `./types` |

This is the reason the final count below is lower than the initial candidate list:
"not statically imported" in the audit graph was not accepted as proof until the
type checker and the unit suite agreed. No shipped feature changed.

### 3.2 Webview components (zero importers, not in any route or registry)

| File | Class | Evidence |
|---|---|---|
| `components/cloud/RunningCloudTasks.tsx` | C | Zero importers; cloud UI is gated off in the BYOK build |
| `components/common/WhatsNewModal.tsx`, `components/common/WhatsNewItems.tsx` | C | Zero importers; announcement flow does not render the modal |
| `hooks/useFeatureFlag.ts` | C | Zero references repo-wide |
| `utils/bannerUtils.tsx` | C | Zero references |
| `components/settings/providers/BytosPassProvider.tsx` | C | Zero importers; the settings registry no longer selects this provider (the pass card and controller remain live) |

### 3.3 Scripts, docs and release infrastructure

| Item | Class | Evidence |
|---|---|---|
| `apps/vscode/scripts/proto-shared-utils.mjs` | D | Duplicate of `proto-utils.mjs`, zero references |
| `apps/vscode` scripts `analyze:unused:fix-exports` and `:dry` | Dangling | Referenced a non-existent `scripts/remove-unused-exports.mjs`; removed the broken script entries |
| `apps/vscode-rollout/` (17 files) | C | Orphaned A/B rollout harness. Its own skill doc calls it historical: "Remove apps/vscode-rollout/ and rollout-only code paths". Not used by the shipped 4.2.0 package |
| `.github/workflows/ext-vscode-ab-package.yml`, `ext-vscode-publish-nightly.yml` | C | Only consumers of the rollout harness; manual `workflow_dispatch`-only |
| `docs/hubspot.js` | C | Unreferenced by `docs.json` or any page |

### 3.4 Dependencies removed (`apps/vscode` and webview)

All verified as zero imports across apps, sdk, scripts and tests. `bun install`
removed 19 packages from the resolved tree and pruned the stale lock entries.

`clone-deep`, `default-shell`, `os-name`, `p-mutex`, `p-timeout`, `shell-quote`,
`strip-ansi`, `ulid` (runtime), `@microsoft/tui-test`, `protoc-gen-ts`,
`@types/clone-deep`, `@types/shell-quote` (dev), and webview
`@floating-ui/react`, `@paper-design/shaders-react`, `@radix-ui/react-slider`,
`firebase`, `magic-string`.

Additionally, the stale `jschardet@^3.1.4` lock entry - a declared but never
imported LGPL package - is gone from `bun.lock` after the lockfile refresh.

## 4. Deliberately retained (with reason)

| Item | Class | Why retained |
|---|---|---|
| `src/core/context/context-tracking/FileContextTracker.ts` | C/E | Zero live callers supply it, but it is still injected positionally in several `mentions/index.test.ts` cases. Removal requires touching the live mention-parsing signature; deferred to a dedicated change to keep this release risk-free |
| `src/services/cloud/**`, cloud controllers/proto, `dist` wiring | B (disabled) | Wired and reachable everywhere, but feature-gated off in the marketplace BYOK build. Removing it is a coordinated multi-surface change with no user benefit in 4.2.x; documented as a future cleanup |
| `community.ts` Claude Code / SAP AI Core throwing stubs | B/C | Provider IDs remain part of the generated catalog; the stubs fail closed with an explicit message. Removing the SAP dependency and stub (and root `@sap-cloud-sdk/*` overrides) is proposed as a follow-up, not done here because it touches the provider registry and skipped test suites |
| `src/core/controller/grpc-recorder/**` | A/E | Bundled and active; dormant unless recording is enabled. No runtime cost when off |
| Legacy storage migration chain (`vscode-to-file-migration`, `legacy-state-reader`, `state-migrations`, `openai-base-url-migration`) | A | Runs at activation and is required for upgrades from 4.1.x |
| `src/dev/**` (debug harness, local cloud server, MCP OAuth test server) | B (dev) | Wired to dev scripts or documented manual use |
| `scripts/find-dead-src.mjs` | C (tool) | Known-broken on Windows; retained as a starting point and documented as a bug rather than silently deleted |
| `apps/vscode-rollout`-adjacent rollout telemetry paths inside `apps/vscode` | E | Not verified as fully isolated in this pass |
| `evals/` | E (manual harness) | Not CI-referenced, but harmless and documents the benchmark scenarios |
| `apps/examples/bytos-core-cli-agent` | D | Duplicate demo of `cli-agent`, but useful documentation; merging is editorial, not cleanup |
| `docs/` pages for SAP / Claude Code subscription | C | Documentation site content; needs an editorial update, not a silent deletion, and the site build is not part of the VSIX |
| `PRIVACY.md`, `README.marketplace.md` snapshots | A | Required by packaging and the README regression gate |

## 5. Cleanup side-effects to watch

- `knip` config still needs an entry-point fix; not changed here.
- The CLI TUI provider picker still lists `sapaicore` / `claude-code`; selecting
  them shows a closed error. This is a UX defect, not dead code, and is recorded
  as a follow-up rather than changed in a cleanup commit.
- `apps/vscode/scripts/api-secrets-parser.mjs`, `repro-cloud-session.mjs`,
  `runbytoscore.sh`, `get-vscode-usages.sh`, `add-endpoints-to-*.sh` and
  `run-extension-host.ps1` are unreferenced but are manual developer/ops helpers
  (class E); they were retained and are listed here for a future review.

## 6. Verification

Removal was validated with the full gate documented in `07` and
`05` (typecheck x2, lint, unit suite, webview build, production bundle, licence
gate and VSIX archive inspection). Results are recorded in section 8 of `07`.

## 7. Net effect

- 13 source/test files removed from `apps/vscode` (after restoring the four
  modules the typechecker proved to be referenced).
- 6 webview files removed.
- 1 documentation script, 1 dev script, 1 release harness directory (17 files)
  and 2 orphaned workflows removed.
- 17 direct dependencies removed (12 from `apps/vscode`, 5 from the webview),
  and 19 packages dropped from the resolved tree (including the stale
  `jschardet` lock entry).
- 46 files untracked from git-ignored agent-state directories (kept locally).
- No shipped runtime entry point, provider, tool, MCP/plugin/skill path,
  command or migration was removed.

## 8. VS Code package exclusions: Bytos CLI and OpenCode (2026-11-04)

The product is the VS Code extension, so two integration families that had
leaked into the extension package were removed from it entirely.

### 8.1 Bytos CLI install/detect feature

The extension still carried Cline-era plumbing that checked for and installed a
`bytos` CLI (`installBytosCli`, `checkCliInstallation` RPCs, the controller
handlers, `utils/cli-detector.ts`, the `install-cli` banner action and the
`updateCliBannerVersion` RPC). No webview surface triggered the install path.

Removed: both RPCs plus `updateCliBannerVersion` from `proto/bytos/state.proto`
(protobufs regenerated), `core/controller/state/{installBytosCli,
checkCliInstallation,updateCliBannerVersion}.ts`, `utils/cli-detector.ts`, the
`BannerActionType.InstallCli` value and its test entry.

### 8.2 OpenCode integration

`ai-sdk-provider-opencode-sdk` (which bundles `@opencode-ai/sdk`) entered the
extension bundle through the `opencode` local-CLI provider. The package also
carried the `opencode` and `opencode-go` catalog providers and an OpenCode
session-import adapter. All of it was removed:

- dependency `ai-sdk-provider-opencode-sdk` (and the transitive
  `@opencode-ai/sdk`) removed from `sdk/packages/llms/package.json`;
- `createOpenCodeProviderModule`, the `opencode` AI-SDK case, provider registry
  entry, `BUILT_IN_PROVIDER.OPENCODE`, builtin-family unions, routing tables,
  request-header special case, config types and the live-catalog Qwen override;
- generated provider specs and catalog blocks for `opencode` / `opencode-go`,
  plus the `provider-keys.ts` mapping so regeneration does not reintroduce them;
- the `opencode` session-import adapter, its path helper, type entry, UI labels
  and the desktop import-picker references;
- the now-unused `stripRogueSignalHandlers` helper and OpenCode-specific tests.

**Verification after rebuild:** `dist/extension.js` contains **zero**
occurrences of `opencode` integration code (`@opencode-ai`, `OpencodeClient`,
`createOpencode*`, the provider id); the three remaining substring hits are
documentation URLs of unrelated providers (AgentRouter, Infer, Pendra). It also
contains zero occurrences of `Bytos CLI`, `installBytosCli`,
`checkCliInstallation`, `isBytosCliInstalled` or `npm install -g bytos`.
`llms` typecheck and 97 targeted tests pass; the extension unit suite is
1,195 pass / 1 environmental symlink failure. The generated third-party
inventory dropped from 2,396 to 2,394 packages because the two OpenCode packages
are no longer installed or bundled.

The `apps/cli` source tree remains in the monorepo, but it is not part of the
VSIX and is not published to npm. Its README now states that explicitly.

### 8.3 Product documentation alignment

The root README now presents Bytos as a VS Code extension, marks the VSIX as the
only distributed package, and no longer advertises unpublished npm installs.

