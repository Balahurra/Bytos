# 10 - CI failure resolution

Date: 2026-11-04
Target workflow: `.github/workflows/ext-vscode-test.yml`
Authoritative Linux environment: GitHub Actions (`ubuntu-latest`).
Local development environment: Windows (no WSL, no Docker, no native Linux).

## 1. Original failures

Run `41923196014` (`fad5c10`) and run `41925969272` (`4296002`) produced the same
failure set.

| Job | Result | Failing detail |
|---|---|---|
| Quality Checks | PASS | - |
| vscode test (ubuntu-latest) | FAIL | Unit Tests (bun) - Linux: 1,186 passed / 12 failed across 5 hook fixture suites |
| vscode test (windows-latest) | FAIL | Vitest Suites: 8 failed / 1,588 passed in 2 files (unit + integration + webview steps passed) |
| test-platform-integration | FAIL | recorded gRPC session `grpc_recorded_session_single_root.json`: `Request message serialization failure: undefined is not an object (evaluating 'v of message.attachments')` |
| test (aggregate gate) | FAIL | Aggregator correctly reported the upstream failures |
| qlty | SKIPPED | Gated on the same jobs |

The failing files were exactly:

- `src/core/hooks/__tests__/taskcancel.test.ts` (4)
- `src/core/hooks/__tests__/taskcomplete.test.ts` (2)
- `src/core/hooks/__tests__/taskresume.test.ts` (2)
- `src/core/hooks/__tests__/taskstart.test.ts` (2)
- `src/core/hooks/__tests__/user-prompt-submit.test.ts` (2)

(There is no `user-prompt-state.test.ts` in the tree; the reported name was
incorrect. The fifth failing file is `user-prompt-submit.test.ts`.)

## 2. Exact root causes

### RC-1 - Linux hook fixtures lost their executable bit (12 failures)

The fixture suites copy a fixture script into a temporary hooks directory and
execute it through `sh -c <path>`. The fixture files were committed as mode
`100644`; `loadFixture()` copied them and re-applied the source mode, so on
Linux the script had no execute permission. `/bin/sh` therefore returned
"permission denied" (exit 126) with empty stdout, which the readers interpreted
as an empty hook output (`expected '' to be ...`) or as an unhandled
non-throwing case (`Should have thrown`). Windows was unaffected because the
suite writes a PowerShell bridge on that platform.

This one cause explains all 12 Linux failures. No production hook code was at
fault: the runtime executes user hooks through the shell, and a user-authored
hook is expected to be executable.

### RC-2 - Short (8.3) temp path vs canonical path on Windows CI (8 failures)

`os.tmpdir()` on the GitHub Windows runner returns the short form
`C:\Users\RUNNER~1\AppData\Local\Temp`. The product canonicalizes workspace
paths with `fs.realpath` (required by the path-safety work), which expands that
to `C:\Users\runneradmin\...`. The tests compared against the un-canonicalized
`mkdtemp()` result, so object equality and `toHaveBeenCalledWith` failed only on
CI's short-path runner. Locally `os.tmpdir()` is already canonical, which is why
the same files passed on this machine.

Affected: `sdk-diff-edit-coordinator.test.ts` (7 failures) and
`vscode-file-read-executor.test.ts` (1 failure).

### RC-3 - Stale gRPC recording missing the new repeated field

`NewTaskRequest` gained `repeated ChatAttachment attachments = 9` after the
recording was captured. The replay harness passes the recorded JSON object
straight to the generated gRPC serializer, which iterates `message.attachments`;
`undefined` throws. A live client always sends the field as `[]` (protobuf
default), so the recording was stale, not the product.

### Independently observed, non-blocking

- Windows "Extension Integration Tests" logs an `EBUSY: ... rmdir vscode-test-…`
  cleanup warning, but the runner itself exits 0 (`219 passing`, host exit code
  0). It did not fail the job.
- The aggregate `test` job fails only because its dependencies fail; its logic
  is correct.

## 3. Production code changes

**None.** Every root cause was in test fixtures, test path handling, or
developer tooling. Product behaviour was not changed to make tests green.

## 4. Test code changes

