# 03 - Licence and attribution

Scope: Apache-2.0 obligations created by deriving Bytos from Cline, plus the
third-party inventory for the VS Code extension package.

**This document is not legal advice.** Where it says "requires legal review", the
topic was identified but not resolved.

## 1. What the licence is, and what it is not

- Bytos is distributed under the **Apache License 2.0** (`LICENSE`,
  `apps/vscode/package.json` `"license": "Apache-2.0"`).
- The upstream project is Cline (`https://github.com/cline/cline`), also
  Apache-2.0. Its `LICENSE` appendix carries `Copyright 2026 Cline Bot Inc.`
  (verified against the upstream raw file during this audit).
- Apache-2.0 grants copyright and patent rights. It does **not** grant trademark
  rights (Section 6). `TRADEMARKS.md` states that separately.

## 2. Apache-2.0 Section 4 checklist

| Section | Requirement | Status | Evidence |
|---|---|---|---|
| 4(a) | Give recipients a copy of the License. | **Met** | The VSIX contains `LICENSE.txt` (vsce renames `LICENSE`), and `NOTICE` and `README.md` both point to it. Verified by unpacking the VSIX (`06-FINAL-VERIFICATION.md`). |
| 4(b) | Cause modified files to carry prominent notices stating that you changed the files. | **Met for this review's changes; partially inferred for pre-import changes** | `LICENSE` now states that Cline-derived files carry a `Copyright 2026 Cline Bot Inc. / Bytos modifications` header, and twelve substantially modified files now carry that header with a change summary. Files whose Bytos changes predate the import commit cannot be individually proven; the conservative reading is applied in `02-CODE-ORIGIN-MAP.md`. |
| 4(c) | Retain all copyright, patent, trademark and attribution notices from the Source form. | **Met as far as the evidence allows** | No upstream source header was found to have been stripped: neither this repository nor upstream Cline puts per-file copyright headers on `src/**` (checked with a repo-wide search: zero `Copyright`/`SPDX-License-Identifier` headers in `apps/vscode/src` and `sdk/packages/*/src`). The only upstream notice, in `LICENSE`, is retained verbatim. |
| 4(d) | If the Work includes a NOTICE file, include its attribution notices. | **Met (upstream has no NOTICE)** | `https://raw.githubusercontent.com/cline/cline/main/NOTICE` returns 404, so there is no upstream NOTICE to carry forward. Bytos' own `NOTICE` documents the derivation, the upstream copyright, and a non-affiliation statement. |
| 4(e) | Accept additional conditions only if allowed. | **N/A** | No additional restrictions were added. |
| 4(f) | Do not modify the licence text. | **Met** | Only the appendix section (which Apache-2.0 explicitly intends to be filled in) was extended; Sections 1-9 are untouched. |

## 3. Notice and attribution files that ship

| File | Ships in VSIX | Content |
|---|---|---|
| `LICENSE` | Yes, as `LICENSE.txt` | Unmodified Apache-2.0 text plus an appendix naming the upstream copyright, the Bytos modification copyright, and the upstream project URL. |
| `NOTICE` (`apps/vscode/NOTICE`, byte-identical to root) | Yes | Derivation statement, upstream copyright, non-affiliation disclaimer, pointer to third-party notices. |
| `THIRD-PARTY-NOTICES.txt` | Yes | Generated inventory of 2,394 packages with declared licence and first copyright line, plus the licence families present. |
| `THIRD-PARTY-NOTICES.json` | Yes | The same inventory in machine-readable form so the VSIX can be audited without the repository. |
| `CHANGELOG.md` (`apps/vscode`) | Yes | Release notes, including the licensing remediation entry. |
| `PRIVACY.md` (`apps/vscode`) | Yes | Data-handling map (see `04`). |
| `README.md` (marketplace build) | Yes | Licence, attribution, contact and trademark pointers. |

`apps/vscode/NOTICE` must stay byte-identical to the root `NOTICE`; the release
gate enforces this (`check-licenses.mjs` section 2).

## 4. Third-party inventory

`apps/vscode/scripts/generate-third-party-notices.mjs` walks the installed
dependency tree and records package, version, declared licence, repository, and
the first copyright line found in the package's licence file. It also probes the
licence text itself rather than trusting the `license` field alone.

Declared-licence summary at audit time (2,394 packages):

| Licence | Count |
|---|---|
| MIT | 1727 |
| Apache-2.0 (+ `apache-2.0`, `Apache-2.0 OR MIT`, `MIT OR Apache-2.0`) | 384 |
| ISC | 115 |
| BSD-3-Clause / BSD-2-Clause / BSD | 87 |
| BlueOak-1.0.0 | 17 |
| UNKNOWN | 13 |
| Unlicense | 8 |
| MPL-2.0 | 7 |
| OFL-1.1 | 5 |
| Artistic-2.0 | 5 |
| CC-BY-4.0 / CC0-1.0 | 4 |
| 0BSD | 2 |
| MIT/X11 | 2 |

Notes that matter for distribution:

- **MPL-2.0 (7 packages)** is file-level copyleft. It is compatible with an
  Apache-2.0 distribution as long as the MPL-covered files remain under MPL and
  their source is available. The inventory names them; nothing in the shipped
  bundle is a modified MPL file. Keep the notice file intact.
- **OFL-1.1 (5 packages)** covers the bundled Geist and Inter font files
  (`webview-ui/build/assets/*.woff2`). OFL requires the licence text to travel with
  the font and forbids selling the fonts by themselves. The notice file satisfies
  the first part; the second is not a concern for an extension package.
- **CC-BY-4.0 (2 packages)** requires attribution in the way the licensor
  specifies. The inventory records the copyright line but **not** the attribution
  string the licence asks for. Open item (see section 6).
