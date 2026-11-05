# 11 - E2E and SDK CI resolution

Date: 2026-11-05
Scope: the two workflows still failing after the main CI recovery:
`ext-vscode-test-e2e` and `sdk-test`.
Repository: https://github.com/Balahurra/Bytos

Local environment: Windows (no WSL, no Docker, no native Linux).
Authoritative Linux/macOS verification: GitHub Actions (pending the authorized
push; see section 10).

## 1. Original failures

| Workflow | Run | Result | Failing detail |
|---|---|---|---|
| `ext-vscode-test-e2e` | `41930837987` | FAIL | Every Playwright test timed out on UI that no longer exists (`Login to Bytos`, `Bring my own API key`). |
| `sdk-test` | `41933687638` | PARTIAL | Quality Checks and Windows passed. Ubuntu: `test:e2e:cli:tui` → 5 failed / 2 skipped / 57 passed. |

SDK failing tests (all unauthenticated headless cases):

1. `headless/headless.test.ts` `bytos -y ...` — expected `Unauthorized|Missing API key`
2. `headless/headless.test.ts` piped stdin — same
3. `headless/headless.test.ts` `bytos -y --verbose ...` — same
4. `headless/headless.test.ts` `bytos -y --json ...` — same
5. `cli/flags-behavior.test.ts` `--json --yolo` — same

## 2. Exact root causes

### E2E

The BYOK build replaced the account onboarding flow with a chat-first
experience: `OnboardingView` now always renders `WelcomeView`, and even
`WelcomeView` is not shown in the E2E harness because the extension opens the
chat view directly. The Playwright suite still drove the removed multi-step
onboarding:

- `Login to Bytos` — obsolete onboarding button (only reachable through dead
  onboarding steps).
- `Bring my own API key` — obsolete onboarding choice.
- Onboarding `Continue` followed by `provider-selector-input` — the provider
  picker now lives in Settings → API Configuration.
- `provider-option-bytos` — the Bytos provider is not offered in the BYOK
  build; the list starts at ClinePass / OpenAI ChatGPT Subscription / DeepSeek.
- `tab-terminal` — terminal settings moved into the General tab.
- File-edit test assumed auto-approval; edits are now fail-closed and require
  an explicit Save/Reject.

Classification: **A (obsolete UI/selector)** for the onboarding and terminal
selectors, **B (outdated expected behavior)** for the file-edit approval flow
and provider-backed chat setup. No **C (product regression)** was found: the
product's current behaviour is coherent and the tests were stale.

### Second verification pass (Linux/macOS)

The first CI run of the rewritten suite exposed three cross-platform issues
that Windows could not show:

1. **E2E hook fixture mode.** `workspace-hooks/.bytosrules/hooks/UserPromptSubmit`
   was committed as `100644`; Linux/macOS could not execute it, so
   `hook-ran.json` was never written. Fixed by recording `100755` in Git.
2. **Settings frame on macOS.** Clicking the workbench Settings action can open
   the settings webview in a different frame; asserting inside the cached chat
   frame failed. `openSettings(page)` now clicks the action and finds the frame
   that actually contains `#api-provider`.
3. **Brittle editor selection.** `div:nth-child(4) > span > span` timed out and
   forced Playwright retries. Selection now goes through Monaco's accessibility
   textbox (`press("ControlOrMeta+a")`), which is stable on all platforms.

### SDK TUI

The unauthenticated tests relied on the production default endpoint
`https://api.bytos.dev`, which does not resolve for this repository
(`getaddrinfo ENOTFOUND`). They expected a deterministic HTTP 401. No public
DNS or production backend may be required.

Classification: **E (test environment/fixture problem)**.

## 3. Obsolete Playwright selectors identified

| Selector / assumption | Replacement |
|---|---|
| `getByRole("button", { name: "Login to Bytos" })` | Removed: BYOK has no account onboarding. |
| `getByText("Bring my own API key")` | Removed: chat starts directly. |
| Onboarding `Continue` + provider selector inside onboarding | `Settings` → `#api-provider` provider selector. |
| `provider-option-bytos` | `provider-option-openai` (UI label "OpenAI Compatible"). |
| `tab-terminal` / "Terminal Settings" header | `tab-general`; terminal controls render inside General. |
| "File edits are auto-approved" | Fail-closed: `Save` / `Reject` must be visible and `Save` is clicked. |
| Codex via onboarding | `Settings` → provider `openai-codex` → "Sign in to OpenAI Codex". |

## 4. Actual product regressions discovered

**None.** The current product behaviour (chat-first BYOK, provider settings in
Settings, fail-closed approvals, terminal settings in General, no Bytos
provider in the dropdown) is intentional. Tests were updated to the product,
not the product to the tests.

## 5. Playwright changes

- `utils/helpers.ts`
  - New `openSettings(page)`: tries each visible workbench "Settings" action
    (VS Code's own gear and the Bytos view action can both match, in a
    platform-dependent order) until the frame containing `#api-provider`
    opens.
  - New `configureMockProvider(page, sidebar)`: opens Settings, selects the
    OpenAI Compatible provider, sets `http://localhost:7777/api/v1`, the mock
    token, and model `test-model`, waits for the deterministic persisted-key
    mask (`••…`), returns to chat, and asserts `openai-compat:test-model`.
  - A persistence barrier replaces arbitrary sleeps: the API-key field shows
    its saved mask only after the debounced write round-trips.
  - Removed the obsolete `signin()` flow.
