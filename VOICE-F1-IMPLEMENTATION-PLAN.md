# VOICE-F1 — Implementation Plan

**Feature:** Bytos Voice, Phase F1 — Audio Capture Foundation (Windows x64, local VS Code)
**Status:** PLAN ONLY. **Not authorised to execute.** Requires explicit user approval after the F0 gate.
**Date:** 2026-11-07 · **Revision:** 3 — F1 scope restored to Audio Capture Foundation only; audio removed from ProtoBus. See §0 and §1.0.
**Working rule for this project:** NO COMMIT · NO PUSH · NO DEPLOY · NO PUBLIC RELEASE. All development, testing and verification stays local. See §10.
**Prerequisites:** `VOICE-F0-ARCHITECTURE-AUDIT.md`, `VOICE-F0-FEASIBILITY-REPORT.md`, `VOICE-F0-TECHNICAL-DECISIONS.md`, `VOICE-F0-RISK-REGISTER.md`, and the Revision-2 evidence set (`VOICE-F0-NATIVE-AUDIO-CAPTURE-RESEARCH.md`, `VOICE-F0-BLOCKER-RESOLUTION-REPORT.md`, `VOICE-F0-CROSS-PLATFORM-TEST-MATRIX.md`, `VOICE-F0-ARCHITECTURE-RECOMMENDATION.md`).

---

## 0. Phase model — F0 … F5 (approved structure, binding)

This table is the **approved phase structure**. It is reproduced here because this document is the F1 plan and must not be read in isolation. Phase boundaries are **not** re-designed, merged or re-scoped by this document; the work of a later phase is not pulled forward into an earlier one.

| Phase | Name | Scope | Status |
| --- | --- | --- | --- |
| **F0** | Voice Architecture & Feasibility Audit | Audit / research / measurement / documentation only. No product code. | **COMPLETE** — `PASS` **only** for the scope actually verified in the F0 reports (Windows 10 x64, local VS Code). See `VOICE-F0-FINAL-AUDIT-REPORT.md` §K, including the explicit narrowing list (macOS `NOT TESTED`, Linux `NOT TESTED`, remote unavailable, Turkish/German accuracy unmeasured). |
| **F1** | **Audio Capture Foundation** | Windows WASAPI native helper; device discovery + capture lifecycle; binary frame transport host↔helper; PCM normalisation; in-memory audio only; cancel/stop/cleanup; audio isolation from recorder/logging/telemetry; platform & runtime capability checks; the tests F1 itself needs. | **PLAN ONLY** — this document. Awaits explicit user approval. |
| **F2** | Whisper Integration | whisper.cpp integration; engine adapter; model management + download infrastructure; model verification + checksum; transcription; language parameters; error & process management; whisper integration tests. | Not started |
| **F3** | Voice Settings | Voice settings inside the existing Settings architecture; language / microphone / model / capture preferences; status & permission indicators; microphone test; persistence; Settings UI tests. | Not started |
| **F4** | Composer Integration | Composer mic control; record / transcribe UI states; appending the transcript to the existing draft; user-editable text; existing prompt preserved; **the user presses the existing Send button**; automatic submission hard-blocked. | Not started |
| **F5** | Testing, Packaging & Release | End-to-end tests; platform tests; performance & resource tests; privacy checks; **local** VSIX packaging & install; final user verification; final report. | Not started |

**Dependency order:** F0 → F1 → F2 → F3 → F4 → F5. Each phase consumes the artefact of the previous one; a phase may not ship the next phase's work.

### 0.1 Where the phase boundaries bite (things this plan must not do)

- **F1 does not transcribe.** It captures, normalises, buffers, and cancels audio, and it can hand a complete utterance to *the next phase*. It contains **no** whisper.cpp integration, **no** model download, **no** settings UI and **no** composer UI.
- **F2 does not touch the composer or Settings.** It consumes the F1 capture output and produces text.
- **F3 and F4 are UI phases.** They consume F2's engine; they do not add capture backends or engines.
- **F5 is the only phase that packages anything** (local VSIX) and the only phase that runs end-to-end and platform test matrices.

### 0.2 Revision 3 — what changed in this document (and why)

Revision 2 of this plan *re-sequenced* F1 correctly for native capture but **over-scoped** it: it pulled whisper.cpp, the model store, the Settings tab and the composer button into F1, while `VOICE-F0-FINAL-AUDIT-REPORT.md` §K declared F1 complete on "Windows-first, recorder fix first". Revision 3 restores the approved boundaries and fixes the transport contradiction.

| Item | Revision 2 (wrong) | Revision 3 (corrected) | Why |
| --- | --- | --- | --- |
| Audio on ProtoBus | `bytes audio = 2` inside `TranscribeUtteranceRequest` | **No `bytes` audio field anywhere in `voice.proto`**; ProtoBus carries text/status/error only (§4) | Contradicted the architecture decision and the plan's own §8.2 criterion |
| Capture RPCs | Referenced by Steps 8/5a but never defined | `startCapture` / `stopCapture` / `cancelCapture` / `subscribeToVoiceEvents` defined; **all audio-free** (§4) | The plan was not implementable as written |
| F1 scope | Capture **+** Whisper **+** models **+** Settings **+** composer | **Audio Capture Foundation only** (§1) | Approved phase structure |
| Engine / model / UI work | Steps 4, 5, 6, 8, 9 | Moved to F2 / F3 / F4 (§1.2, §12) | Phase boundaries |
| Recorder exclusion | "Step 2a" inside an implementation sequence | **T1 — the first mandatory engineering task**, a hard gate before any audio-carrying path (§3) | F0 §7.3 proves a *harness* pass, not a product-code pass |
| Linux claim | "PipeWire + PulseAudio verified on two distros" | **`NOT TESTED`** everywhere (§8) | F0 matrix records `NOT TESTED` on all Linux rows |
| Commit / PR / release language | "before the first commit", "suggested commit sequence", "one reviewable PR" | Local implementation checkpoints / verification gates / test evidence / phase completion report (§10) | Project working rule: NO COMMIT, NO PUSH, NO DEPLOY, NO PUBLIC RELEASE |

**Preserved unchanged from Revision 2** (they remain correct and are not re-litigated here): capture in the extension host via a native helper (measured; webview `getUserMedia` is denied), the `AudioCaptureProvider` abstraction (TD-16), host-side RMS silence detection and duration cap (TD-6R), UTF-8 helper stdout (device names contain Turkish characters), local-only scope with an explicit unavailable reason (TD-18), no audio on disk (TD-13), and the whisper CLI + stdin contract (**now an F2 decision**, TD-5/TD-5R).

---
### 0.3 Revision 2 — what changed in Revision 2 (retained for history)

The Revision-1 plan assumed capture in the webview. Measurement killed that assumption, so the plan is re-sequenced rather than merely edited.

| Aspect | Revision 1 | Revision 2 (retained) |
| --- | --- | --- |
| Capture location | Webview (`getUserMedia`) | **Extension host, native helper child process** |
| Recorder exclusion | A risk to verify (R-2) | **Mandatory before any audio path exists** (Revision 3: this is task **T1**, §3) |
| Platform scope | All platforms "best effort" | **Windows x64 required; macOS/Linux are explicit later-phase gates** |
| Remote/WSL | Assumed advantage | **Explicitly unavailable, with a user-facing reason (TD-18)** |
| Binary provenance | "checksum from upstream" | **Bytos-pinned SHA-256 + mirror required** (upstream metadata measured wrong) — an **F2** requirement |
| Latency expectation | Unknown | **Plan against 1.5 s warm `base`, 0.7 s `tiny`** — an **F2** measurement target |
| Default language | `auto` | **`auto` still default, but explicit language is ~30 % faster** — an **F3** settings concern |

**Unchanged and preserved:** the composer guarantees (TD-10, TD-11 — now **F4**), the settings registry integration (TD-9 — now **F3**), the engine adapter (TD-4 — now **F2**), the whisper CLI contract (TD-5/TD-5R — now **F2**), and the no-disk/no-cloud privacy rules (TD-13, TD-1 — **F1**).

**Correction applied in Revision 3:** Revision 2 also listed "New Step 2a (recorder exclusion)", "Step 5a (host capture provider)" and a 12-step implementation sequence. The 12 steps were **not** the F1 phase; six of them are F2/F3/F4 work. They are preserved in §12 as a **cross-phase work breakdown** so nothing is lost, and §1/§3 define what F1 actually is.


---

## 1. F1 scope (and non-scope)

**F1 is Audio Capture Foundation.** It proves that Bytos can open a real microphone on Windows, stream the audio into the extension host, hold it in memory, and shut everything down cleanly — **without** transcribing, without a model, without any Settings or composer UI, and without a single audio byte crossing ProtoBus.

### 1.0 Phase mapping — the approved F1 scope, verbatim

