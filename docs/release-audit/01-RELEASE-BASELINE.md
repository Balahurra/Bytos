# 01 - Release baseline

Date: 2026-11-05
Repository: `C:\Users\TT\Desktop\bytos-main`
Remote: `https://github.com/Balahurra/Bytos`

## 1. Repository state at the start of this pass

| Item | Value |
| --- | --- |
| Branch | `main` |
| HEAD | `e0c2656` |
| `origin/main` | `e0c2656` |
| Working tree | clean before this pass |
| Tags | none |
| GitHub releases | none |
| Existing local artifact | `bytos-4.2.0.vsix` (12,281,325 bytes) |
| Existing audit docs | `docs/release-audit/01` through `08`, `10`, `11` |

The distributable product is the VS Code extension in `apps/vscode`. The root
repository is a Bun workspace that also contains the SDK, CLI, hub, desktop
example, and other development packages. Those packages are not the release
artifact.

## 2. What this pass changed

- Extension version: `4.2.0` -> `1.0.0` in `apps/vscode/package.json`.
- Changelog: added a truthful `1.0.0` entry; the `4.2.0` history is preserved.
- Privacy notice: version stamp aligned to `1.0.0` in both copies.
- Marketplace metadata: description, categories, and keywords rewritten around
  the actual VS Code extension.
- Root and Marketplace READMEs rewritten to remove unsupported CLI/desktop/hub
  and enterprise claims, document Auto Phase accurately, and fix dead links.
- `SECURITY.md`: removed the unverified email address, scoped the policy to the
  shipped extension, and pointed only at GitHub private vulnerability reporting
  (now enabled on the repository).
- `CONTRIBUTING.md` and `docs/docs.json`: removed disabled Discussions links and
  corrected the GitHub organisation from `bytos/bytos` to `Balahurra/Bytos`.
- Dependencies: `simple-git` `3.36.0` -> `4.0.2` (default export removed; imports
  migrated to the named `simpleGit` export) and `dompurify` -> `3.4.17` to clear
  the advisories that were present in the shipped bundle.
- New VSIX: `bytos-1.0.0.vsix` built from the final tree.

## 3. Version map

| Package | Version | Shipped in VSIX |
| --- | --- | --- |
| `apps/vscode` (`bytos`) | **1.0.0** | Yes |
| `sdk/packages/*` | internal versions | Bundled as runtime code, not separately published |
| `apps/cli` | workspace version | No |
| `apps/bytos-hub` | workspace version | No (only core library files in the plugin runtime) |
| `apps/examples/*` | workspace versions | No |

The extension manifest is the source of truth for the released version. The
lockfile records workspace links, not a separate extension version.

## 4. Known blockers at baseline

| ID | Blocker | Type |
| --- | --- | --- |
| B-1 | Marketplace publisher `bytos` and PAT ownership are not verified from the repository. | Human |
| B-2 | `__metadata` is absent until the first `vsce publish` resolves the publisher. Not a manifest requirement; a release-state assertion. | Human / publish step |
| B-3 | 13 third-party packages have no resolvable licence declaration. They are enumerated and justified, but not legally cleared. | Legal |
| B-4 | CC-BY-4.0 attribution wording for `@vscode/codicons` and `caniuse-lite` is unverified. | Legal |
| B-5 | Authorship of the Bytos brand assets is not documented. | Human / legal |
| B-6 | Marketplace listing does not exist yet; the website links to GitHub installation instead of a fake Marketplace URL. | Human |

## 5. Planned corrections in this pass

1. Align the extension version and all user-facing version references.
2. Remove dead links, unsupported distribution claims, and stale Cline marketing.
3. Fix the dependency advisories that were actually present in the bundle.
4. Rebuild the VSIX and inspect the archive, not just `.vscodeignore`.
5. Install the VSIX into a clean VS Code profile, launch it, and check activation.
6. Run the unit, E2E, typecheck, lint, and security checks; record actual results.
7. Prepare website SEO files and metadata without deploying them.
8. Leave Marketplace/GitHub publication to a separate, authorised step.

## 6. Baseline CI reference

The last fully green runs for the previous 4.2.0 tree were:

- `ext-vscode-test`: run `41955326562`
- `ext-vscode-test-e2e`: run `41955326519`
- `sdk-test`: run `41940669491`

Those runs do not cover the version bump or the dependency changes in this pass.
New runs are recorded in `07-FINAL-RELEASE-READINESS.md` after the changes were
committed.
