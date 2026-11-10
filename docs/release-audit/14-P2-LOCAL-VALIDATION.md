# P2 — Local validation record for Bytos 1.0.2

**Date:** 2026-11-10
**Host:** Windows, Node `v26.13.0`, Bun `1.4.4`
**Extension under test:** `apps/vscode`, version 1.0.2, `engines.vscode`
`^1.101.0`

This file records what was actually executed for the P2 implementation. A
failure is recorded as a failure; nothing here is inferred from an earlier run.
The integration harness used VS Code `1.145.2`.

## Type checks — PASS

| Command | Result |
|---|---|
| `apps/vscode: bunx tsc --noEmit` | 0 errors |
| `apps/vscode: bunx tsc -p tsconfig.vscode-compat.json --noEmit` | 0 errors |
| `apps/vscode/webview-ui: bunx tsc --noEmit` | 0 errors |
| `bun --parallel -F "./sdk/packages/**" typecheck` | All SDK packages completed |
| `bun -F @bytos/cli typecheck` | 0 errors |
| `bun -F @bytos/bytos-hub typecheck` | 0 errors |
| `bun -F @bytos/api typecheck` | 0 errors |

## Extension unit tests — 1 environment failure

Command: `bun scripts/run-bun-unit-tests.ts`

- 91 files, **1237 passed**, **1 failed**.
- Failure: `src/core/context/instructions/user-instructions/__tests__/bytos-rules.test.ts`
  — `EPERM: operation not permitted, symlink` while creating a symlink on
  Windows. The test exercises the path-safety rule and cannot create the
  symlink in this host environment. It is not a code regression from P2.

## Extension vitest suites — PASS

Command: `bunx vitest run --config vitest.config.ts`

- **155 test files passed**, **2071 tests passed**.
- Includes the new XLSX regression test, account/auth-adjacent suites, and the
  voice suites configured in `vitest.config.ts`.

## Webview tests — PASS

Command: `cd apps/vscode/webview-ui && bun run test`

- **90 test files passed**, **723 tests passed**.

## Extension integration tests — PASS

Command: `cd apps/vscode && bun run test:integration`

- **225 passing**, **1 pending**, exit code 0.
- VS Code test runtime: `1.145.2`.

## Extension E2E tests — 1 UI-automation failure

Command: `cd apps/vscode && bun run test:e2e`

- **13 passed**, **1 skipped**, **1 failed**.
- Failure: `src/test/e2e/editor.test.ts` — the editor quick-input / "Add to
  Bytos" interaction timed out while the UI element was not stable. The failure
  occurred in the Playwright editor-automation path, after 4.8 minutes, and was
  retried once. It is not a packaging or licensing failure.

## SDK tests

| Suite | Command | Result |
|---|---|---|
| Agents | `bun -F @bytos/agents test` | **152 passed** |
| LLMs | `bun -F @bytos/llms test` | **1062 passed**, 35 skipped, 53 files passed / 7 skipped |
| Shared | `bun -F @bytos/shared test:unit` | **501 passed**, 5 skipped |
| UI | `bun -F @bytos/ui test` | **347 passed**, **3 failed** |
| Core unit | `bun -F @bytos/core test:unit` | **3125 passed**, **8 failed**, 96 skipped |
| Hub | `bun -F @bytos/bytos-hub test` | **113 passed** |
| API worker | `bun -F @bytos/api test` | **48 passed** |

### UI failures

`tests/agent-context-usage.test.tsx` expects comma-grouped numbers
(`2,000`, `1,500`) but this host formats them with dots (`2.000`, `1.500`). The
same three assertions fail with `LANG=en-US`/`LC_ALL=en_US.UTF-8`; the host
locale is not overriding the formatter. This is a locale-sensitive test
expectation, not a change in the P2 diff.

### Core unit failures

1. `src/hooks/hook-file-hooks.test.ts` — 3 failures around legacy hook
   execution/shebang handling on this Windows host.
