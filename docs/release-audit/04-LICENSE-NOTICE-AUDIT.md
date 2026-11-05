# 04 - Licence, NOTICE, and third-party attribution

Date: 2026-11-05
This document is not legal advice. Items marked "open" require a human or legal
decision.

## 1. Project licence and Cline attribution

- Bytos is distributed under the **Apache License 2.0** (`LICENSE`,
  `apps/vscode/package.json` `"license": "Apache-2.0"`).
- The upstream project is Cline (`https://github.com/cline/cline`), also
  Apache-2.0. The upstream copyright notice
  (`Copyright 2026 Cline Bot Inc.`) is preserved in `LICENSE`.
- `NOTICE` states the derivation, preserves the upstream attribution, and
  disclaims affiliation: Bytos is not endorsed by, sponsored by, or affiliated
  with the Cline project or its maintainers.
- Files substantially modified from Cline carry a
  `Copyright 2026 Cline Bot Inc. | Bytos modifications` header with a change
  summary. The existing origin map is `docs/release-audit/02-CODE-ORIGIN-MAP.md`.
- The copyright holder for Bytos work is recorded as **Bytos contributors**. No
  legal entity such as "Bytos Inc." is claimed; none is evidenced in the
  repository.

## 2. Apache-2.0 Section 4 obligations

| Section | Requirement | Status |
| --- | --- | --- |
| 4(a) | Include a copy of the License | **Met**: `LICENSE` is packaged as `LICENSE.txt` |
| 4(b) | Mark modified files | **Met for attributable files**; pre-import provenance cannot be proven file-by-file |
| 4(c) | Retain copyright and attribution notices | **Met as far as the evidence allows**; no upstream per-file headers were stripped |
| 4(d) | Include upstream NOTICE | **N/A**: upstream Cline has no NOTICE file |
| 4(e) | No additional restrictions | **Met** |
| 4(f) | Do not modify the licence text | **Met**; only the Apache appendix was filled in |

## 3. Files shipped for attribution

| File | In VSIX | Purpose |
| --- | --- | --- |
| `LICENSE` (`LICENSE.txt`) | Yes | Apache-2.0 text + upstream/Bytos appendix |
| `NOTICE` | Yes | Derivation, upstream copyright, non-affiliation |
| `THIRD-PARTY-NOTICES.txt` | Yes | 2,398-package human-readable inventory + licence families |
| `THIRD-PARTY-NOTICES.json` | Yes | Machine-readable inventory |
| `CHANGELOG.md` | Yes | Release history |
| `PRIVACY.md` | Yes | Data-handling statement |
| `README.md` | Yes | Marketplace listing body, attribution section |

`apps/vscode/NOTICE` must stay byte-identical to the root `NOTICE`; the release
gate enforces this.

## 4. Third-party inventory

The generated inventory contains **2,398 packages** and the following licence
families (declared). It is intentionally a superset: it walks installed
`node_modules`, so cached older copies can appear even when the build resolves a
newer version.

| Licence family | Notes |
| --- | --- |
| MIT, Apache-2.0, ISC, BSD-2/3-Clause, 0BSD, Unlicense | Permissive; compatible with Apache-2.0 distribution |
| MPL-2.0 | File-level copyleft; bundled files appear unmodified. Keep the notice intact. |
| LGPL-2.1+/LGPL-3.0 | Present via `jschardet` and a Sharp platform package entry. No GPL or AGPL was found. LGPL compliance depends on the form in which the package is distributed; the VSIX contains no native `.node` binary in the inspected file list. |
| OFL-1.1 | Bundled Geist/Inter/codicon fonts; licence text travels in the notice file |
| CC-BY-4.0 | `@vscode/codicons` and `caniuse-lite`; attribution wording is an open item |
| CC0-1.0 | `mdn-data`, `spdx-license-ids` |
| UNKNOWN | **13 packages** |

### 4.1 The 13 UNKNOWN packages

The full list is in `apps/vscode/scripts/license-exceptions.json` and is
reproduced by the inventory:

- `@anthropic-ai/claude-agent-sdk@0.3.232` and its win32 binary
- `@sap/xsenv@6.2.2`
- `@vscode/vsce-sign@2.1.0` and its win32 binary
- `beep-boop@1.2.3`
- `buffers@0.1.1`
- `nw-pre-gyp-module-test@0.0.1`
- `posthog-js-customizations@1.0.0`
- `posthog-js-react@1.0.0`
- `posthog-js-rrweb@1.0.0`
- `posthog-js-rrweb-plugin-console-record@1.0.0`
- `posthog-js-rrweb-types@1.0.0`

The exceptions file records why each is believed not to be in the production
input graph or is a build/test-only fixture. The release gate fails if an
unlisted UNKNOWN package appears. This is a documented legal risk, not a
technical packaging failure.

## 5. Brand assets

`assets/branding/*`, `assets/icons/*`, and `assets/docs/demo.gif` are treated as
Bytos project assets. Their authorship and assignment are **not documented in the
repository**. The Apache-2.0 licence does not grant trademark rights;
`TRADEMARKS.md` states that the name and logo are not covered by the licence.
Open item: a human should confirm the asset authorship before enforcing the mark
against third parties.

Third-party social icons under `apps/vscode/assets/icons/social/*` are used for
navigation to the project's own channels. Nominative use is generally acceptable,
but each brand's guidelines were not verified.

## 6. Findings

| ID | Finding | Severity | Status |
| --- | --- | --- | --- |
| LIC-01 | Upstream Cline copyright and Apache text preserved | Critical | **Met** |
| LIC-02 | NOTICE and third-party notices shipped | Critical | **Met** |
| LIC-03 | 13 UNKNOWN-licence packages | Medium (legal) | Open; enumerated and gated |
| LIC-04 | CC-BY-4.0 attribution wording for codicons/caniuse-lite | Medium (legal) | Open |
| LIC-05 | Brand asset authorship not documented | Medium (legal) | Open |
| LIC-06 | LGPL packages present in the inventory | Informational | No native binary found in the VSIX; review if that changes |
| LIC-07 | Publisher identity and `__metadata` | Release blocker | Open; see `07` |