- `utils/common.ts`: editor selection uses Monaco's accessibility textbox
  instead of the brittle CSS line selector.
- `auth.test.ts` rewritten around the real workflow: chat-first start →
  configure provider in Settings → return to chat → reopen Settings and verify
  the stored key is masked.
- `chat`, `editor`, `file-edit`, `history`, `hooks`, `powershell` specs use
  `configureMockProvider`.
- `codex-oauth.test.ts` navigates through Settings to the Codex provider.
- `file-edit.test.ts` now asserts fail-closed approval and clicks `Save`.
- `powershell-background.test.ts` opens the General tab.
- `README.md` examples updated.

The mock API server (`src/test/e2e/fixtures/server`) was already present and
now backs every chat turn through the OpenAI Compatible provider; no public
network is used.

## 6. SDK network dependency changes

`apps/cli/src/tests/helpers/env.ts` now starts a process-local HTTP server on
an ephemeral loopback port for **unauthenticated** configs and sets the
already-supported `BYTOS_API_BASE_URL` override. The server answers every
request with HTTP 401 and the real API's JSON error envelope. It is `unref()`ed
and closed on process exit, so four tui-test workers do not collide on a fixed
port.

`TEST_SUITE_ROOT` now uses `fileURLToPath(new URL("../", import.meta.url))`
instead of `.pathname`, fixing the helper's Windows path handling.

No product code was changed: `BYTOS_API_BASE_URL` already existed in
`sdk/packages/shared/src/runtime/bytos-environment.ts`.

## 7. Mock server architecture

| Concern | Implementation |
|---|---|
| Scope | Unauthenticated TUI tests only |
| Address | `127.0.0.1:<ephemeral>` (one per tui-test worker process) |
| Responses | HTTP 401, `{ success: false, error: "Unauthorized" }`, `WWW-Authenticate: Bearer` |
| Wiring | `BYTOS_API_BASE_URL` consumed by `getBytosEnvironmentConfig()` |
| Lifetime | `unref()` + `process.once("exit", close)` |
| Public DNS | None |

Authenticated `@live` tests keep their existing VCR cassettes and remain
separate.

## 8. Workflow changes

**None required.** The existing `ext-vscode-test-e2e` matrix and `sdk-test`
matrix already run the right commands on Linux, Windows and macOS. No job was
disabled, no filter widened, and no condition weakened. The Qlty "oidc/token"
annotations are non-fatal; the job still reports success.

## 9. Windows validation results

| Check | Command | Result |
|---|---|---|
| Full extension E2E | `bun run e2e` (apps/vscode) | **PASS** — 14 passed, no retries (setup + 13 tests; the Store-PowerShell-7 case is skipped by design) |
| File edit + PowerShell subset | `bun run e2e -- --grep "File Edit|PowerShell 5.1"` | **PASS** — 4 passed |
| Extension typecheck | `bun run check-types` | **PASS** |
| CLI typecheck | `bun run typecheck` (apps/cli) | **PASS** |
| Biome lint (changed files) | `bunx biome lint ...` | **PASS** (warnings/infos only) |
| Unauthenticated CLI behaviour | direct spawn with `bytosEnv("unauthenticated")` | **PASS** — 3/3 runs, exit 1, output `Unauthorized`, no `api.bytos.dev`, ~2.3–2.6 s |
| Full TUI E2E (`tui-test`) | `bun run test:e2e:cli:tui` | **BLOCKED locally** — the Windows sdk-test job intentionally skips TUI e2e; tui-test needs the Linux terminal harness. CI is authoritative. |

## 10. Linux GitHub Actions results

Verified on run [`41955326519`](https://github.com/Balahurra/Bytos/actions/runs/41955326519)
(commit `cc617ca`): **all E2E jobs passed.**

| Job | Result | Evidence |
|---|---|---|
| e2e (ubuntu) | **PASS** | 13 passed / 2 skipped |
| e2e (windows) | **PASS** | 14 passed / 1 skipped |
| e2e (macos) | **PASS** | job success |

`sdk-test` (run [`41940669491`](https://github.com/Balahurra/Bytos/actions/runs/41940669491)):
Quality Checks, Ubuntu TUI e2e and the Windows matrix are all **PASS**.
`ext-vscode-test` remained green throughout; the final run on this commit was
verified separately.

## 11. macOS results

**PASS** - `e2e (macos)` completed successfully in run `41955326519`. This
confirms the frame-based Settings lookup and the executable hook fixture.

## 12. Remaining limitations

| Item | Status |
|---|---|
| tui-test on this Windows host | **BLOCKED** locally - not supported by the existing harness; CI Linux runs it and passed. |
| Qlty annotations | Non-fatal; job success despite `oidc/token` warning text. |
| Store-only PowerShell 7 E2E | **SKIPPED by design** - requires a Store-only installation (1 skipped on Windows). |
| Linux/macOS local execution | Not available on this machine; GitHub Actions is authoritative and both passed. |

## 13. Acceptance table

| Check | Status |
|---|---|
| Quality Checks | **PASS** |
| Linux unit tests | **PASS** |
| Windows unit tests | **PASS** |
| Extension integration | **PASS** |
| Platform integration | **PASS** |
| Webview tests | **PASS** |
| `ext-vscode-test-e2e` | **PASS** (ubuntu, windows, macos) |
| SDK tests - Ubuntu | **PASS** |
| SDK tests - Windows | **PASS** |
| Aggregate test workflow | **PASS** |

No test was deleted, skipped to hide a failure, or weakened; no workflow was
disabled.