| Approved F1 scope item | Where it is specified in this plan |
| --- | --- |
| Windows WASAPI native audio helper foundation | §3 T3, §3 T4 |
| Microphone device discovery and capture lifecycle | §3 T3, §3 T6 |
| Binary-frame communication between Extension Host and native helper | §3 T3 (helper), §3 T7 (host parser) |
| PCM format normalisation | §3 T6 |
| Holding audio in memory | §3 T6, §3 T8, §5 |
| Cancel, stop and resource cleanup | §3 T8, §3 T11 |
| Recorder / logging / telemetry audio isolation | **§3 T1 (first mandatory task)** |
| Platform and runtime capability checks | §3 T2, §3 T9 |
| Tests required for F1 | §7 |

Anything that is not a row in this table is **not F1**.

### 1.1 In scope

1. **Recorder / logging / telemetry audio isolation** — the exclusion filter integrated into **product source code**, proven in the real product path, before any audio-carrying path is enabled (T1).
2. **Platform and runtime capability detection** — OS/arch, local-vs-remote host, helper presence, mic availability → one host-owned status object (T2, TD-16, TD-18).
3. **Windows x64 WASAPI native helper** — `--probe`, `--list-devices`, `--capture`, `--version`; UTF-8 JSON on stdout for control commands; **length-prefixed binary PCM frames on stdout during capture**; diagnostics on stderr; no file I/O, no network, no shell (T3).
4. **`AudioCaptureProvider` abstraction + `AudioCaptureCoordinator`** selection/fallback resolver, with exactly one implementation in F1 (T4, TD-16).
5. **Device discovery** — names, stable endpoint ids, states (ACTIVE / DISABLED / UNPLUGGED / NOTPRESENT) and the current default, obtained **without** any webview permission (T3, T6).
6. **Capture lifecycle** — idle → starting → capturing → stopping → closed, with cancellation at every transition (T6, T8).
7. **PCM normalisation in the host** — device mix format → downmix to mono → resample to 16 kHz → PCM16, entirely in memory (T6).
8. **Bounded in-memory utterance buffer** — max duration cap, RMS silence detection, size cap; **never written to disk** (T6, T8).
9. **Typed errors and cleanup** — cancel, stop, device failure, helper crash; child-process registry so nothing survives teardown (T8, T11).
10. **An audio-free `VoiceService`** — capture control RPCs plus text/status/error events. **No audio payload of any kind** (T5, §4).
11. **F1-ready settings keys** — persisted capture preferences (enabled, capture method, microphone id, silence/timeout/max duration) registered in the settings registry, with **no UI** (T0, TD-9).
12. **F1 tests and local verification evidence** — unit, fake-helper process, real-helper smoke on Windows, privacy assertions, orphan-process checks (T10, §7).

### 1.2 Explicitly out of scope for F1 — and which phase owns it

| Not in F1 | Phase | Note |
| --- | --- | --- |
| whisper.cpp integration, `RecognitionEngine` adapter, `WhisperCliEngine` | **F2** | F1 defines the **utterance handoff boundary** (`CapturedUtterance`), not an engine. |
| Model management, model download, checksums, `ModelStore` | **F2** | |
| Transcription, language parameters, transcript normalisation | **F2** | |
| Engine error / process management, whisper integration tests | **F2** | |
| Bytos-pinned whisper binary SHA-256, mirror decision, binary packaging | **F2** | See §9 for the retained F0 findings. |
| Voice Settings UI (tab, pickers, detection panel) | **F3** | |
| Microphone test / level meter in Settings | **F3** | |
| Composer mic affordance, recording UI, draft insertion | **F4** | |
| Any automatic submission of a transcript | **F4** — and permanently forbidden (TD-11) | |
| macOS CoreAudio, Linux PipeWire/PulseAudio/ALSA capture | **Later phase** — `NOT TESTED` in F0 (R-22, R-23) | §8 |
| Remote SSH / WSL / Dev Containers / Codespaces voice | **Not planned** — unavailable by design (TD-18) | §8 |
| Interim / partial transcripts | Later phase | F1 is utterance-based (TD-7). |
| Push-to-talk keybinding | **F3/F4** | |
| Cloud transcription or provider credentials | Out of F1–F5 | TD-1, TD-12 |
| GPU acceleration | Not planned | |
| Native `.node` addon / resident worker | Not planned for F1 | Escalation only if a measured need appears. |
| VSIX packaging, install, end-to-end / platform test matrices | **F5** | Local VSIX only, and only in F5. |
| Marketplace publishing, signing, distribution | **None — forbidden** | NO PUBLIC RELEASE. |
| Changes to the agent runtime, the send path, or the chat pipeline | **None, ever, for voice** | Audio never reaches the agent runtime. |

**Why this matters.** Revision 2 of this plan listed whisper, models, a Settings tab and a composer button as F1 deliverables. That was a phase-boundary violation: F1 would have had to ship F2/F3/F4 work to be "done". Revision 3 removes those items from F1 and gives each one an owning phase above.

---

## 2. Prerequisites / gates before F1 implementation begins

| Gate | Deliverable | Exit condition | Status |
| --- | --- | --- | --- |
| **G1 (B1)** | Capture spike | Answered | **PASSED** — webview `getUserMedia` fails, native WASAPI works (`VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §2–3) |
| **G3 (R-2)** | Recorder audit | Leak confirmed, exclusion designed | **PASSED for the audit only** — leak confirmed at `grpc-recorder.ts:76-100` + `log-file-handler.ts:49-56`; a **harness** filter passed 5/5. **The product-code integration is F1 task T1 and is NOT done.** |
| **G4** | Build sanity | `bun run build:sdk` then `bun -F @bytos/vscode check-types` pass | To run at **local implementation checkpoint** C0 (§10) |
| **G5** | Windows helper build | A minimal WASAPI helper that compiles on Windows with a documented, reproducible build recipe | **NOT STARTED** — F1 task T3 |
| **G7** | User approval to start F1 | Explicit instruction from the user | **PENDING** |
| G2 (whisper binary) | Binary source + Bytos-pinned SHA-256 + mirror | — | **Moved to F2** (§12) |
| G6 (mirror location) | Where Bytos hosts pinned binary/models | — | **Moved to F2** (§12) |

**Note on G5.** The F0 audit verified WASAPI through a Python `ctypes` harness. F1 must produce a **shipped, reproducible** helper. There is no C/C++ build targeting this extension in the repository today, so F1 needs a one-off build step, a checked-in artifact and a documented build recipe. That is a real cost and is carried in R-21.

**No commit, push, deploy or release is part of F1.** The gates above are local: they are satisfied by local runs and recorded local test evidence (§10).

---

## 3. F1 engineering tasks (T0 … T11)

Each task ends at a **local verification gate**: the listed commands pass locally and their output is captured as local test evidence (§10). Tasks are ordered, and **T1 precedes every task that can carry audio.**

### T0 — Settings keys and generated proto

**Files**

- `apps/vscode/src/shared/storage/state-keys.ts` — add to `USER_SETTINGS_FIELDS`:

```ts
// ── Voice (F1 — capture only; no UI in this phase) ─────────────
voiceEnabled: { default: false as boolean },
voiceCaptureMethod: { default: "auto" as "auto" | "wasapi" },   // Windows-only values in F1
voiceMicrophoneId: { default: undefined as string | undefined },
voiceSilenceDetectionEnabled: { default: true as boolean },
voiceSilenceTimeoutMs: { default: 1200 as number },
voiceMaxDurationMs: { default: 120000 as number },
```

- Generated (never hand-edited): `apps/vscode/proto/bytos/state.proto`, `apps/vscode/src/shared/proto/bytos/state.ts`.

**Local verification gate:** `cd apps/vscode && bun run protos` → all six keys present in `UpdateSettingsRequest` and the `State` message; `bunx tsc --noEmit` passes; no diff outside `state-keys.ts` and generated directories.

**Risk** R-8, R-18 (single change; never hand-edit generated files).
### T1 — Recorder / logging / telemetry audio isolation  — **FIRST MANDATORY ENGINEERING TASK**

> **This is F1's first mandatory engineering task.** It is **not** "Step 2a of an implementation sequence", and it is **not** satisfied by the F0 harness result.

**What F0 established, and what it did not.**

- **Established (READ, product source):** every ProtoBus request reaches `recordRequest` (`apps/vscode/src/core/controller/grpc-handler.ts:42-48`, called at `:58`); `GrpcRecorder.recordRequest` stores `request.message` verbatim into `entry.request.message` and pushes it into the session log (`apps/vscode/src/core/controller/grpc-recorder/grpc-recorder.ts:76-100`); `LogFileHandler.write` serialises the whole session log to JSON on disk at `<workspace>/tests/specs/grpc_recorded_session_*.json` (`log-file-handler.ts:49-56`). **If an audio-bearing request crosses ProtoBus while the recorder is enabled, that audio is written to disk.**
- **Established (harness, outside the repo):** a proposed predicate passed 5/5 cases in a standalone Node harness (`VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §7.3).
- **NOT established:** that any such filter is compiled into, registered in, or exercised by product source. **A 5/5 harness pass does not mean the filter is integrated.** Today `GrpcRecorderBuilder.getRecorder()` (`grpc-recorder.builder.ts:46-54`) registers **no** filter, and `withFilters(...)` (`:30-33`) is only fed by `filtersFromEnv()`, which requires `GRPC_RECORDER_TESTS_FILTERS_ENABLED === "true"` (`:76-84`). **No default-safe voice exclusion exists in product code.**

