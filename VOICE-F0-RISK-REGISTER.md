# VOICE-F0 — Risk Register

**Feature:** Bytos Voice (VS Code extension)
**Phase:** F0 — audit only.
**Date:** 2026-11-07
**Revision:** 2 — re-scored after measured blocker resolution.

**Scoring.** Probability (P) and Impact (I) on 1–5. Score = P × I.
Severity bands: **Critical** ≥ 20, **High** 12–19, **Medium** 6–11, **Low** ≤ 5.
"Blocks F1?" means the risk must be retired or explicitly accepted before F1 implementation starts.

---

## 0. Revision 2 — summary of re-scoring

| Risk | Rev 1 score | Rev 2 score | Change |
| --- | --- | --- | --- |
| B1 webview mic permission | 15 | **0 (closed)** | Measured: fails. Replaced by B1′. |
| **B1′ native capture** | — | **4 (Low)** | Measured: works on Windows. |
| B2 whisper binary | 16 | **6 (Medium)** | Binary found; new checksum-integrity sub-risk. |
| **B2′ upstream checksum unreliable** | — | **9 (Medium)** | NEW — measured mismatch. |
| B3 CLI latency | 12 | **5 (Low)** | Measured 1.5 s warm for `base`. |
| B4 Turkish/German accuracy | 9 | **9 (Medium)** | Unchanged — still unmeasured. |
| B5 Marketplace size/signing | 8 | **8 (Medium)** | Unchanged. |
| R-2 recorder audio persistence | 6 | **15 (High)** | **Elevated** — confirmed, not hypothetical. |
| R-1 draft clobbering | 12 | 12 (High) | Unchanged. |
| **R-21 native helper distribution** | — | **12 (High)** | NEW — a binary per OS is now required. |
| **R-22 macOS TCC for nested helper** | — | **16 (High)** | NEW — blocks macOS. |
| **R-23 Linux backend fragmentation** | — | **12 (High)** | NEW — blocks Linux. |
| **R-24 remote/WSL scope loss** | — | **10 (Medium)** | NEW — accepted limitation. |
| **R-25 device hot-plug unhandled** | — | **9 (Medium)** | NEW. |
| **R-26 multi-channel downmix correctness** | — | **6 (Medium)** | NEW — measured 48 kHz stereo f32 mix. |

Risks unchanged in substance: R-1, R-3–R-20 (see §B–§D). R-3 (`ScriptProcessor`) is now **moot** because capture left the webview; it is retained as closed.


## A0. Revision-2 additions and closures

### B1 — Webview microphone permission  `CLOSED (measured FAIL)`