| File | Change |
|---|---|
| `apps/vscode/src/core/hooks/__tests__/fixtures/hooks/**/*` (33 files) | Recorded as mode `100755` in the Git index, so Linux checkouts are executable. Content unchanged. |
| `apps/vscode/src/core/hooks/__tests__/test-utils.ts` | `loadFixture()` now forces `0755` on Unix instead of copying `stats.mode`, so a Windows checkout that loses the bit still produces an executable fixture on Linux. |
| `apps/vscode/src/sdk/sdk-diff-edit-coordinator.test.ts` | `tempDir` is canonicalized with `fs.realpath(await fs.mkdtemp(...))`. Assertions unchanged. |
| `apps/vscode/src/sdk/vscode-file-read-executor.test.ts` | `workspaceRoot` is canonicalized the same way. Assertions unchanged. |
| `apps/vscode/tests/specs/grpc_recorded_session_single_root.json` | The `newTask` request now includes the protobuf-default `"attachments": []`. |

No test was deleted, skipped, or weakened.

## 5. Workflow and tooling changes

| File | Change | Reason |
|---|---|---|
| `apps/vscode/scripts/download-ripgrep.mjs` | Cross-platform zip extraction (`Expand-Archive` on Windows, `unzip` elsewhere), absolute paths, clean destination, and a rewritten download that follows redirects **before** opening the destination stream. | The script was unusable on Windows: the pre-redirect write stream stayed open, locking the archive (`file is in use`), and `unzip` does not exist on Windows. CI Linux behaviour is unchanged. |

No workflow YAML was changed: the existing jobs, OS matrix, caching and test
filters are correct once the three root causes are fixed.

## 6. Windows local test results

| Check | Command | Result |
|---|---|---|
| Five failing hook suites | `bun test src/core/hooks/__tests__/{taskcancel,taskcomplete,taskresume,taskstart,user-prompt-submit}.test.ts` | **PASS** - 75 passed / 0 failed |
| Full bun unit suite | `bun run test:unit` (apps/vscode) | **PARTIAL** - 89 files, 1,195 pass / 1 fail. The single failure is `bytos-rules.test.ts` → `EPERM: symlink`, caused by the Windows account lacking the symlink privilege. It is environmental, predates this work, and passes on Linux CI. |
| Vitest suites | `bun run test:vitest` | **PASS** - 118 files, 1,596 tests |
| Typecheck | `bun run check-types` | **PASS** (exit 0) |
| Biome lint | `bunx biome lint ...` | **PASS** - 1,340 files, no errors |
| Proto lint | `./scripts/proto-lint.sh` | **BLOCKED locally** - `buf` is not installed on this machine. The same step runs in CI Quality Checks and passed there. |
| Webview tests | `bun run test:coverage` (webview-ui) | **PASS** - 80 files |
| Extension integration | `bun run test:integration` | **PASS on retry** - run 1: 218 passing / 1 failing (`getOpenTabs` 8 s timeout, flaky window focus); run 2: **219 passing / 1 pending, exit 0**. CI Windows reports the same 219 passing and exit 0. |
| Test platform (serializer check) | `bun run` a temporary script using `NewTaskRequest.encode` from the generated gRPC module | **PASS** - the unpatched recorded payload reproduces the exact CI error (`undefined is not an object (evaluating 'v of message.attachments')`); the patched payload with `attachments: []` encodes successfully. |
| Test platform (full orchestrator) | `bun run test:tp-orchestrator -- tests/specs/ --count=1` | **BLOCKED locally** - the standalone packaging step compiles `better-sqlite3` against Node 26 headers on this machine and fails (`v8::Object::GetPrototype` removed). CI uses the supported Node version. |
| Release build | `node scripts/package-release.mjs` | **PASS** earlier in this release; this change set touches tests/tooling only |

## 7. Linux GitHub Actions results

