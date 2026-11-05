# 02 - Security audit

Date: 2026-11-05
Scope: the shipped VS Code extension (`apps/vscode`), its runtime bundle, the
packaged VSIX, and the repository state used to build it.

No secret value is printed in this document. Findings name files and redacted
locations only.

## 1. Secret scanning

| Check | Command | Result |
| --- | --- | --- |
| Full Git history | `gitleaks git --redact --no-banner` | 52 commits scanned, ~40.5 MB, **no leaks found** |
| Tracked `.env` / key / certificate files | `git ls-files` filter | Only `.env.example`, test fixtures, fake PEMs, and credential-store source/tests. No real credential. |
| VSIX content | extracted `bytos-1.0.0.vsix`, filename and content scan | No `.env*`, `secrets.json`, private key, service-role key, or token-shaped value. |
| Packaging exclusions | `.vscodeignore` | `.env`, `.env.example`, `.vscode-test/**`, `.github/**`, source, tests, scripts, and source maps are excluded. |

Fixture strings such as `sk-ant-test`, `sk-ant-123`, and a fake PEM whose body is
`SECRET` are test data, not credentials. They are not in the VSIX.

## 2. Dependency audit

Command: `bun audit --production --json` (Bun audit exits non-zero when any
advisory exists; that is expected).

| Severity | Count |
| --- | --- |
| Critical | 7 |
| High | 48 |
| Moderate | 47 |
| Low | 15 |
| **Total** | **117** |

### 2.1 Critical advisories and whether they ship

| Package | Critical advisory | In VSIX? | Disposition |
| --- | --- | --- | --- |
| `next` | Multiple RCE advisories in Next.js image/`use cache` paths | **No** (`next/dist` marker count: 0) | Workspace dependency of non-shipped apps. Not a release blocker for the extension. |
| `proxy-addr` | IP spoofing via IPv4-mapped IPv6 trust subnet | **No** (marker count: 0) | Hub/server dependency; not in the extension bundle. |
| `shell-quote` | `quote()` command injection via a line terminator | **No** (marker count: 0) | Dev/tooling transitive dependency; not in the extension bundle. |

### 2.2 Fixed in this pass

| Package | Before | After | Why |
| --- | --- | --- | --- |
| `simple-git` | `3.36.0` | `4.0.2` | The 3.x line carried critical/high unsafe-operation and Git-config execution advisories. v4 removes the default export; all imports were migrated to `import { simpleGit } from "simple-git"`. Core typecheck and 117 workspace tests pass. |
| `dompurify` | `3.4.14` | `3.4.17` | Critical `SAFE_FOR_TEMPLATES` bypass plus high/low sanitizer issues. The webview uses DOMPurify for MCP image/link previews. |
| `@simple-git/argv-parser` | `1.1.1` | `2.0.1` | Pulled by `simple-git@4.0.2`; resolves the critical editor-detection advisory. |

Both packages no longer appear in the production audit output.

### 2.3 Residual bundled advisories

The production audit still reports high-severity advisories for packages that are
present in the bundle, including `undici`, `sharp`, `@modelcontextprotocol/sdk`,
`@grpc/grpc-js`, `follow-redirects`, `extract-zip`, and `zod`. They were not
auto-upgraded because the available fixes require major-version changes with a
wide compatibility surface (MCP transport, native image processing, provider
schema validation). No exploit path was demonstrated in the extension's use of
these packages during this pass.

This is a **residual risk**, not a clean bill of health. It must be reviewed
before a subsequent release; it is not a critical packaging blocker because the
known critical advisories are in non-shipped packages.

## 3. Extension surface review

| Area | Evidence | Status |
| --- | --- | --- |
| API key storage | VS Code SecretStorage wrappers (`vscode-secret-storage.ts`, `vscode-provider-credential-store.ts`); migration writes then verifies before removing legacy plaintext | PASS |
| Key masking | `redactApiConfiguration.ts`, `secret-mask.ts`, webview tests; the webview receives a length-based mask and configured flags, never the key | PASS |
| Approval defaults | `sdk-tool-policies.ts` defaults reads, edits, terminal, browser, MCP, skills, and unknown tools to "ask"; auto-approval is opt-in per category | PASS |
| Workspace boundary | `path-safety.ts` canonicalizes absolute paths, traversal, Windows drive/UNC paths, and symlinks against the workspace root | PASS |
| Webview CSP | `WebviewProvider.ts` uses a per-load nonce, removes `unsafe-eval` and wildcard sources, and limits `connect-src` | PASS |
| Terminal execution | First-class approved tool; `disableCurrentDirectoryExecutableSearch` is applied at activation | PASS |
| MCP execution | User-configured processes; approval-gated, not sandboxed by the extension | Documented residual |
| Telemetry | Off by default; explicit opt-in; disabling stops PostHog events and feature flags | PASS |
| Outbound network | No Bytos backend. Egress is limited to the chosen provider, optional `api.cline.bot` for ClinePass, OpenRouter OAuth when selected, GitHub for plugin install, PostHog after opt-in, and user-configured MCP servers | Documented in `PRIVACY.md` |

## 4. VSIX and install verification

- `bytos-1.0.0.vsix` was installed into a temporary VS Code extensions directory
  with `code --install-extension ... --extensions-dir ... --user-data-dir ...`.
- `code --list-extensions --show-versions` returned `bytos.bytos@1.0.0`.
- VS Code was launched against that profile with Playwright. The extension
  activated in **402.6 ms**, the chat webview rendered, and the extension-host
  logs contained **0 ERROR lines**.
- The packaged archive contains no `.env`, secrets, source maps, source files,
  tests, or CLI executable.

## 5. Repository security settings

| Setting | State | Action |
| --- | --- | --- |
| Secret scanning | enabled | None |
| Secret scanning push protection | enabled | None |
| Private vulnerability reporting | **enabled during this pass** | `SECURITY.md` now points at a working form |
| Dependabot security updates | disabled | **Recommended manual action:** enable in repository settings |
| Security policy | `SECURITY.md` rewritten; no invented email address | Done |

## 6. Findings summary

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| SEC-01 | Critical `simple-git` advisories in a bundled dependency | Critical | **Fixed** (4.0.2 + import migration) |
| SEC-02 | Critical `dompurify` sanitizer advisory in the webview bundle | Critical | **Fixed** (3.4.17) |
| SEC-03 | Critical `next`/`proxy-addr`/`shell-quote` advisories | Critical (non-shipped) | **Not shipped**; documented |
| SEC-04 | Residual high advisories in bundled `undici`, `sharp`, MCP/gRPC, `zod`, etc. | High | Open; requires a planned upgrade pass |
| SEC-05 | `SECURITY.md` pointed at a disabled advisory form and an unverified email | High | **Fixed**; private reporting enabled |
| SEC-06 | Disabled Discussions links in README/CONTRIBUTING/docs | Low | **Fixed** (links removed) |
| SEC-07 | 13 UNKNOWN-licence packages (legal, not exploit) | Medium (legal) | Open; enumerated in `04` |
| SEC-08 | Dependabot security updates disabled | Medium | Open; manual repository setting |

No critical security issue remains in the shipped extension bundle after the two
dependency upgrades. No secret was found in the repository or the VSIX.