**T1 = integrate the exclusion filter into product source code so that no voice-related audio data can reach the recorder, the session logger or telemetry.**

**Files**

- `apps/vscode/src/core/voice/recorder/voiceRequestFilter.ts` (new, pure predicate)
- `apps/vscode/src/core/voice/recorder/voiceRequestFilter.test.ts` (new)
- `apps/vscode/src/core/controller/grpc-recorder/grpc-recorder.builder.ts` — register the predicate in `getRecorder()` so it applies **unconditionally**

**Predicate (shape; exact code is T1's to write)**

```ts
export const isVoiceRequest: GrpcRequestFilter = (request) => {
    // 1. Every voice RPC is excluded, whatever its payload.
    if (request.service === "bytos.VoiceService") return true
    // 2. Defence in depth: any request carrying an audio-like field, on any service.
    const msg = typeof request.message === "string" ? safeParse(request.message) : request.message
    return carriesAudioFields(msg) // audio | audioChunk | pcm | wav | samples | ...
}
```

**Registration** (`grpc-recorder.builder.ts`, inside `getRecorder()`) — note it is **not** gated on `GRPC_RECORDER_TESTS_FILTERS_ENABLED`:

```ts
GrpcRecorderBuilder.recorder = GrpcRecorder.builder()
    .enableIf(process.env.GRPC_RECORDER_ENABLED === "true" && process.env.BYTOS_ENVIRONMENT === "local")
    .withLogFileHandler(new LogFileHandler())
    .withFilters(isVoiceRequest)     // <-- added by T1, applies on every build
    .build(controller)
```

**Rules T1 must satisfy (each one is an acceptance criterion)**

- **`bytos.VoiceService` traffic is never recorded** — every method, every payload.
- **Any request carrying an audio-like field is excluded**, independent of service and method. This matters because `GrpcRequest.message` is typed `any` (`apps/vscode/src/shared/WebviewMessage.ts`), so such a field can appear on any service.
- **The filter is safe by default** — registered in `getRecorder()` on every build, not behind an opt-in env flag.
- **Its behaviour is unit-tested in product code** — the five F0 cases reproduced as real tests against the shipped predicate:
  1. voice `transcribeUtterance`-shaped request → filtered
  2. `VoiceService.getVoiceStatus` without audio → **filtered** (whole service excluded)
  3. `StateService.updateSettings` → **not** filtered
  4. `TaskService.newTask` → **not** filtered
  5. `StateService.<anything>` carrying an `audio` field → filtered
- **Its integration is tested in product code** — a test builds the real `GrpcRecorderBuilder`/`GrpcRecorder` with the real filter and a spy `ILogFileHandler`, dispatches a `bytos.VoiceService` request, and asserts `write` never received it; non-voice traffic still records exactly as before.
- **It is verified in the real product flow** — with `GRPC_RECORDER_ENABLED=true` and `BYTOS_ENVIRONMENT=local`, run a real capture cycle in a real VS Code window and confirm the produced `grpc_recorded_session_*.json` contains **no** voice entry and **no** audio bytes. **A passing harness must not be reported as PASS for T1.**

**Sink isolation (also T1)**

- Voice log lines carry codes, ids, durations and byte counts only — never samples, never a transcript, never a raw device buffer.
- Any telemetry touch is a structured counter (phase, backend id, duration, byte count); no payload, no audio.
- A negative test asserts that `apps/vscode/src/core/voice/**` imports no telemetry or recorder API other than this filter.

**Hard gate**

> **Until T1 is complete and its evidence is recorded, no audio-carrying capture path may be enabled.** T2–T8 may be developed behind a capability switch that reports `canCapture: false`; the switch does not flip to `true` until T1's gate is green.

**Local verification gate:** the predicate suite, the recorder-integration test and the real-flow recorder-JSON inspection all pass locally, and the output is recorded as local test evidence (§10).

**Risk** R-2 — T1 exists to retire it.

---

### T2 — Platform and runtime capability detection

- OS/arch: `process.platform === "win32" && process.arch === "x64"`; helper present on disk; at least one capture endpoint present.
- Remote: `vscode.env.remoteName` set, or `vscode.env.uiKind === vscode.UIKind.Web` → **`canCapture = false` with a specific reason code** (TD-18).
- macOS / Linux / win32-arm64 → `canCapture = false`, reason `PLATFORM_NOT_SUPPORTED_IN_F1`. **No capability claim is made for these** (§8).
- Output: one host-owned `VoiceCapability` object (`canCapture`, `backend`, `reason`, `osLabel`, `deviceCount`) — the only thing any consumer reads.

**Acceptance:** unit tests cover local-win32-x64 (supported), `remoteName` set (unsupported + reason), `uiKind === Web` (unsupported + reason), darwin, linux, win32-arm64 and helper-missing. **No test asserts support for an unverified platform.**

---

### T3 — Windows WASAPI helper (foundation)

`apps/vscode/assets/voice/bin/win32-x64/bvos-audio-helper.exe` + `apps/vscode/assets/voice/README.md` (reproducible build recipe, toolchain version, artifact SHA-256).

A minimal C/C++ Windows helper. Scope stays small and auditable:

| Command | Behaviour |
| --- | --- |
| `--probe` | JSON on stdout: backend id, helper version, permission state; exit 0. **Must not crash on a machine with no microphone** — it reports `available: false`. |
| `--list-devices` | JSON array on stdout: `id`, `name`, `state` (`active`/`disabled`/`unplugged`/`notpresent`), `isDefault`. |
| `--capture --device <id|default> --rate 16000 --channels 1` | **Length-prefixed binary PCM frames on stdout.** |
| `--version` | Version string. |

Rules:

- **stdout is command-dependent:** JSON for `--probe`/`--list-devices`, **binary frames only** for `--capture`. Diagnostics go to **stderr** only.
- The frame header is documented in one header comment so the host parser has exactly one contract: little-endian `uint32 length` + `uint16 formatTag` + `uint32 sampleRate` + `uint16 channels` + payload.
- **UTF-8 explicitly** for JSON and device names. Measured need: device names contain `Kulaklık`, `Karışımı`, `Mikrofon` (`VOICE-F0-NATIVE-AUDIO-CAPTURE-RESEARCH.md` §3.4).
- **Downmix** stereo→mono by **averaging** (never summing — it clips), then resample to the requested rate.
- `--device default` resolves the OS default **at capture start**, not at argument parse.
- **No file I/O. No network. No shell. No temp files.** Audio exists only in the helper's own buffers and on stdout.
- Helper stderr carries no audio, only codes and messages.

**Acceptance:** `--probe` succeeds with no microphone; `--list-devices` reproduces the F0-measured shape on the reference host (15 endpoints, 1 ACTIVE, real names, resolved default); `--capture` for 3 s emits frames the host parser consumes with **zero lost bytes**; killing the helper leaves no process; no file appears anywhere on disk during capture.

---

### T4 — Capture providers and the selection resolver

```
apps/vscode/src/core/voice/
├── index.ts                          # lazy public exports (+ getVoiceRuntime())
├── VoiceRuntime.ts                   # lifetime owner: providers + session registry
├── VoiceSessionRegistry.ts           # helper child processes (TD-14)
├── types.ts                          # internal types (never on the wire)
├── capture/
│   ├── AudioCaptureProvider.ts       # interface (TD-16)
│   ├── WasapiCaptureProvider.ts      # spawns + parses the helper
│   ├── AudioCaptureCoordinator.ts    # selection + fallback ONLY
│   ├── frameParser.ts                # pure length-prefixed decoder
│   └── binaryLocator.ts              # win32-x64 path incl. asar.unpacked
└── audio/
    ├── pcm.ts                        # float32/int16/int24/int32 → PCM16, clamp, downmix
    ├── resample.ts                   # stateful linear resampler (F0 algorithm)
    ├── SilenceDetector.ts            # RMS gate (TD-6R)
    └── UtteranceBuffer.ts            # bounded accumulation + duration/byte caps
```

**Design rule (non-negotiable, from `VOICE-F0-NATIVE-AUDIO-CAPTURE-RESEARCH.md` §6):** a provider reports what it can do and what it observed; it never decides which one wins. Selection and fallback live in the coordinator, so the policy is unit-testable in isolation.

**`AudioCaptureProvider` interface (F1 shape)**

```ts
export interface AudioCaptureProvider {
    readonly id: string                                     // "wasapi"
    isAvailable(): Promise<boolean>
    getStatus(): Promise<CaptureProviderStatus>              // backend, permission, deviceCount
    enumerateDevices(): Promise<CaptureDeviceInfo[]>
    startCapture(opts: StartCaptureOptions): Promise<void>   // deviceId, signal
    stopCapture(): Promise<void>
    cancelCapture(): Promise<void>
    onFrames(listener: (frame: PcmFrame) => void): () => void
    dispose(): Promise<void>
}
```

**`binaryLocator.ts`** resolves the helper at `<extensionUri>/assets/voice/bin/<platform>-<arch>/bv-os-audio-helper[.exe]`, then the `asar.unpacked` variant (mirrors `extension.ts:699-705`), and throws `CAPTURE_HELPER_MISSING` when absent. It is **not** the whisper binary locator — that belongs to F2.

**Acceptance:** coordinator tests cover pinned-available, pinned-unavailable, automatic order and nothing-available; a manual device pin is **never silently overridden** — it fails with a typed error instead (also an F1 acceptance criterion, §6).

---

---

### T5 — Audio-free `VoiceService` contract

Full definition and rules in **§4**. Summary: ProtoBus carries capture control, status, device metadata and error text — **never audio**.

**Acceptance:** `voice.proto` contains no `bytes`, `repeated bytes`, `audio`, `pcm`, `wav` or `samples` field; a guard test parses `voice.proto` and fails the build if any appears.

---


### T6 — PCM normalisation, silence detection and the bounded utterance buffer

- **Lifecycle state machine:** `idle → starting → capturing → stopping → closed`, plus `failed(reason)`. Illegal transitions are typed errors, never silent no-ops.
- `audio/pcm.ts` — device mix format (`48000 Hz`, 2 ch, 32-bit float, `WAVE_FORMAT_EXTENSIBLE`, measured in F0) → mono → PCM16, with clamping and averaging downmix.
- `audio/resample.ts` — stateful linear resampler to 16 kHz; **the F0 algorithm is ported, not re-invented** (`capture_to_wav.py` already produced 16 kHz mono PCM16 that the downstream consumer accepted).
- `audio/SilenceDetector.ts` — RMS gate (TD-6R): one seal per speech burst, timeout from `voiceSilenceTimeoutMs`.
- `audio/UtteranceBuffer.ts` — bounded accumulation with `voiceMaxDurationMs` and a byte cap. **On overflow it truncates and reports**; it never grows without bound.

**Acceptance**

- 48 kHz stereo float32 in → 16 kHz mono PCM16 out, at 6 / 30 / 60 s of input.
- Resample output length within ±1 sample, **no drift across 100 chunks**.
- Silence detector emits exactly **one** seal per speech burst and none for pure silence.
- The buffer refuses to exceed its caps and truncates visibly.
- **No audio is written to disk at any point** (§5).

---

### T7 — Binary frame transport, host side

- `capture/frameParser.ts` — pure length-prefixed decoder: partial reads, several frames in one chunk, one frame split across chunks, corrupt/absurd length rejected with a typed error (`CAPTURE_FRAME_CORRUPT`), oversized frame rejected.
- Backpressure: when the buffer is at its cap, audio is **dropped and counted**, never buffered without bound.
- **Bytes never leave memory.** The parser's output goes only to the utterance buffer; there is no file sink and no RPC sink.

**Acceptance:** a test that re-chunks the same 3 s capture at 1 000 random boundaries reassembles **byte-identical** audio; a corrupt length never throws out of the provider boundary.

---

### T8 — Cancel, stop and resource cleanup

- Cancel from **every** lifecycle state; `AbortSignal` propagated; a helper mid-capture is killed.
- `VoiceSessionRegistry` tracks helper children; `dispose()` kills them all and is idempotent.
- `apps/vscode/src/common.ts` `tearDown()` disposes the voice runtime **before** the `StateManager.flushPendingState()` finally block, next to `HookProcessRegistry.terminateAll()` (`common.ts:181`).
- Buffer memory is dropped on stop / cancel / dispose; nothing is retained "just in case".

**Acceptance:** cancel leaves **0** orphan helpers (process-table assertion) and 0 bytes on disk; closing the window mid-capture leaves 0 orphans; a second `dispose()` is a no-op; no unhandled rejection on cancel.

---

### T9 — Capability-gated enablement

- The audio-carrying capture path sits behind T1's gate: `canCapture` is only `true` when T1 is verified **and** the T2 runtime check passes.
- Unsupported environments surface **Voice unavailable** with an explicit reason code and an explicit explanation (for remote: the extension host runs on the far machine and has no guaranteed access to the local microphone).

**Acceptance:** in every unsupported environment the host-facing status is `unavailable` with a reason, and **no helper is spawned**.

---

### T5b — Capture controller handlers (audio-free)

Handlers live in `apps/vscode/src/core/controller/voice/`: `index.ts`, `getVoiceStatus.ts`, `listCaptureDevices.ts`, `startCapture.ts`, `stopCapture.ts`, `cancelCapture.ts`, `subscribeToVoiceEvents.ts`.

**`subscribeToVoiceEvents.ts`** is modelled on `subscribeToAddToInput.ts:16-59`: module-level `Set<StreamingResponseHandler<VoiceEvent>>`, `getRequestRegistry().registerRequest(requestId, cleanup, { type: "voiceEvents_subscription" }, responseStream)`, and a `publish(evt)` that drops handlers which throw.

**`startCapture.ts`**

```ts
export async function startCapture(_c: Controller, req: StartCaptureRequest) {
    const runtime = await getVoiceRuntime()                     // lazy (TD-15)
    if (!runtime.capability.canCapture) throw new VoiceError(runtime.capability.reason)
    if (!runtime.recorderIsolationVerified) throw new VoiceError("RECORDER_ISOLATION_UNVERIFIED")
    await runtime.coordinator.start({ deviceId: req.microphoneId || undefined })
    return StartCaptureResponse.create({ sessionId: runtime.currentSessionId, sampleRate: 16_000, channels: 1 })
}
```

**Hard rules for every handler**

- **No handler accepts, returns, logs or forwards audio.** The request messages cannot even express audio (§4).
- `getVoiceStatus` performs **zero** child-process spawns; it reports cached state plus a cheap file `stat` for the helper.
- Unknown device id or illegal transition → **typed error**, not a crash.
- Handlers never touch `TaskService` / `SendMessage` / `cancelTask` — the voice path cannot submit (TD-11).

**Acceptance:** no handler references a byte buffer from the wire; `getVoiceStatus` spawn count is asserted to be 0; every illegal transition has a test.

---


### T10 — F1 test suite

See §6. Includes the fake-helper process suite and the real-helper Windows smoke test.

---

### T11 — Lifecycle teardown and the F1 completion report

Full local verification (§10), the **local phase completion report**, and an updated risk/status table. **No commit, no push, no deploy, no packaging.**

---

## 4. The `VoiceService` ProtoBus contract — text / status / error only

### 4.1 The audio data path (authoritative)

```
 ① native audio helper (WASAPI)                      ┌── captures the microphone
                    │                                 │
                    │  stdout: length-prefixed binary frames
                    ▼                                 │
 ② Extension Host (Node)     ────────────────────────┤  holds audio ONLY in memory
                    │                                 │  (UtteranceBuffer, bounded)
                    │  stdin (next phase: F2)         │
                    ▼                                 │
 ③ Whisper CLI (F2)          ────────────────────────┤  produces transcript text
                    │                                 │
                    │  stdout: text                   │
                    ▼                                 │
 ④ Extension Host             ───────────────────────┘  returns text/status/error
                    │
                    │  ProtoBus: TEXT, STATUS, ERROR only
                    ▼
 ⑤ Webview (F3/F4 UI)
```

The steps, stated as rules:

1. The **native audio helper** captures the microphone.
2. The helper hands audio to the **Extension Host over stdout** as **length-prefixed binary frames**.
3. The Extension Host holds audio **only in memory**.
4. (**F2**) The Extension Host passes audio to the **Whisper CLI's stdin**.
5. (**F2**) The transcription result returns to the Extension Host.
6. **Only text, status and error information crosses ProtoBus.**

### 4.2 Prohibitions (hard, non-negotiable)

- **No audio bytes, PCM, WAV or any other audio payload is sent over ProtoBus.**
- **`voice.proto` contains no audio-carrying `bytes` field.** There is no `bytes audio`, no `bytes wav`, no `bytes pcm`, no `repeated float samples` — anywhere in the file.
- **The `VoiceService` RPC design is limited to text / status / error data.**
- **Audio data is never sent to the existing Agent Runtime.** It never reaches `TaskService`, the send path, or the chat pipeline.
- **Audio data never reaches the gRPC recorder, the session logger or telemetry.** T1 enforces this.
- No audio path/temp file is ever passed through an RPC either (that would be the same leak in a different costume).

### 4.3 `voice.proto` (F1)

```proto
syntax = "proto3";
package bytos;
import "bytos/common.proto";

// ── Capture control: requests carry identifiers and small numbers. No audio. ──

message StartCaptureRequest {
  string microphone_id = 1;        // "" = system default
  string capture_method = 2;       // "auto" | "wasapi"
  int32 silence_timeout_ms = 3;
  int32 max_duration_ms = 4;
}

message StartCaptureResponse {
  string session_id = 1;
  int32 sample_rate = 2;           // always 16000 in F1
  int32 channels = 3;              // always 1 in F1
  string backend = 4;              // "wasapi"
}

message StopCaptureRequest  { string session_id = 1; }
message CancelCaptureRequest { string session_id = 1; }
message EmptyResponse {}

message CaptureDeviceInfo {
  string id = 1;
  string name = 2;
  string state = 3;                // "active" | "disabled" | "unplugged" | "notpresent"
  bool is_default = 4;
}

message ListCaptureDevicesResponse { repeated CaptureDeviceInfo devices = 1; }

message VoiceStatus {
  bool enabled = 1;
  bool can_capture = 2;
  string backend = 3;              // "wasapi" | "none"
  string unavailable_reason = 4;   // stable code, e.g. REMOTE_HOST_UNSUPPORTED
  bool permission_granted = 5;
  int32 device_count = 6;
  string selected_microphone_id = 7;
  string capture_state = 8;        // idle | starting | capturing | stopping | closed | failed
  int32 frames_received = 9;       // counters, never payload
  int32 bytes_received = 10;       // counters, never payload
  string last_error_code = 11;
}

// ── Events: status and errors only. ──
message VoiceEvent {
  string kind = 1;                 // captureStatus | deviceListChanged | error
  string session_id = 2;
  string capture_state = 3;
  int32 duration_ms = 4;
  int32 bytes_received = 5;
  string code = 6;
  string message = 7;
}

service VoiceService {
  rpc getVoiceStatus(EmptyRequest)                 returns (VoiceStatus);
  rpc listCaptureDevices(EmptyRequest)             returns (ListCaptureDevicesResponse);
  rpc startCapture(StartCaptureRequest)            returns (StartCaptureResponse);
  rpc stopCapture(StopCaptureRequest)              returns (EmptyResponse);
  rpc cancelCapture(CancelCaptureRequest)          returns (EmptyResponse);
  rpc subscribeToVoiceEvents(EmptyRequest)         returns (stream VoiceEvent);
}
```

**Deliberately absent from F1** (they belong to later phases and must not appear early):

| Absent RPC / field | Phase |
| --- | --- |
| `transcribeUtterance` | **F2** — and even then it takes **no audio**, because the audio is already in the host |
| `installModel` / `removeModel`, `InstalledModel` | **F2** |
| `VoiceEvent.text` / transcript events | **F2** |
| `language`, `model_id`, `engine` in status | **F2/F3** |
| any Settings-tab or composer-specific message | **F3/F4** |

### 4.4 Verification of this section

- A guard test parses `proto/bytos/voice.proto` and fails if any message field is typed `bytes` / `repeated bytes` / `fixed*` / `sfixed*`, or if any field name matches `/audio|pcm|wav|sample|wave|pcm16/i`.
- A review checklist item: "would this RPC ever carry audio?" — if the answer is not an unambiguous *no*, the RPC is wrong.
- The F1 completion report records the exact `voice.proto` content in the local test evidence.

---


---
## 5. F1 file structure

### 5.1 New files — extension host

```
apps/vscode/proto/bytos/voice.proto                              (T5 — audio-free, §4)

apps/vscode/assets/voice/bin/win32-x64/bv-os-audio-helper.exe    (T3 — built artifact)
apps/vscode/assets/voice/README.md                               (T3 — build recipe + SHA-256)

# Runtime skeleton (T4)
apps/vscode/src/core/voice/index.ts
apps/vscode/src/core/voice/VoiceRuntime.ts
apps/vscode/src/core/voice/VoiceSessionRegistry.ts               (helper children, TD-14)
apps/vscode/src/core/voice/capability.ts                         (T2)
apps/vscode/src/core/voice/types.ts

# Recorder isolation (T1 — first)
apps/vscode/src/core/voice/recorder/voiceRequestFilter.ts

# Capture (T3/T4/T6/T7)
apps/vscode/src/core/voice/capture/AudioCaptureProvider.ts
apps/vscode/src/core/voice/capture/WasapiCaptureProvider.ts
apps/vscode/src/core/voice/capture/AudioCaptureCoordinator.ts
apps/vscode/src/core/voice/capture/frameParser.ts
apps/vscode/src/core/voice/capture/binaryLocator.ts
apps/vscode/src/core/voice/audio/pcm.ts
apps/vscode/src/core/voice/audio/resample.ts
apps/vscode/src/core/voice/audio/SilenceDetector.ts
apps/vscode/src/core/voice/audio/UtteranceBuffer.ts

# Controller handlers (T5b — audio-free)
apps/vscode/src/core/controller/voice/index.ts
apps/vscode/src/core/controller/voice/getVoiceStatus.ts
apps/vscode/src/core/controller/voice/listCaptureDevices.ts
apps/vscode/src/core/controller/voice/startCapture.ts
apps/vscode/src/core/controller/voice/stopCapture.ts
apps/vscode/src/core/controller/voice/cancelCapture.ts
apps/vscode/src/core/controller/voice/subscribeToVoiceEvents.ts
```

### 5.2 New files — tests

```
apps/vscode/src/core/voice/__tests__/voiceRequestFilter.test.ts          (T1)
apps/vscode/src/core/voice/__tests__/recorderIntegration.test.ts         (T1)
apps/vscode/src/core/voice/__tests__/capability.test.ts                  (T2)
apps/vscode/src/core/voice/__tests__/frameParser.test.ts                 (T7)
apps/vscode/src/core/voice/__tests__/pcm.test.ts                         (T6)
apps/vscode/src/core/voice/__tests__/resample.test.ts                    (T6)
apps/vscode/src/core/voice/__tests__/SilenceDetector.test.ts             (T6)
apps/vscode/src/core/voice/__tests__/UtteranceBuffer.test.ts             (T6)
apps/vscode/src/core/voice/__tests__/binaryLocator.test.ts               (T4)
apps/vscode/src/core/voice/__tests__/WasapiCaptureProvider.test.ts       (T4 — fake helper)
apps/vscode/src/core/voice/__tests__/AudioCaptureCoordinator.test.ts     (T4)
apps/vscode/src/core/voice/__tests__/VoiceRuntime.test.ts                (T8)
apps/vscode/src/core/voice/__tests__/voiceProtoGuard.test.ts             (T5 — §4.4)
apps/vscode/src/core/voice/__tests__/VoiceHandlers.test.ts               (T5b)
```

### 5.3 Generated (never hand-edited)

```
apps/vscode/proto/bytos/state.proto
apps/vscode/src/shared/proto/bytos/voice.ts
apps/vscode/src/shared/proto/bytos/state.ts
apps/vscode/src/generated/**                  (grpc-js, nice-grpc, hosts)
apps/vscode/webview-ui/src/services/grpc-client.ts
```

### 5.4 Modified files (the complete F1 list)

| File | Change | Reason |
| --- | --- | --- |
| `apps/vscode/src/core/controller/grpc-recorder/grpc-recorder.builder.ts` | register `isVoiceRequest` in `getRecorder()` unconditionally | **T1 — first task** |
| `apps/vscode/src/shared/storage/state-keys.ts` | +6 keys in `USER_SETTINGS_FIELDS` | T0 (TD-9) |
| `apps/vscode/src/core/controller/state/updateSettings.ts` | +6 branches | settings write path |
| `apps/vscode/src/common.ts` | `tearDown()` disposes the voice runtime | T8 (TD-14) |
| `apps/vscode/vitest.config.ts` | add `src/core/voice/**/*.test.ts` to `include` | the file uses an explicit list (`vitest.config.ts:9-42`) |
| `apps/vscode/scripts/run-bun-unit-tests.ts` | exclude voice tests needing vitest-only doubles | avoid double-running (`:39-43` pattern) |
| `apps/vscode/THIRD-PARTY-NOTICES.txt` / `.json` | helper's own dependencies only (no whisper.cpp in F1) | licensing gate (`scripts/check-licenses.mjs`) |
| `apps/vscode/.vscodeignore` | keep the F1 helper **out** of any packaged bundle | F5 owns packaging; F1 ships nothing |
| `apps/vscode/knip.json` | entry for the helper artifact if knip flags it | unused-file gate |

**Deliberately NOT modified in F1:** `ChatTextArea.tsx`, `useMessageHandlers.ts`, `useChatState.ts`, `grpc-handler.ts`, `WebviewProvider.ts` (no CSP change), `extension.ts` activation order, and **every webview file** — F1 has no UI.

**Note on `.vscodeignore`:** the helper exists for F1 development and F1 tests only. Whether it ships is an **F5** packaging decision; F1 must not change what a packaged extension contains.

---
## 6. F1 tests

### 6.1 Unit — extension host (vitest)

| Test file | Asserts |
| --- | --- |
| `voiceRequestFilter.test.ts` | the five F0 cases against the shipped predicate; whole-service exclusion; audio-field exclusion on any service |
| `recorderIntegration.test.ts` | real builder + real filter + spy `ILogFileHandler`: a voice request never reaches `write`; a non-voice request still does |
| `capability.test.ts` | win32-x64 supported; remote / web / macOS / Linux / arm64 unsupported **with a reason**; helper-missing unsupported; no claim for an unverified platform |
| `frameParser.test.ts` | partial reads; several frames per chunk; one frame split across chunks; corrupt and oversized length; byte-identical reassembly at 1 000 random chunk boundaries |
| `pcm.test.ts` | float32/int16/int24/int32 → PCM16 clamping; averaging downmix (not summing) |
| `resample.test.ts` | output length ±1 sample; no drift across 100 chunks |
| `SilenceDetector.test.ts` | exactly one seal per speech burst; none on pure silence; timeout honoured |
| `UtteranceBuffer.test.ts` | duration cap and byte cap; truncation reported; no unbounded growth |
| `binaryLocator.test.ts` | win32-x64 path resolution incl. `asar.unpacked`; `CAPTURE_HELPER_MISSING` |
| `WasapiCaptureProvider.test.ts` | fake helper process: probe, list, capture, kill; diagnostics only on stderr |
| `AudioCaptureCoordinator.test.ts` | pinned-available, pinned-unavailable, automatic order, nothing-available; a manual pin is never silently overridden |
| `VoiceRuntime.test.ts` | lazy construction (TD-15); idempotent `dispose()`; children killed |
| `voiceProtoGuard.test.ts` | `voice.proto` contains no audio-carrying field (§4.4) |
| `VoiceHandlers.test.ts` | `getVoiceStatus` spawns nothing; illegal transition → typed error; no handler touches `TaskService` |

### 6.2 F1 behavioural / privacy tests (non-negotiable)

```ts
it("never writes audio to disk during a capture cycle", async () => {
    // snapshot the temp and workspace directories before and after
    expect(newFiles).toEqual([])              // 0 new files anywhere
})

it("never sends audio over ProtoBus", () => {
    // every VoiceService request/response body is JSON-serialisable
    // and carries no byte payload (§4)
})

it("never reaches the agent runtime or the send path", () => {
    expect(TaskServiceClient.newTask).not.toHaveBeenCalled()
    expect(TaskServiceClient.askResponse).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
})
```

### 6.3 What F1 intentionally does not test

Transcription accuracy, latency, model checksums, Settings behaviour and composer insertion are **not** F1 test targets — they belong to F2/F3/F4/F5. F1's suite must not import or construct any recognition engine, model store, Settings component or composer component.

### 6.4 Manual smoke matrix (Windows 10 x64, local VS Code)

| # | Case | Expected |
| --- | --- | --- |
| S1 | `--probe` with no microphone attached | `available: false`, exit 0, no crash |
| S2 | `--list-devices` on the reference host | 15 endpoints, 1 ACTIVE, real names, resolved default |
| S3 | Capture 3 s, then stop | Complete utterance in memory; **0 files on disk** |
| S4 | Capture 1 s, then cancel | Buffer dropped; **0 orphan helpers**; 0 files on disk |
| S5 | Close the window mid-capture | 0 orphan helpers; 0 files on disk |
| S6 | Remote SSH / WSL / Dev Container window | Voice **unavailable** with an explicit reason; helper never spawned |
| S7 | `GRPC_RECORDER_ENABLED=true` + a full capture cycle | `grpc_recorded_session_*.json` contains **no** voice entry and **no** audio |

Multi-device selection, hot-plug / reconnect, the Windows microphone-denial path, and all macOS/Linux behaviour are **`NOT TESTED`** and must be reported as such, never as passing (§8).

---

## 7. Dependencies


### No new runtime npm dependencies in F1

Everything uses Node built-ins (`child_process`, `fs`, `path`, `os`) and APIs already present. This is deliberate: adding a native addon would re-open the packaging problem this plan avoids, and F1 must not need a network capability at all (no model download in F1).

F1 adds **one native artifact** — the Windows x64 capture helper — plus its documented build recipe. It adds **no** whisper binary and **no** model (F2).

### Development tooling already present

`vitest`, `@vscode/vsce`, `grpc-tools`/`protoc` (via `build-proto.mjs`), Playwright, `.vscode-test`.

### Deferred to F2 (recorded here only so it is not lost)

- whisper.cpp binary per target platform (`GGML_NATIVE=OFF`, CPU-only, `GGML_CPU_ALL_VARIANTS=ON` for x64).
- Bytos-pinned SHA-256 for binary and models, plus a mirror (§9).
- A model hosting location with checksummed artifacts.

---

## 8. Platform support and its limits

**Status vocabulary is fixed:** `VERIFIED` (measured during F0 on the stated host), `NOT TESTED` (no capable host — **no claim is made**), `NOT SUPPORTED` (deliberately out of scope).

| Platform / environment | Status | Notes |
| --- | --- | --- |
| **Windows 10 x64, local VS Code** | **VERIFIED in F0** | WASAPI enumeration + real capture + cancel cleanup measured (`VOICE-F0-FINAL-AUDIT-REPORT.md` §B, `VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §3). This is the **only** platform F1 targets. |
| Windows microphone denial path (`E_ACCESSDENIED`) | **NOT TESTED** | F0 host had the microphone allowed; the error path is `INFERRED` only (`VOICE-F0-NATIVE-AUDIO-CAPTURE-RESEARCH.md` §3.2). |
| More than one microphone device (selection end to end) | **NOT TESTED** | F0 host had exactly **1 ACTIVE** endpoint; manual device selection is `BLOCKED` in `VOICE-F0-CROSS-PLATFORM-TEST-MATRIX.md` §2.1. |
| Device hot-plug / reconnect | **NOT TESTED** | `IMMNotificationClient` callbacks are `DOCUMENTED`, never exercised (`VOICE-F0-RISK-REGISTER.md` R-25). |
| Windows arm64 | **NOT SUPPORTED in F1** | Requires a separate helper build. |
| **macOS CoreAudio / TCC** | **NOT TESTED** | CoreAudio and `NSMicrophoneUsageDescription` are `DOCUMENTED` only. Whether a helper nested in a VS Code extension receives **its own TCC grant** is unverified and is a release blocker (R-22). **No macOS claim is made.** |
| **Linux PipeWire / PulseAudio** | **NOT TESTED** | No Linux host was available (`VOICE-F0-CROSS-PLATFORM-TEST-MATRIX.md` §1: U1/U2 = `NO`). PipeWire, `pipewire-pulse`, PulseAudio and ALSA findings are **documentation research and `INFERRED` design reasoning**, not device tests (R-23). **No Linux result is claimed.** |
| Flatpak / Snap sandboxing, xdg-desktop-portal | **UNVERIFIED RISK** | Research/inference only: sandboxed apps are documented to need `xdg-desktop-portal`; whether direct ALSA/Pulse access is available inside a sandbox is untested. |
| WSL / Remote SSH / Dev Container / Remote | **NOT SUPPORTED in F1** | The extension host runs on the **remote machine**; there is **no guarantee of access to the local computer's microphone**. The feature reports **Voice unavailable with an explicit reason** — never a silent failure and never the wrong device (TD-18). |
| VS Code Web / Codespaces | **NOT SUPPORTED in F1** | Same reasoning; the host is remote. |
| JetBrains / standalone hosts | **Out of scope** | The webview is shared (`vite.config.ts:86-88`). |

### 8.1 Future verification requirements (recorded, not claimed)

These are **requirements for a later phase**, listed so they are not forgotten and so nobody mistakes the research for a result:

1. **Ubuntu LTS x64** — PulseAudio path (and PipeWire where the distro ships it): enumerate, capture, cancel, device selection with ≥2 inputs.
2. **Fedora x64** — PipeWire path (`pipewire-pulse` compatibility): same matrix.
3. **Linux sandbox** — Flatpak and/or Snap VS Code with `xdg-desktop-portal`: does capture work, and what is the failure mode when it does not?
4. **Linux ALSA-only / server/no-audio images** — explicit "no audio server" detection and a disable-with-reason path.
5. **macOS (Intel and Apple silicon)** — CoreAudio capture, `NSMicrophoneUsageDescription` attribution, and **TCC behaviour for a nested helper**.
6. **Windows denial path** — `E_ACCESSDENIED` from `Activate`/`Initialize`, with a typed error and a clear UI explanation.
7. **Windows multi-device and hot-plug** — ≥2 active inputs, unplug/replug, default-device change.
8. **Human speech corpora** for Turkish and German before any accuracy claim (see §9).

### 8.2 The unsupported-environment requirement

For every environment in the `NOT SUPPORTED` / `NOT TESTED` rows above, the product must show **Voice unavailable** with:

- a stable reason code (`REMOTE_HOST_UNSUPPORTED`, `PLATFORM_NOT_SUPPORTED_IN_F1`, `NO_AUDIO_DEVICE`, `HELPER_MISSING`, …), and
- a human explanation of *why* (for remote: the microphone belongs to the local machine but the extension host runs elsewhere).

**No support claim may be invented for a platform that has not actually been verified.** F1's obligation is to make that state correct and visible — not to paper over it.

---


## 9. Acceptance criteria (F1)

F1 is complete only when **all** of the following hold.

### 9.1 Audio isolation — the gate that comes first

- [ ] **T1 is complete**: `isVoiceRequest` is registered in `grpc-recorder.builder.ts` `getRecorder()` **unconditionally** (not behind `GRPC_RECORDER_TESTS_FILTERS_ENABLED`).
- [ ] `bytos.VoiceService` traffic is excluded from recording for every method.
- [ ] A request carrying an audio-like field is excluded on **any** service (defence in depth).
- [ ] The five F0 cases pass as **real unit tests against the shipped predicate**, not as a harness.
- [ ] An **integration test in product code** proves a voice request never reaches `ILogFileHandler.write`.
- [ ] **Real-flow evidence**: with `GRPC_RECORDER_ENABLED=true` + `BYTOS_ENVIRONMENT=local`, the produced `grpc_recorded_session_*.json` contains no voice entry and no audio.
- [ ] **No audio-carrying capture path is enabled until all of the above are green.**

### 9.2 Capture (Windows x64, local VS Code)

- [ ] `--list-devices` returns real names, stable ids, states and the resolved default.
- [ ] Capture produces 16 kHz mono PCM16 **in memory**, with downmix by averaging and no clipping.
- [ ] Silence detection seals exactly once per speech burst; max duration caps the recording.
- [ ] A manual method/device pin **persists** and is **never silently overridden** — it fails with a typed error instead.
- [ ] Cancel works from every lifecycle state and leaves no buffer behind.
- [ ] Closing the window mid-capture leaves **no orphan helper process**.
- [ ] Errors are typed and carry a stable code; no stack traces leak to the UI.

### 9.3 Architecture

- [ ] **`voice.proto` contains no audio-carrying field** — no `bytes audio`, no `pcm`/`wav`/`samples` field (§4.4 guard test).
- [ ] **ProtoBus carries text / status / error only**; every `VoiceService` message is audio-free by construction.
- [ ] Audio never reaches the **agent runtime**, the **send path** or the **chat pipeline**.
- [ ] Audio never reaches the **recorder**, the **session logger** or **telemetry**.
- [ ] No voice module is imported at `extension.ts` top level (TD-15); the runtime is lazy.
- [ ] `tearDown()` kills any live helper (TD-14).
- [ ] No file under `apps/vscode/src/core/voice/**` imports `@bytos/llms` or any provider module (TD-12).
- [ ] **No webview file is modified in F1**; the webview contains no `mediaDevices` / `getUserMedia` / `AudioContext` reference (TD-2R).
- [ ] **F1 contains no whisper.cpp integration, no model download, no Settings UI and no composer UI.**

### 9.4 Privacy

- [ ] **No audio file appears in any temp directory, workspace or log during a full capture cycle.**
- [ ] No audio in the recorder output (9.1).
- [ ] Log lines carry codes, ids, durations and counters only.
- [ ] The helper child environment carries no provider credentials.

### 9.5 Platform honesty

- [ ] Every unsupported environment reports **Voice unavailable with a reason code** and never spawns a helper.
- [ ] **macOS and Linux are reported `NOT TESTED`** — no support claim anywhere in code, docs or strings.
- [ ] Remote / WSL / container is reported unsupported with the "microphone is local, host is remote" explanation.

### 9.6 Quality gates (all local)

- [ ] `bunx tsc --noEmit` passes (host; webview untouched).
- [ ] `bun run test:vitest` passes with the F1 suites included.
- [ ] `bun run test:unit` passes.
- [ ] `bun run lint` passes; `knip` reports no new unused exports.
- [ ] Licensing gate recognises the helper's own dependencies in `THIRD-PARTY-NOTICES.txt` (no whisper.cpp in F1).
- [ ] The helper artifact's SHA-256 is recorded in `assets/voice/README.md`.

### 9.7 Measurements to record in the F1 completion report

- [ ] Helper `--probe` / `--list-devices` latency and the measured endpoint count/state shape.
- [ ] Helper peak RSS during a 60 s capture (no F0 baseline — first measurement).
- [ ] Frames and bytes received vs. expected for 3 / 30 / 60 s captures (zero loss).
- [ ] Resampler accuracy at 6 / 30 / 60 s (length ±1 sample, no drift).
- [ ] Orphan-process check after cancel, after window close, and after a helper crash.
- [ ] Recorder JSON inspection result (9.1).
- [ ] Any unmet target from `VOICE-F0-TECHNICAL-DECISIONS.md` §9 recorded as a known gap, never silently dropped.

**Not F1 acceptance criteria** (they are F2+): transcription latency, peak RSS of whisper, WER/CER, model checksum behaviour, Settings behaviour, composer insertion. The F0 latency figures (701 ms `tiny`, 1 493 ms `base`, 302 MB RSS) remain **F2 baselines to reproduce**, not F1 targets.

---
## 10. Working method — local only

**Project working rule: NO COMMIT · NO PUSH · NO DEPLOY · NO PUBLIC RELEASE.**

All development, testing and verification for Bytos Voice happens **locally**. There is no branch strategy, no PR sequence, no release process and no publishing step in this plan. The vocabulary below replaces any commit/PR/release language.

### 10.1 Local implementation checkpoint (C0 … C13)

A checkpoint is a **stop-and-review point on the local working tree**. Each one leaves the tree in a state where the local verification gate passes.

| Checkpoint | Content | Gate |
| --- | --- | --- |
| **C0** | Build sanity (G4) — nothing else changed | `bun run build:sdk` + `bun -F @bytos/vscode check-types` pass |
| **C1** | **T1** recorder isolation (filter + tests + integration test) | `bun run test:vitest` passes; the recorder-integration test is green |
| **C2** | T1 real-flow evidence in a VS Code window | recorder JSON contains no voice entry (S7) |
| **C3** | T0 keys + regenerated proto | `bunx tsc --noEmit` passes; generated only from `state-keys.ts` |
| **C4** | T2 capability detection | `capability.test.ts` green |
| **C5** | T3 helper (build recipe + artifact) | `--probe`, `--list-devices`, 3 s capture smoke on Windows |
| **C6** | T4 providers + coordinator + locator | provider/coordinator suites green |
| **C7** | T6 PCM / resample / silence / buffer | unit suites green; 0 files on disk |
| **C8** | T7 frame transport | reassembly test green |
| **C9** | T8 cancel / cleanup / `tearDown()` | 0 orphans after cancel and after window close |
| **C10** | T5 proto + T5b handlers | proto guard green; `getVoiceStatus` spawn count 0 |
| **C11** | T9 enablement gate flipped after T1+C2 | unsupported environments report a reason |
| **C12** | `bun run lint`, `knip`, notices, helper SHA-256 recorded | all local gates green |
| **C13** | **Local phase completion report** written | §9 checklist complete, §9.7 measurements recorded |

### 10.2 Local verification gate

The command set run at every checkpoint:

```
bun run build:sdk
cd apps/vscode
bunx tsc --noEmit
bun run test:vitest
bun run test:unit
bun run lint
```

Plus, where the checkpoint touches capture: the S1–S7 smoke matrix (§6.4) on the Windows reference host.

### 10.3 Local test evidence

For every gate, record **in the repository as text** (e.g. under `apps/vscode/src/core/voice/__tests__/` as fixtures, or in the completion report itself):

- the command run and its exit code,
- the test names and pass/fail counts,
- for T1: the recorder JSON excerpt (or its absence) proving no voice entry,
- for capture: file-count before/after and the process table after cancel/close,
- the helper artifact SHA-256.

Evidence must be **output from an actual local run**. A harness result, an `INFERRED` statement or a plan is never recorded as evidence.

### 10.4 Local phase completion report

At C13 an F1 completion report covers:

1. What was built (task by task, with file paths).
2. Every §9 acceptance criterion, marked met / not met, with the evidence pointer.
3. Every §9.7 measurement, with method and observed value.
4. Every remaining `NOT TESTED` item, restated — **never silently upgraded to PASS**.
5. Any known gap, with the phase that owns it.

### 10.5 Things this plan does not contain, by design

- No commit messages, no PR titles, no branch names.
- No push, deploy or publish instructions.
- No release or marketplace steps.
- **VSIX packaging and installation is F5 work only, for local testing only.** F1 does not package anything.

---


## 11. Known blockers and open items

| ID | Item | Status | Blocks |
| --- | --- | --- | --- |
| **B1** | Webview microphone permission | **CLOSED — fails (measured)** | Nothing; architecture moved to native capture |
| **B1′** | Native OS capture | **CLOSED — works (Windows, measured)** | Nothing |
| **R-2** | Recorder persists audio | **PARTIALLY CLOSED — audit done, product fix outstanding** | **F1 task T1 must complete first** |
| **G5** | Windows helper build | **NOT STARTED** | The whole F1 capture path (T3) |
| **G7** | User approval to start F1 | **PENDING** | F1 beginning at all |
| B5 | Marketplace size/signing | **OPEN** | **F5** packaging (F0 never attempted it) |
| B2 / B2′ | Whisper binary + unreliable upstream checksum | **Moved to F2** | F2 (§11) |
| G6 | Mirror location for pinned artifacts | **Moved to F2** | F2 (§11) |
| B4 | Turkish / German accuracy | **OPEN — NOT MEASURED / BLOCKED** | Any accuracy claim (F2/F5) |
| R-22 | macOS TCC for a nested helper | **NOT TESTED** | Any macOS claim (later phase) |
| R-23 | Linux backends | **NOT TESTED** | Any Linux claim (later phase) |
| Q13 | Windows microphone denial path | **NOT TESTED** | Robustness (later phase) |
| Q14 / R-25 | Device hot-plug / default change | **NOT TESTED** | Robustness (later phase + F5) |
| Q15 | Multi-device selection end to end | **BLOCKED** — one active input on the test host | Selection verification (later phase) |

---

## 12. F2 hand-off — retained F0 findings

F1 stops at the utterance boundary. The following F0 findings are **not** dropped; they become F2 requirements and must not be softened when F2 is planned.

### 12.1 Whisper binary provenance (F2 requirement)

F0 measured that the upstream artifact cannot be trusted as published (`VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §4):

- `v1.9.4` and `v1.9.5` report `"assets": []` — no binaries at all.
- The **nightly pre-release `b5454`** does have assets, but the GitHub API's `size`/`digest` for `whisper-bin-x64.zip` **do not match the file actually served** (API `5 523 979` / `b6cb078e…` vs. actual `8 928 640` / `6ba69e34…`).

Therefore, for F2:

- **The upstream nightly binary must NOT be treated as an immutable or trusted release source.** A nightly tag can be replaced under us.
- **Bytos must pin a fixed version of the binary it uses and verify it by SHA-256**, computed from the exact bytes Bytos ships against.
- **Model files must also be verified by checksum**, pinned by Bytos — not by upstream metadata.
- **Model download requires explicit user consent**, with size disclosed before the download starts.
- **Model and binary sizes, resource use (peak RSS, CPU) and licence terms are evaluated in F2**, including artefact size in any packaged form (B5).

### 12.2 Language claims (F2/F5 requirement)

- **Turkish and German accuracy were not measured.** Turkish produced output (the pipeline works) but its accuracy is **NOT MEASURED**; German is **BLOCKED** because no German TTS voice was installed, and an en-US voice reading German text is a method failure, not a result.
- **No accuracy guarantee may be published for Turkish or German.**
- **Human-recorded speech corpora remain a required future verification step** before any accuracy claim, including English beyond the TTS lower-bound figures (`base` 0 % WER, `tiny` 10.7 % WER on TTS).

---
## 13. Cross-phase work breakdown (preserved from Revision 2)

Revision 2 of this plan carried a 12-step sequence. Six of those steps are **not F1**; they are retained here so no work is lost and so nobody mistakes them for F1 deliverables.

### 13.1 F1 (this document) — task order

`T0 keys` → **`T1 recorder isolation (first)`** → `T2 capability` → `T3 helper` → `T4 providers` → `T6 pcm/resample/silence/buffer` → `T7 frame transport` → `T8 cancel/cleanup` → `T5 proto` → `T5b handlers` → `T9 enablement gate` → `T10 tests` → `T11 completion report`.

T5/T5b have no audio dependency, but they must land before T9 flips `canCapture` to `true` permanently.

### 13.2 F2 — Whisper Integration

| Step | Content (carried over from Revision 2) |
| --- | --- |
| F2-a | `RecognitionEngine` adapter interface (TD-4) |
| F2-b | `whisperArgs.ts` pure arg builder (`-m`, `-f -`, `-l`, `-t`, `-nt`, `-np`; input is exactly `-`; no output-file flags) |
| F2-c | `whisperErrors.ts` exit-code → typed error mapping |
| F2-d | `WhisperCliEngine` — spawn, WAV → stdin, UTF-8 stdout, timeout, abort, registry cleanup, child env without provider keys |
| F2-e | `ModelStore`, `modelCatalog` (Bytos-pinned SHA-256), `download` (`.part` + atomic rename + progress) |
| F2-f | `binaryLocator` for the whisper binary — **distinct from** the F1 capture-helper locator |
| F2-g | `transcribeUtterance` handler — **takes no audio**; it transcribes the host-held utterance |
| F2-h | Language parameters (`auto` + explicit codes) and transcript normalisation |
| F2-i | Whisper integration tests + reproduction of the F0 latency baselines (701 ms `tiny`, 1 493 ms `base`, 302 MB peak RSS) |

### 13.3 F3 — Voice Settings

Voice settings integrated into the existing Settings architecture; language / microphone / model / capture preferences; status and permission indicators; microphone test; persistence; Settings UI tests. (Revision 2's "Step 9 — Settings" belongs here.)

### 13.4 F4 — Composer Integration

Composer mic control; record / transcribe UI states; appending the transcript to the existing draft; user-editable text; existing prompt preserved; **the user presses the existing Send button**; automatic submission hard-blocked (TD-10, TD-11). (Revision 2's "Step 8 — Webview voice UI" and the composer half of "Step 9" belong here.)

### 13.5 F5 — Testing, Packaging & Release

End-to-end tests; platform tests (the §8.1 list); performance and resource tests; privacy checks; **local** VSIX packaging and install; final user verification; final report. This is the **only** phase in which the helper and binary are packaged, and the only phase that runs the cross-platform matrix.

---

## 14. Estimated scope

### 14.1 F1

| Area | New files | Approx. LoC (source, excl. tests) |
| --- | --- | --- |
| Recorder isolation (T1) | 1 | ~60 |
| Capability detection (T2) | 1 | ~90 |
| Native helper (C/C++, T3) | 1 executable + build recipe | ~400–700 (C++) |
| Providers + audio plumbing (T4/T6/T7) | 10 | ~950 |
| `voice.proto` (T5) | 1 | ~90 |
| Controller handlers (T5b) | 7 | ~350 |
| Settings keys (T0) | 0 new files | ~20 |
| F1 tests | 14 | ~1 100 |

The C/C++ helper is the largest single new engineering item and has no precedent in this repository.

### 14.2 F2–F5 (rough, planning only)

| Phase | New files | Approx. LoC (excl. tests) |
| --- | --- | --- |
| F2 Whisper integration | ~9 | ~950 |
| F3 Voice Settings | ~3 | ~450 |
| F4 Composer integration | ~5 | ~420 |
| F5 Testing & packaging | ~4 | ~300 |

These are planning estimates for sizing review, **not** commitments.

---

## 15. Definition of done (F1)

F1 is done when, **on Windows x64 in local VS Code**, the following is demonstrable and recorded as local test evidence:

1. The recorder exclusion filter is in product source, safe by default, and a real capture cycle writes **no audio** into `grpc_recorded_session_*.json`.
2. The host reports accurate capability: supported on local Windows x64; **unavailable with a reason** on remote/WSL/container/web and on macOS/Linux.
3. The helper enumerates real microphone devices with names, ids, states and the default.
4. A capture produces normalised 16 kHz mono PCM16 **in memory**, sealed by silence detection or the duration cap.
5. Cancel, stop and window-close each leave **no orphan process** and **no bytes on disk**.
6. `voice.proto` carries **no audio**; ProtoBus is text/status/error only.
7. **No whisper.cpp, no model download, no Settings UI and no composer UI exists in F1.**

**Out of scope for "done" in F1, explicitly:** transcription of any kind, models, Settings, composer, macOS, Linux, remote/WSL, partial transcripts, packaging, and any Turkish/German accuracy claim.

---

**This plan does not authorise F1 to begin. F1 begins only on explicit user instruction.**

**Note.** `EmptyRequest` comes from `proto/bytos/common.proto`; follow the existing import style used by `ui.proto`. Introduce `EmptyResponse` locally in `voice.proto` only if `common.proto` has no suitable empty message, then regenerate with `bun run protos`.

**Working rule reminder:** NO COMMIT · NO PUSH · NO DEPLOY · NO PUBLIC RELEASE. Every checkpoint above is local and reviewable.