Verified on run [`41929354820`](https://github.com/Balahurra/Bytos/actions/runs/41929354820)
(commit `680674b`): **every job passed.**

| Job | Result | Evidence |
|---|---|---|
| Detect Changes | **PASS** | - |
| Quality Checks | **PASS** | typecheck + lint + build |
| vscode test (ubuntu-latest) | **PASS** | Unit Tests (bun) - Linux: `Files: 89  Pass: 1198  Fail: 0`; Vitest: 118 files passed; integration: 223 passing; webview: 80 files passed |
| vscode test (windows-latest) | **PASS** | Vitest: 118 files passed; unit: `All unit test files passed`; integration: 219 passing, host exit 0; webview: 80 files passed |
| test-platform-integration | **PASS** | recorded-session replay and standalone orchestration succeeded |
| test (aggregate gate) | **PASS** | dependencies all success |
| qlty | **PASS** | coverage upload |

The 12 Linux hook failures are gone; the 8 Windows short-path failures are
gone; the recorded-session serialization failure is gone.

## 8. Integration test results

| Environment | Result |
|---|---|
| Linux CI | **PASS** - 223 passing |
| Windows CI | **PASS** - 219 passing / 1 pending, host exit 0 |
| Windows local (run 1) | **FAIL** - 218 passing / 1 failing (`getOpenTabs` 8 s focus timeout; flake) |
| Windows local (run 2) | **PASS** - 219 passing / 1 pending, exit 0 |

The `EBUSY: ... rmdir vscode-test-…` line still appears on Windows but the
runner exits 0; it is a cleanup warning, not a failure.

## 9. Remaining problems

| Item | Status |
|---|---|
| `bytos-rules.test.ts` symlink test on this local Windows account | **BLOCKED locally** - `EPERM: symlink`; the account lacks the Windows symlink privilege. Ubuntu and the Windows CI runner pass it. |
| Local test-platform orchestrator | **BLOCKED** by the Node 26 / better-sqlite3 toolchain mismatch. The exact serialization bug was reproduced and fixed at the encoder level; full orchestration passed in CI. |
| Local proto lint | **BLOCKED** - `buf` is not installed locally. CI Quality Checks runs it and passes. |
| Windows `EBUSY` cleanup warning | Non-fatal; runner exits 0. Cosmetic only. |
| Workflow YAML | No changes required; the existing matrix, caching, filters and retry logic are correct. |

## 10. Final CI readiness

| Check | Status |
|---|---|
| Quality Checks | **PASS** |
| Linux Unit Tests | **PASS** - 1,198 passed / 0 failed |
| Windows Unit Tests | **PASS** |
| Extension Integration Tests | **PASS** (Linux 223, Windows 219) |
| Platform Integration Tests | **PASS** |
| Webview Tests | **PASS** |
| Typecheck | **PASS** |
| Lint | **PASS** |
| Build | **PASS** |

`ext-vscode-test` is genuinely green on both operating systems. No workflow was
disabled, no test was skipped, and no assertion was weakened.

## 11. Other workflows (separate from the required gate)

| Workflow | Status | Root cause / action |
|---|---|---|
| `sdk-test` | **IN PROGRESS** - fixed the failures found in run `41931402406`: (1) `@bytos/core` typecheck failed because `user-input-builder.test.ts` imported `bun:test`; (2) `@bytos/cli` typecheck required `telemetryOptIn` in its settings fixture; (3) Ubuntu CLI tests still asserted the removed Claude Code local-auth provider; (4) Windows `editor.test.ts` compared short/long temp paths; (5) desktop `import-view.test.tsx` expected the removed third (OpenCode) import tool. | All fixed: the import now uses vitest, the fixture includes the required field, the Claude Code expectations document its BYOK removal, temp dirs are canonicalized, and the import-view test covers the two current tools plus the not-detected state. Local `bun run types` exits 0; targeted tests pass. Windows `test:settings-ui` locally also shows unrelated `provider-list`/`settings-view` failures that did not appear in the CI job; tracked separately. |
| `ext-vscode-test-e2e` | **FAIL (pre-existing, unrelated)** | Fails since the first pushed commit. The Playwright suites target UI text that no longer exists in the BYOK webview (e.g. `Bring my own API key` appears only in the E2E files). The first failure is `auth.test.ts:8` waiting for `Login to Bytos`; the remaining failures cascade from the same stale onboarding flow. This is a test-maintenance task, not a regression from the CI fixes; it is reported separately and was not weakened or disabled. |

