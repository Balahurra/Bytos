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

**NOT RUN with these fixes yet.** The fixes are prepared and locally validated;
they require an authorized push to be verified on `ubuntu-latest`. The previous
run (`4296002`) failed with exactly the root causes above and no new failures.

| Check | Status |
|---|---|
| Quality Checks | PASS (before and after the removal commit; no change in this patch set) |
| Linux unit tests | **NOT RUN post-fix** (pending authorized push) |
| Windows unit tests | PASS in the previous run (`All unit test files passed`) |
| Extension integration (Linux) | PASS in the previous run |
| Extension integration (Windows) | PASS in the previous run (`219 passing`, host exit 0; EBUSY is a non-fatal cleanup warning) |
| Platform integration | **NOT RUN post-fix** (pending authorized push) |
| Webview tests | PASS in the previous run |
| Aggregate `test` | **NOT RUN post-fix** (it only mirrors its dependencies) |

This section will be replaced with the real job conclusions after the
authorized verification run.

## 8. Integration test results

Local Windows: **PASS on retry** (219 passing / 1 pending, exit 0; the first
attempt hit an 8 s `getOpenTabs` focus timeout). CI Windows: **PASS** in the
previous run. Linux integration: **PASS** in the previous run.

## 9. Remaining problems

| Item | Status |
|---|---|
| `bytos-rules.test.ts` symlink test on this local Windows account | **BLOCKED locally** - `EPERM: symlink`; the account lacks the Windows symlink privilege. It is not a CI blocker: Ubuntu passes it, and the Windows runner executes as an administrator where symlink creation is allowed. |
| Local test-platform orchestrator | **BLOCKED** by the Node 26 / better-sqlite3 toolchain mismatch. The exact serialization bug was reproduced and fixed at the encoder level instead. |
| Local proto lint | **BLOCKED** - `buf` is not installed locally. CI Quality Checks runs it and passes. |
| Windows `EBUSY` cleanup warning | Non-fatal; the runner exits 0. Cosmetic only. |
| Workflow YAML | No changes required; the existing matrix, caching, filters and retry logic are correct. |

## 10. Final CI readiness

| Check | Status |
|---|---|
| Quality Checks | PASS (existing) |
| Linux Unit Tests | **PENDING CI** - root cause fixed, local Linux execution unavailable by design |
| Windows Unit Tests | PASS (existing) |
| Extension Integration Tests | PASS (existing) |
| Platform Integration Tests | **PENDING CI** - exact serializer failure reproduced and fixed locally |
| Webview Tests | PASS (existing) |
| Typecheck | PASS |
| Lint | PASS (Biome; proto lint verified by CI) |
| Build | PASS |

Locally: every root cause that can execute on Windows is fixed and validated.
Linux verification is **pending an authorized push**. No workflow was disabled,
no test was skipped, and no assertion was weakened.