2. `src/runtime/orchestration/runtime-builder.test.ts` — 2 failures in MCP tool
   and hub-agent-plugin composition.
3. `src/services/cloud-handoff/git-preflight.test.ts` — 2 failures because the
   test expects `https://github.com/Balahurra/Bytos` while the input is
   `git@github.com:bytos/bytos.git`. The test expectation is stale relative to
   the canonical repository URL.
4. `src/tasks/specs/task-spec-parser.test.ts` — 1 `EPERM` symlink failure.

These are outside the P2 file changes. The symlink and Bun-PATH failures are
environment-specific; the git-preflight expectation is a pre-existing test
mismatch.

## CLI tests

### CLI unit suite — NOT COMPLETED

Command: `bun -F @bytos/cli test:unit`

- The suite did not complete within a 30-minute window and was terminated.
- Before termination it reported failures in `src/commands/plugin.test.ts`
  (6), `src/commands/doctor.test.ts` (2),
  `src/connectors/adapters/slack.test.ts` (1), and
  `src/commands/update.test.ts` (1).
- No pass/fail summary was produced, so this suite is **not verified**.

### CLI E2E — 28 passed, 7 failed

Command with Bun on `PATH`: `bun -F @bytos/cli test:e2e`

- **28 passed**, **7 failed** in `src/cli.e2e.test.ts`.
- Failing cases: help output, config JSON flag placement, unknown hub
  subcommand error, Documents/Bytos workflows, Documents/Bytos rules and
  skills, plugin listing, and tool listing. These are CLI output/expectation
  mismatches outside the P2 diff.

### Core E2E — 5 passed, 1 failed

Command with Bun on `PATH`: `bun -F @bytos/core test:e2e`

- **5 passed**, **1 skipped**, **1 failed**.
- The failure asserts the fixture prints `bun 1.4.2`; this host runs Bun 1.4.4.

## Packaging and license gates — PASS

Command: `cd apps/vscode && node scripts/package-release.mjs`

- Type check, Biome, production webview build, esbuild, notice generation, and
  `vsce package` all completed.
- License gate: passed.
- Archive inspection: required files present, no unexpected files.

### Final VSIX

| Field | Value |
|---|---|
| File | `bytos-1.0.2.vsix` |
| Size | 17,479,051 bytes |
| Files | 203 |
| SHA-256 | `AE3FD96DE52A1CB9A1791748F231DC600D32F8BE15847B32C44F685641153BAB` |
| Version | 1.0.2 |
| `engines.vscode` | `^1.101.0` |
| Publisher | `bytos` |
| License | Apache-2.0 |
| `extension/dist/extension.js` SHA-256 | `41d267a1ef19c9849fa1423b33a33a811c5b8ccd5b0df596d52e8213c6fa622c` |
| Local `dist/extension.js` SHA-256 | `41d267a1ef19c9849fa1423b33a33a811c5b8ccd5b0df596d52e8213c6fa622c` |

### VSIX content checks

- `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.txt`,
  `THIRD-PARTY-NOTICES.json`, `PRIVACY.md`, `README.md`, and `CHANGELOG.md`
  are present.
- The voice helper and whisper.cpp engine/license are present.
- No `extension/src`, `extension/node_modules`, `extension/scripts`, or
  `extension/tests` entries.
- The bundle contains no `buffers` marker and no ExcelJS markers; JSZip is
  present.
- Inventory: 2,257 packages, 5 unresolved entries, no `buffers`.
- The packaged `PRIVACY.md` contains the optional-account description and no
  longer contains the "No Bytos account or backend" claim.
- The packaged `README.md` contains the optional-account description and no
  "no Bytos backend" claim.

## Not verified

- The CLI unit suite did not finish, so its overall status is unknown.
- Full cross-platform release behavior (macOS/Linux native voice, arm64) was not
  exercised on this Windows host.
- Marketplace installation, publisher identity, and the live website were not
  exercised; they are external actions.