| Field | Value |
| --- | --- |
| Rev 1 | P3 / I5 → 15 (High), blocked F1 |
| Rev 2 | **CLOSED — the hypothesis was tested and disproved** |
| Evidence | `getUserMedia` in a real VS Code 1.145.2 webview iframe → `permissions='denied'`, empty labels, `NotAllowedError` on 3/3 runs (`VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §2) |
| Resolution | TD-2 replaced by **TD-2R** (native host capture). This is no longer a risk; it is a closed architectural question. |

### B1′ — Native OS capture (the replacement path)

| Field | Value |
| --- | --- |
| P / I | 1 / 4 → **4 (Low)** |
| Blocks F1? | **No** — measured working on Windows x64 |
| Evidence | WASAPI enumeration (15 endpoints, 1 active, real names/ids), 5 s capture peak 0.627716, 6/30/60 s → 16 kHz WAV → `whisper-cli` exit 0 |
| Residual | macOS and Linux implementations unbuilt and untested (R-22, R-23) |

### B2 — Whisper binary acquisition  `CLOSED with caveat`

| Field | Value |
| --- | --- |
| Rev 1 | P4 / I4 → 16 (High) |
| Rev 2 | P1 / I3 → **6 (Medium)** |
| Evidence | `whisper-bin-x64.zip` (nightly `b5454`) downloaded; `whisper-cli.exe` runs (`--help` exit 0) and transcribes captured audio (exit 0) |
| Residual | Only Windows x64 verified; macOS/Linux binaries unverified → R-21 |

### B2′ — Upstream checksum metadata is unreliable  `NEW`

| Field | Value |
| --- | --- |
| P / I | 3 / 3 → **9 (Medium)** |
| Blocks F1? | No — but it changes TD-8 |
| Evidence | GitHub API reported `size=5 523 979`, `digest=b6cb078e…`; the served file is `8 928 640` bytes, `sha256=6ba69e34…`. **Mismatch.** |
| Impact | Integrity checks built on upstream metadata are meaningless; a nightly tag can change under a pinned hash |
| Mitigation | Bytos pins its own SHA-256 per artifact **and mirrors the exact verified bytes**; never trust upstream `size`/`digest` |
| Residual | Medium — requires owning a mirror |

### B3 — CLI latency  `CLOSED`

| Field | Value |
| --- | --- |
| Rev 1 | P3 / I4 → 12 (High) |
| Rev 2 | P1 / I5 → **5 (Low)** — measured, within an acceptable range |
| Evidence | `tiny` 701 ms, `base` 1 493 ms on 3.5 s audio; 5/15/30/60 s → 1 978 / 2 329 / 4 331 / 3 659 ms; peak RSS 302 MB |
| Residual | Short utterances are dominated by model load; a resident worker remains the escalation path |

### B4 — Turkish/German accuracy  `OPEN`

Unchanged at **9 (Medium)**. English is measured; Turkish is **NOT MEASURED**; German is **BLOCKED** (no German TTS voice). F1 must produce a human corpus before any claim.

### R-2 — gRPC recorder audio persistence  `ELEVATED`

| Field | Value |
| --- | --- |
| Rev 1 | P2 / I3 → 6 (Medium), "must verify" |
| Rev 2 | P5 / I3 → **15 (High)** — **confirmed present** |
| Evidence | `recordRequest` stores `request.message` (`grpc-recorder.ts:76-100`); `LogFileHandler.write` writes JSON to disk (`log-file-handler.ts:49-56`); enabled when `GRPC_RECORDER_ENABLED=true` + `BYTOS_ENVIRONMENT=local` (`grpc-recorder.builder.ts:46-54`) |
| Blocks F1? | **Yes** — the exclusion filter must exist before the first audio-bearing RPC |
| Mitigation | TD-17 filter, proven 5/5 |
| Residual | Low once the filter ships with a regression test |
### R-21 — Native helper must be built and shipped per OS  `NEW`

| Field | Value |
| --- | --- |
| P / I | 4 / 3 → **12 (High)** |
| Blocks F1? | No (the Windows helper is the F1 deliverable) — **blocks F2 release** |
| Description | The architecture now requires a helper binary for Windows, macOS and Linux, each built, tested, signed where required, and packaged |
| Mitigation | Start with Windows only (F1); treat macOS/Linux helpers as F2 deliverables with their own gates; keep the helper minimal and auditable rather than pulling in a large dependency |
| Residual | High — the main ongoing maintenance cost the native architecture introduces |

### R-22 — macOS TCC for a nested helper  `NEW`

| Field | Value |
| --- | --- |
| P / I | 4 / 4 → **16 (High)** |
| Blocks F1? | No — **blocks macOS release (F2 gate)** |
| Description | `NSMicrophoneUsageDescription` is required for any app using microphone APIs (Apple, DOCUMENTED). Whether a helper nested inside a VS Code extension obtains its own TCC grant, or is attributed to VS Code, is **untested** |
| Impact | If TCC attributes to VS Code, macOS voice may be impossible without a different packaging model (an installed `.app`) |
| Mitigation | Test on real Apple hardware before claiming macOS; keep the helper's permission path isolated behind the provider interface |
| Residual | High until tested |

### R-23 — Linux backend fragmentation  `NEW`

| Field | Value |
| --- | --- |
| P / I | 4 / 3 → **12 (High)** |
| Blocks F1? | No — **blocks Linux release (F2 gate)** |
| Description | PipeWire vs PulseAudio vs ALSA; distro defaults differ (Fedora=PipeWire, Ubuntu LTS=Pulse); sandboxed Flatpak/Snap needs xdg-desktop-portal; minimal/server images may have no audio at all |
| Mitigation | PipeWire→Pulse→ALSA ordering with explicit reporting; verify on Ubuntu LTS and Fedora; document sandbox/ALSA-only as unsupported |
| Residual | High until tested on two distros |

### R-24 — Remote/WSL scope loss  `NEW (accepted)`

| Field | Value |
| --- | --- |
| P / I | 5 / 2 → **10 (Medium)** — accepted and disclosed |
| Blocks F1? | No — a documented consequence |
| Description | Native host capture uses the host mic; on Remote SSH/WSL/containers that is the wrong machine, and the webview fallback is denied |
| Mitigation | Detect remote (`vscode.env.remoteName`) and report voice unavailable with an explicit reason; never capture the wrong device |
| Residual | Medium — a feature gap users will notice; must be disclosed in-product |

### R-25 — Device hot-plug / default change unhandled  `NEW`

| Field | Value |
| --- | --- |
| P / I | 3 / 3 → **9 (Medium)** |
| Blocks F1? | No |
| Description | A device unplugged mid-recording, or the OS default changing while the pane is open, must not leave the UI in `recording` or show stale devices |
| Mitigation | Seal/discard on track end; refresh on pane open; use `IMMNotificationClient` where available (documented, untested here) |
| Residual | Medium — needs real hot-plug testing (Q14) |

### R-26 — Multi-channel downmix / resample correctness  `NEW`

| Field | Value |
| --- | --- |
| P / I | 2 / 3 → **6 (Medium)** |
| Blocks F1? | No |
| Description | The device mixes at **48 kHz, 2 ch, 32-bit float** (measured). Downmix and resampling must not clip, drift, or invert |
| Mitigation | Average channels (not sum); clamp; stateful resampler; unit tests on length/fidelity; verify WAV headers at 6/30/60 s (already done) |
| Residual | Low |

---




## A. Technical blockers

### B1 — Webview microphone permission is unproven

| Field | Value |
| --- | --- |
| P / I | 3 / 5 → **15 (High)** |
| Blocks F1? | **Yes — hard gate** |
| Description | `navigator.mediaDevices.getUserMedia` may be denied inside the VS Code webview iframe. The extension cannot grant permissions (`WebviewOptions` has no media field — https://code.visualstudio.com/api/references/vscode-api#WebviewOptions), and `VscodeWebviewProvider.ts:62-66` sets only `enableScripts` + `localResourceRoots`. |
| Evidence | Feasibility A.2; `WebviewProvider.ts:119-128` (no `media-src`); in-repo capture exists only outside the VS Code webview (`apps/examples/desktop-app/webview/lib/streaming-transcription.ts:84-121`). |
| Impact if it fails | TD-2 is invalidated; capture moves to the extension host, adding a per-OS native audio backend, breaking Remote/WSL correctness, and likely making macOS unsupportable. |
| Mitigation | 10-minute spike (feasibility A.2) in a real VS Code window **before** F1 commits. Keep capture behind an `AudioCaptureSource` interface so the fallback is an implementation swap. |
| Residual | If it fails, re-plan F1 with host-capture scope and a reduced platform matrix. |

### B2 — No verified whisper.cpp prebuilt binary for a pinned release

| Field | Value |
| --- | --- |
| P / I | 4 / 4 → **16 (High)** |
| Blocks F1? | **Yes for any end-to-end demo with a real binary** |
| Description | The GitHub releases API reports `"assets": []` for v1.9.4 and v1.9.5. Binaries are attached only when the release workflow runs with `create_release: true` (`.github/workflows/release.yml`). Even when present they are unsigned third-party executables. |
| Evidence | https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest (`"assets": []`); workflow job list (`windows`, `windows-blas`, `windows-cuda`, `windows-arm64-cpu`, `ubuntu-cpu`, `ios-xcode-build`). |
| Impact | Cannot ship without finding a release with assets, building ourselves, or vendoring another distribution channel. |
| Mitigation | (a) enumerate tags with assets; (b) plan a CI build of `whisper-cli` per target with `GGML_NATIVE=OFF`; (c) code-sign artifacts; (d) pin the exact tag and checksum in the extension. |
| Residual | Owning a build pipeline is a permanent maintenance cost. |

### B3 — CLI per-utterance latency may be unacceptable

| Field | Value |
| --- | --- |
| P / I | 3 / 4 → **12 (High)** |
| Blocks F1? | No, but it decides whether TD-5 survives |
| Description | Each utterance pays `spawn + model load`. The only upstream figure is a WASM `load time = 162.37 ms` for a 140 MB model (`bindings/javascript/README.md`) — not a native measurement and not a Bytos number. |
| Evidence | Feasibility B.3, B.9. |
| Impact | If warm latency for a 5 s utterance exceeds ~2–3 s with `small`, the feature feels broken and TD-5 must move to a resident worker (native addon), re-opening B2/D-4 packaging. |
| Mitigation | Measure first on all three OSes; consider `base` and `q5_0` models; page cache warms after first use; a resident worker is the escalation path. |
| Residual | Medium even after mitigation: cold-start latency is inherent. |

### B4 — Turkish accuracy may be inadequate

| Field | Value |
| --- | --- |
| P / I | 3 / 3 → **9 (Medium)** |
| Blocks F1? | No, but it decides whether Turkish ships in F1 |
| Description | Whisper is generally weaker on Turkish (agglutinative morphology, orthography) than on English/German. No Bytos measurement exists. |
| Evidence | Feasibility B.7 (multilingual models required; `.en` variants unusable). |
| Impact | Turkish users get poor transcripts; a "supported languages" claim would be false. |
| Mitigation | Fixed corpus, WER + CER, per model. If `small` is inadequate, default Turkish to a larger model or mark Turkish beta. |
| Residual | Medium. |

### B5 — Marketplace size/signing constraints for a bundled binary

| Field | Value |
| --- | --- |
| P / I | 2 / 4 → **8 (Medium)** |
| Blocks F1? | No (F1 can develop with a locally built binary); blocks F2 packaging |
| Description | Adding a ~10–40 MB executable per platform grows the VSIX beyond its current 12.2 MB; Marketplace limits and signing requirements must be confirmed. |
| Evidence | `bytos-1.0.2.vsix` size; `bytos-1.0.2.vsix.files.txt` (no binaries today); `.vscodeignore`. |
| Impact | Would force the download-binary variant (D-c), adding first-run complexity and a provenance story. |

---

## B. Technical risks (non-blocking)

### R-1 — Draft clobbering during an in-flight submission

| Field | Value |
| --- | --- |
| P / I | 3 / 4 → **12 (High)** |
| Description | `restorePendingMessageState` restores the *submitted* text on failure (`useMessageHandlers.ts:162-169`); `consumeDraftSnapshot` clears only when `revision` is unchanged (`useChatState.ts:53-62`). A transcript inserted in that window must not be silently reverted. |
| Mitigation | TD-10: always insert via `setInputValue` (which bumps `revision`), making `consumeDraftSnapshot` a no-op for that submission — the transcript survives by construction. Covered by an explicit test. |

### R-2 — gRPC recorder captures voice payloads

| Field | Value |
| --- | --- |
| P / I | 2 / 3 → **6 (Medium)** |
| Description | Responses are recorded (`grpc-handler.ts:23-36`) and requests are recorded via `recordRequest` (`:42-48`). If the recorder persists request bodies, a `TranscribeUtteranceRequest` containing audio would be persisted — a direct privacy violation. |
| Mitigation | **Verify in F1 before any audio flows.** If bodies are persisted, exclude `VoiceService.transcribeUtterance` from recording explicitly. This is a must-verify item, not merely a risk. |

### R-3 — `ScriptProcessorNode` deprecation and quality

| Field | Value |
| --- | --- |
| P / I | 3 / 2 → **6 (Medium)** |
| Description | `createScriptProcessor` is deprecated; it runs on the main thread and can drop buffers under load. |
| Mitigation | Mirror the working in-repo implementation first (lowest risk); migrate to `AudioWorklet` if Q6 allows. Count frames and warn rather than silently losing audio. |

### R-4 — Resampler drift and boundary artefacts

| Field | Value |
| --- | --- |
| P / I | 3 / 2 → **6 (Medium)** |
| Description | A stateless resampler produces clicks and clock drift across chunk boundaries, degrading ASR. |
| Mitigation | Use a **stateful** resampler like `createResampler` (`streaming-transcription.ts:58-82`), unit-tested so total output length stays within ±1 sample of `inputLen × 16000 / inputRate` across many chunks. |

### R-5 — Orphaned whisper processes

| Field | Value |
| --- | --- |
| P / I | 3 / 4 → **12 (High)** |
| Description | A child spawned during transcription that outlives the window keeps a model in RAM. |
| Mitigation | TD-14 registry + `detached: false` + per-utterance hard timeout + kill in `tearDown()`. Assert with process-list snapshots. |

### R-6 — Temp audio leaks to disk

| Field | Value |
| --- | --- |
| P / I | 2 / 5 → **10 (Medium)** |
| Description | Any fallback staging a WAV violates TD-13, and `BytosTempManager`'s 50 h TTL (`BytosTempManager.ts:78-90`) would leave it readable. |
| Mitigation | Stdin-only transport (TD-5); a test asserts the temp directory is unchanged after a full cycle. Any future exception needs an explicit privacy review. |

### R-7 — Native addon ABI churn

| Field | Value |
| --- | --- |
| P / I | 2 / 4 → **8 (Medium)** |
| Description | If B3 forces a resident worker via a `.node` addon, every VS Code release with a new Electron may need a rebuild, and a `.node` crash kills the extension host. |
| Mitigation | Prefer N-API (ABI-stable); ship per-platform binaries unpacked (`extension.ts:699-705` pattern); gate behind the same adapter. |

### R-8 — Settings key churn forces proto regeneration conflicts

| Field | Value |
| --- | --- |
| P / I | 3 / 2 → **6 (Medium)** |
| Description | `state-keys.ts` drives `state.proto` generation (`state-keys.ts:24-29`), so Voice key additions collide with concurrent settings work. |
| Mitigation | Add all F1 keys in one commit; regenerate once; never hand-edit generated files (`build-proto.mjs` `cleanup()`). |

### R-9 — Code signing / SmartScreen / Gatekeeper

| Field | Value |
| --- | --- |
| P / I | 4 / 3 → **12 (High)** |
| Description | An unsigned downloaded `.exe` triggers SmartScreen; an unsigned nested macOS binary may be quarantined. Both surface as "the extension is broken" rather than a clear message. |
| Mitigation | Prefer a bundled binary inside the signed extension; if downloaded, authenticate the signature before exec and report a specific error. Test on clean machines (Q7). |

### R-10 — Remote / WSL / Codespaces inconsistency

| Field | Value |
| --- | --- |
| P / I | 2 / 3 → **6 (Medium)** |
| Description | Capture happens on the client (correct) but the binary runs on the server. A container without the binary, or a server with glibc mismatch, breaks voice while the UI looks available. |
| Mitigation | Capability is reported by the **host**: `GetVoiceStatus.engineReady` false ⇒ mic disabled with an explanation. |

### R-11 — Multi-window shared model directory

| Field | Value |
| --- | --- |
| P / I | 2 / 2 → **4 (Low)** |
| Description | Two VS Code windows share `~/.bytos/data`; concurrent downloads could corrupt a shared file. |
| Mitigation | `.part` + atomic rename so two windows cannot corrupt a model. |


---

## C. Privacy and product risks

### R-12 — Transcript content leaking into diagnostics

| Field | Value |
| --- | --- |
| P / I | 2 / 4 → **8 (Medium)** |
| Description | Errors and telemetry are a natural place to accidentally include user text. |
| Mitigation | §11.9 of the decisions doc; a test asserting error paths never receive transcript content in properties. |

### R-13 — Accidental or unexpected recording

| Field | Value |
| --- | --- |
| P / I | 3 / 4 → **12 (High)** |
| Description | Toggle-mode recording that stays on, or a mic that starts without a clear indicator, is a serious trust problem. |
| Mitigation | Visible indicator (composer + status), max-duration hard cap, no auto-start, no background listening, never record on settings open (TD-15), obvious cancel. |

### R-14 — Feature ships disabled and is never discovered

| Field | Value |
| --- | --- |
| P / I | 3 / 2 → **6 (Medium)** |
| Description | TD-15 defaults voice to off; users may never find it. |
| Mitigation | Discoverable mic affordance with tooltip, a walkthrough pointer, and a Settings tab that explains setup. Product decision (Q11). |

### R-15 — Users assume voice uses their chat model / provider

| Field | Value |
| --- | --- |
| P / I | 3 / 3 → **9 (Medium)** |
| Description | On-device ASR is unrelated to the configured LLM provider (TD-12), but users may believe it costs tokens or sends audio to their provider. |
| Mitigation | Explicit local-processing copy; no model-picker reuse; no provider credentials involved. |

### R-16 — Model download without consent or size disclosure

| Field | Value |
| --- | --- |
| P / I | 2 / 3 → **6 (Medium)** |
| Description | A silent 466 MB download on a metered connection is a product and trust failure. |
| Mitigation | TD-8: explicit action with visible size and progress; never on activation. |

### R-17 — Uninstall leaves hundreds of MB behind

| Field | Value |
| --- | --- |
| P / I | 4 / 2 → **8 (Medium)** |
| Description | VS Code does not delete `globalStorageUri` on uninstall. |
| Mitigation | "Remove downloaded models" action; documented path; a clear Settings hint. |

---

## D. Delivery risks

### R-18 — Codegen churn breaks unrelated work

| Field | Value |
| --- | --- |
| P / I | 3 / 3 → **9 (Medium)** |
| Description | `bun run protos` wipes and regenerates `src/generated` and `src/shared/proto` (`build-proto.mjs` `cleanup()`), creating large diffs. |
| Mitigation | One proto change per PR; regenerate and commit output; never hand-edit generated files. |

### R-19 — Windows-only development hides macOS/Linux breakage

| Field | Value |
| --- | --- |
| P / I | 4 / 3 → **12 (High)** |
| Description | The current working tree is on Windows (`win32`); CI covers lint/types/tests but not microphone behaviour on macOS. |
| Mitigation | Capability detection rather than assumption; explicit per-platform checklist in F1 acceptance; manual smoke test per OS before claiming support. |

### R-20 — Performance claims published without measurement

| Field | Value |
| --- | --- |
| P / I | 3 / 4 → **12 (High)** |
| Description | The biggest documentation risk in a voice feature is quoting a borrowed number (e.g. the WASM `load time` / `mem_required` figures) as a Bytos result. |
| Mitigation | F0 marks every number `[PENDING VALIDATION]`; F1 must not publish latency/accuracy/RAM until measured with corpus and hardware recorded. |

---

## E. Risk summary (Revision 2)

| ID | Risk | Score | Severity | Blocks F1 |
| --- | --- | --- | --- | --- |
| B1 | Webview microphone permission | **CLOSED (fails)** | — | No — architectural question answered |
| B1′ | Native OS capture (replacement) | 4 | Low | No — measured working |
| B2 | Whisper binary acquisition | 6 | Medium | No — measured working on Windows |
| B2′ | Upstream checksum metadata unreliable | 9 | Medium | No (changes TD-8) |
| B3 | CLI per-utterance latency | 5 | Low | No — measured |
| B4 | Turkish / German accuracy unknown | 9 | Medium | No |
| B5 | Marketplace size / signing | 8 | Medium | No (blocks F2) |
| R-1 | Draft clobbering during submission | 12 | High | No |
| **R-2** | **gRPC recorder persists voice payloads** | **15** | **High** | **Yes — filter must ship first** |
| R-3 | ScriptProcessor deprecation | — | **MOOT** | No — capture left the webview |
| R-4 | Resampler drift | 6 | Medium | No |
| R-5 | Orphaned whisper processes | 12 | High | No |
| R-6 | Temp audio leaks to disk | 10 | Medium | No |
| R-7 | Native addon ABI churn | 8 | Medium | No |
| R-8 | Settings / proto churn | 6 | Medium | No |
| R-9 | Code signing / SmartScreen / Gatekeeper | 12 | High | No (blocks F2) |
| R-10 | Remote / WSL inconsistency | 6 | Medium | No |
| R-11 | Multi-window shared model dir | 4 | Low | No |
| R-12 | Transcript leaks into diagnostics | 8 | Medium | No |
| R-13 | Accidental recording | 12 | High | No |
| R-14 | Undiscoverable feature | 6 | Medium | No |
| R-15 | Voice mistaken for chat-model usage | 9 | Medium | No |
| R-16 | Unconsented model download | 6 | Medium | No |
| R-17 | Uninstall leaves data | 8 | Medium | No |
| R-18 | Codegen churn | 9 | Medium | No |
| R-19 | Cross-platform blind spots | 12 | High | No |
| R-20 | Unmeasured performance claims | 12 | High | No |
| **R-21** | **Native helper per-OS distribution** | **12** | **High** | No (blocks F2) |
| **R-22** | **macOS TCC for nested helper** | **16** | **High** | No (blocks macOS) |
| **R-23** | **Linux backend fragmentation** | **12** | **High** | No (blocks Linux) |
| **R-24** | **Remote/WSL scope loss (accepted)** | **10** | **Medium** | No — disclosed |
| **R-25** | **Device hot-plug unhandled** | **9** | **Medium** | No |
| **R-26** | **Multi-channel downmix correctness** | **6** | **Medium** | No |

**Critical risks: none.**
**Hard F1 gates: R-2 only** (B1 and B2 were the rev-1 gates and are now closed by measurement).
**Hard F2 gates: B5, R-9, R-21, R-22, R-23** — each is a platform-release blocker.
**Accepted, disclosed limitations: R-24 (no remote voice in F1).**