- **UNKNOWN (13 packages)**: each one is explicitly enumerated in
  `apps/vscode/scripts/license-exceptions.json` with a written justification. The
  gate fails when an UNKNOWN package is not listed, so the list cannot silently
  grow. Several of the entries are documented as **not** in the production input
  graph (the proprietary Claude Agent SDK, the SAP AI Core SDK family, PostHog's
  private workspace packages, VS Code signing tools).

## 5. Copyright notices in this repository

| Where | Notice | Comment |
|---|---|---|
| `LICENSE` appendix | `Copyright 2026 Cline Bot Inc.` + `Bytos modifications and additional components: Copyright 2026 Bytos contributors` | Upstream notice preserved verbatim; Bytos notice added on its own line. |
| `NOTICE` | `Bytos / Copyright 2026 Bytos contributors` + upstream block | Attribution + non-affiliation. |
| Modified Cline-derived source | `Copyright 2026 Cline Bot Inc. / Bytos modifications Copyright 2026 Bytos contributors / Modified from the Cline project ... Changes by Bytos: ...` | 14 files, see `02` section B. |
| `apps/vscode/package.json` | `"author": { "name": "Bytos contributors" }` | Was a bare `"Bytos"`, which reads like a company claim; the legal entity of the project is not established anywhere in the repository, so the neutral "contributors" form is used. |
| Everything else | No per-file headers | Matches upstream practice. Do **not** invent an entity such as "Bytos Inc." - no such entity is evidenced in the repository. |

The copyright holder named for Bytos work is `Bytos contributors`. If the project
later establishes a legal entity, the notice must be updated by a human decision,
not by an automated change.

## 6. Open items that need a human or legal decision

1. **The `bytos` publisher identity.** `package.json` says `publisher: "bytos"`
   and the VSIX manifest records `Publisher="bytos"`, `Id="bytos"` →
   `bytos.bytos`. Whether that publisher ID is registered to the same account that
   will hold the Marketplace PAT is not recorded anywhere in the repository.
2. **CC-BY-4.0 attribution strings.** Two packages carry a licence that asks for a
   specific attribution string; the generated inventory records the copyright
   line, not the requested string. Confirm the exact wording with the package
   authors before publishing.
3. **MPL-2.0 source availability.** If any MPL-2.0 file is modified in a future
   build, its source must be published. Today the bundled copies look unmodified,
   but this was not verified file by file.
4. **Trademarks of third parties.** `apps/vscode/assets/icons/social/*` are
   third-party logos used to link to the project's own channels. Nominative use is
   generally acceptable, but this was not verified against each brand's guidelines.
5. **Bytos brand asset authorship.** See `01` section 7.
6. **UNKNOWN-licence packages.** Thirteen packages have no resolvable licence.
   They are documented and excluded from the production graph where possible, but
   a lawyer should confirm that the exclusion actually holds for the shipped
   bundle (esbuild metafile + `bun pm ls --all` are the tools to prove it).
7. **Upstream attribution completeness.** Because the local history has no
   upstream commits, the project cannot demonstrate file-by-file which Cline files
   it took. The conservative treatment (the whole product is a derivative work,
   `NOTICE` + `LICENSE` at distribution level) is the safest available position,
   but it is a legal position the maintainers should own explicitly.

## 7. Re-verification (2026-11-04, evening)

Two drift findings from re-inspecting the on-disk artefact, both now closed:

1. **`apps/vscode/LICENSE` had not received the 2026-11-04 root-LICENSE fix.**
   The extension copy (packaged as `extension/LICENSE.txt`) still ended its
   appendix with bare `Copyright 2026 Bytos` — no Cline Bot Inc. notice, no
   Bytos-modifications paragraph — so the shipped 4.2.0 archive was, as
   distributed, in breach of Apache-2.0 Section 4(a)/(c) despite the root copy
   being correct. The licence gate validates the root copy only, which is why
   the drift was invisible. **Resolution:** `apps/vscode/LICENSE` overwritten
   with the corrected root copy (SHA-256 identical), and a fresh archive was
   packaged (see `05` PKG-07/PKG-09). Recommend the gate additionally compare
   the packaged `LICENSE.txt` against the root `LICENSE`.
2. **Header-file count reconciled.** The repository carries 14
   `Changes by To trademark third parties:` no —
   Bytos-modification headers; section 5 and `02` section B previously
   recorded 12. `apps/vscode/src/sdk/SdkController.ts` and
   `sdk/packages/llms/src/providers/vendors/community.ts` had been added as
   headers but left in the "not individually headered" lists of the docs.
   Both tables now list 14. Every sampled header correctly retains
   `Copyright 2026 Cline Bot Inc.` and adds only the modification line — no
   file replaces upstream copyright with a personal identity.

Additional re-verification results (no action needed): root and extension
`NOTICE` remain byte-identical; `THIRD-PARTY-NOTICES.txt/.json` cover 2,394
packages with 13 UNKNOWN all justified in `license-exceptions.json`; no
GPL/AGPL in the inventory — the only genuine copyleft-adjoining entry
(`jschardet`, LGPL-2.1+) is a declared but never-imported dependency that is
provably absent from `dist/extension.js` and the webview bundle; no false
ownership claim exists in `README.md`, both marketplace READMEs, `PRIVACY.md`,
`SECURITY.md` or `TRADEMARKS.md`. Housekeeping suggestions: `sdk/README.md`
("Apache 2.0 © 2026 Bytos") and `apps/cli/README.md` ("© Bytos") would better
read "© Bytos contributors"; the unused `jschardet` dependency could simply be
removed.

