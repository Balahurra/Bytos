# VOICE-F0 — Technical Decisions

**Feature:** Bytos Voice — local speech-to-text into the VS Code extension chat composer
**Phase:** F0 — decisions recorded, not implemented.
**Date:** 2026-11-07
**Revision:** 2 — revised after measured blocker resolution. See §0 for what changed and why.

Each decision states the **decision**, the **evidence**, the **alternatives rejected**, and the **reversal cost** if it turns out wrong. Decisions that depend on an unresolved blocker are marked and must be re-confirmed when that blocker closes.

---

## 0. Revision 2 — what changed and why

The first pass of this document was written before any measurement. Three of its decisions rested on assumptions that testing disproved. **The original text of each is preserved below, struck through in intent and marked `[SUPERSEDED]`, followed by the revised decision.**

| ID | Revision-1 decision | Revision-2 decision | Why it changed | Evidence |
| --- | --- | --- | --- | --- |
| **TD-2** | Capture in the webview with `getUserMedia` | **Capture in the extension host via a native OS helper** | Webview `getUserMedia` throws `NotAllowedError` in stock VS Code — 3/3 runs | `VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §2 |
| **TD-3** | "Audio never leaves the webview" *and* a WAV in `transcribeUtterance` | **Audio never leaves the host; ProtoBus carries text only** | The original was internally contradictory; capture moved anyway | `VOICE-F0-ARCHITECTURE-RECOMMENDATION.md` §4 |
| **TD-6** | RMS silence detection in the webview | **RMS silence detection in the host** | Follows the buffer, which is now in the host | consequence of TD-2 |

Three decisions were **added**:

| ID | New decision | Why |
| --- | --- | --- |
| **TD-16** | `AudioCaptureProvider` abstraction with OS-specific implementations | The user requires capture-method discovery, selection, and visible status |
| **TD-17** | Exclude `VoiceService` from the gRPC recorder by filter | R-2 confirmed: audio would otherwise be written to a JSON file on disk |
| **TD-18** | F1 scope is **local VS Code only**; remote/WSL/containers report voice unavailable | Native host capture uses the host machine's mic; on remote that is the wrong machine, and the webview fallback is denied |

All other decisions (TD-1, TD-4, TD-5, TD-7, TD-8, TD-9, TD-10, TD-11, TD-12, TD-13, TD-14, TD-15) are **unchanged** and were confirmed by measurement.

---

## Decision index (current)

| ID | Decision | Status | Blocked by |
| --- | --- | --- | --- |
| TD-1 | No Web Speech API; no cloud ASR in this feature | **Active** | — |
| TD-2 | ~~Microphone capture in the webview~~ → **native OS capture in the extension host** | **REVISED** | macOS/Linux untested (F2 gate) |
| TD-3 | ~~Audio never leaves the webview~~ → **audio never leaves the host; ProtoBus is text-only** | **REVISED** | — |
| TD-4 | Recognition engine behind an adapter interface; whisper.cpp is engine #1 | **Active** | — |
| TD-5 | whisper.cpp via CLI subprocess with PCM over stdin | **Active, confirmed** | — |
| TD-6 | ~~Silence detection in the webview~~ → **RMS silence detection in the host** | **REVISED** | — |
| TD-7 | Utterance-based transcription for F1; interim text deferred to F2 | **Active** | — |
| TD-8 | Bundle the binary, download the model on demand with consent | **Active, strengthened** (upstream checksums unreliable) | B5 (packaging, F2) |
| TD-9 | Voice settings live in the existing `state-keys.ts` registry and Settings tab system | **Active** | — |
| TD-10 | Composer integration is append-only draft mutation via `setInputValue` + an ownership range | **Active** | — |
| TD-11 | Recording never submits; only the existing Send path starts the agent | **Active** | — |
| TD-12 | Speech recognition is an independent capability, not wired to LLM provider orchestration | **Active** | — |
| TD-13 | No persistent audio retention; in-memory buffers only; no temp WAV | **Active, proven** | — |
| TD-14 | Engine + helper lifecycle registered in `common.ts:tearDown()` | **Active** | — |
| TD-15 | Voice is feature-flagged and lazily initialised | **Active** | — |
| **TD-16** | **`AudioCaptureProvider` abstraction; OS-specific implementations; single selection resolver** | **NEW** | macOS/Linux untested |
| **TD-17** | **Exclude `VoiceService` (and any `audio` payload) from the gRPC recorder** | **NEW, proven** | — |
| **TD-18** | **F1 = local VS Code only; remote/WSL/containers unavailable** | **NEW** | — |


---

## TD-1 — No Web Speech API; no cloud ASR in this feature

**Decision.** Bytos Voice in the VS Code extension will not use `SpeechRecognition`/`webkitSpeechRecognition`, and will not send audio to any remote service in Phases F1–F5 as specified in this audit.

**Evidence.** The F0 mission states: "Default policy: local processing and no persistent audio retention. Cloud transcription must never be activated without explicit user consent." Web Speech API routes audio to Google's servers by design, so it cannot satisfy that policy. It is also absent from Electron/Chromium builds shipped without Google services, so it would fail at runtime on many VS Code installs.

**Rejected alternatives.**
- *Web Speech API* — cloud by default, unavailable in many Chromium builds.
- *Reuse the desktop app's streaming transcription* (`streaming-transcription.ts`) — cloud (`create_streaming_transcription_session`), different transport.

**Reversal cost.** Low. `SpeechRecognition` is isolated behind the same `RecognitionEngine` interface (TD-4) as whisper, so it could be added later as an opt-in engine without touching the pipeline.

---

## TD-2 — Microphone capture in the webview  `[SUPERSEDED by TD-2R]`

> **SUPERSEDED (Revision 2).** This decision is retained for the record only. It was disproved by measurement: `getUserMedia` inside a real VS Code webview iframe throws `NotAllowedError: Permission denied` on 3/3 runs. The replacement is **TD-2R** immediately after this section. Do not implement the text below.


**Decision.** The microphone is opened **inside the webview** with `navigator.mediaDevices.getUserMedia({ audio })` and rendered to PCM with `AudioContext` + `createMediaStreamSource` + `ScriptProcessorNode(4096, 1, 1)`, resampled to **16 kHz mono**, encoded as **PCM16**.

**Evidence.**
- The exact pattern is already implemented and shipped in this repo for the desktop app: `apps/examples/desktop-app/webview/lib/streaming-transcription.ts:84-121` (graph), `:58-82` (resampler), `:44-56` (PCM16 conversion).
- Nothing in the VS Code webview config blocks it: `enableScripts: true` (`VscodeWebviewProvider.ts:62-66`), and `getUserMedia` is not subject to CSP (`WebviewProvider.ts:119-128`).
- `WebviewOptions` in the VS Code API has no media-permission field, so no host-side permission grant exists to depend on.
- Remote/WSL correctness: the webview runs on the client machine where the microphone is; host-side capture would capture the server's (absent) device (feasibility A.5).

**Rejected alternatives.** Host-side native capture (needs a per-OS native backend — feasibility A.3), `MediaRecorder` (container output, not PCM — feasibility A.2).

**Open question.** Whether the embedded Chromium permits `getUserMedia` in the webview iframe — **blocker B1**. If B1 fails, this decision is reversed to host-side capture, which additionally requires a per-platform native backend and macOS becomes unsupported.

**Reversal cost.** High. An adapter boundary (`AudioCaptureSource`) should be introduced in F1 even though only one implementation exists, so a host-side fallback is a new implementation rather than a refactor.

**Notes on implementation specifics.**

- `ScriptProcessorNode` is deprecated in favour of `AudioWorkletNode`. It is retained here because it is what the in-repo precedent uses and because an `AudioWorklet` requires a separate module URL served under the webview's `localResourceRoots` and CSP `script-src`. **Choose `AudioWorklet` if and only if B1's spike shows module loading works in the webview**; otherwise `ScriptProcessor` with a 4096-frame buffer (≈85 ms at 48 kHz) is acceptable for dictation.
- The resampler must be stateful across buffers (as `createResampler` at `streaming-transcription.ts:58-82` is), otherwise every chunk boundary introduces a click and a drift.

---
## TD-2R — Native OS microphone capture in the extension host  (replaces TD-2)

**Decision.** The microphone is captured **in the extension host**, through a small native helper process that talks to the OS audio API:
- **Windows:** WASAPI (`IMMDeviceEnumerator` + `IAudioClient` + `IAudioCaptureClient`).
- **macOS:** CoreAudio (helper ships its own `NSMicrophoneUsageDescription`).
- **Linux:** PipeWire (via `pipewire-pulse`) → PulseAudio → ALSA, in that order.

The helper emits **PCM16 16 kHz mono** on stdout using length-prefixed frames. The host never asks the webview for audio.

**Evidence.**
- `getUserMedia` in a real VS Code webview iframe: `permissions='denied'`, empty device labels, `NotAllowedError` on 3/3 runs (`VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §2).
- The same host, same session, captured real audio natively: 5 s, 241 440 frames, peak 0.627716 (`§3`).
- Device enumeration with real names/ids/states and a resolvable default (`§3.2`).
- End-to-end capture → 16 kHz WAV → `whisper-cli` → text at 6 s / 30 s / 60 s (`§3.4`).
- No temp files created; `whisper-cli` wrote 0 WAVs (`§3.5`).

**Rejected alternatives.**
- *Webview `getUserMedia`* — measured denied; no extension-controlled permission surface.
- *N-API addon* — per-platform `.node` matrix and host-killing crash mode with no measured benefit; kept as a later option.
- *`ffmpeg` / SoX CLI capture* — requires a binary Bytos does not ship.
- *PortAudio / miniaudio linked in* — adds a per-platform build dependency for behaviour the OS already provides.

**Notes on implementation specifics.**
- The device mixes at **48 kHz stereo float32** on the tested host (measured). The helper (or host) must downmix to mono and resample to 16 kHz; do not rely on the OS to choose the algorithm.
- Device names contain non-ASCII characters (measured: `Kulaklık`, `Karışımı`). The helper **must** emit UTF-8 and the host **must** decode UTF-8 explicitly.
- The helper is spawned with an argv array, no shell, a controlled cwd, and a minimal environment containing **no provider credentials**.

**Reversal cost.** Low for Windows (implemented and measured); **medium** if macOS TCC-for-nested-helper fails, because that would force a different helper packaging model (a real signed `.app` the user installs).

---

## TD-16 — `AudioCaptureProvider` abstraction and a single selection resolver

**Decision.** One interface, OS-specific implementations, and **one** resolver that decides which provider and device are used:

```ts
interface AudioCaptureProvider {
  id: string; platform: NodeJS.Platform; displayName: string;
  isAvailable(): Promise<ProviderAvailability>;   // probes; never throws
  getStatus(): Promise<ProviderStatus>;           // permission + backend state
  enumerateDevices(): Promise<AudioInputDevice[]>;// includes state + isDefault
  startCapture(o: AudioCaptureOptions): Promise<AudioCaptureSession>;
  dispose(): Promise<void>;
}
```

Selection policy (in `AudioCaptureCoordinator`, not in providers):
1. user-pinned method **and** available → use it;
2. user-pinned but unavailable → **explicit error + show alternatives** (never silent switch);
3. no pin → first available in platform order (`wasapi` / `coreaudio` / `pipewire→pulse→alsa`);
4. none available → voice disabled with the collected reasons.

**Evidence.** The user requirement explicitly asks for OS detection, method discovery, device enumeration, user choice, and visible status. Measured WASAPI data proves the provider can supply all of it (`VOICE-F0-NATIVE-AUDIO-CAPTURE-RESEARCH.md` §3).

**Rejected alternatives.** Per-provider self-selection (policy duplicated per OS, untestable); a single hard-coded backend per OS with no user override (contradicts the requirement).

**Reversal cost.** None — it is an internal seam that also makes the resolver unit-testable.

---

## TD-17 — Exclude voice from the gRPC recorder

**Decision.** Register a `GrpcRequestFilter` that excludes `bytos.VoiceService` **and** any request whose message carries an `audio` field, before the first audio-bearing RPC exists.

**Evidence.** Verified from source: `recordRequest` stores `request.message` verbatim (`grpc-recorder.ts:76-100`) and `LogFileHandler.write` serialises it to JSON on disk (`log-file-handler.ts:49-56`). Without a filter, microphone audio would be persisted to `tests/specs/grpc_recorded_session_*.json` whenever the dev-only recorder is enabled. The filter hook already exists (`grpc-recorder.builder.ts:30-33`, checked at `grpc-recorder.ts:77-79`). A 5-case harness passed.

**Rejected alternatives.** Disabling the recorder entirely (removes a debugging tool); scrubbing the payload at write time (does nothing for `pendingRequests` held in memory, and is easy to forget on new paths).

**Reversal cost.** None.

---

## TD-18 — F1 scope: local VS Code only

**Decision.** F1 ships voice for **local** VS Code. On Remote SSH, WSL, Dev Containers and Codespaces the feature reports **voice unavailable with an explicit reason**.

**Evidence.** Native host capture uses the extension host's machine. On a remote target the microphone physically belongs to the client (`VOICE-F0-NATIVE-AUDIO-CAPTURE-RESEARCH.md` §7). The client-side alternative (`getUserMedia` in the webview) is measured denied.

**Rejected alternatives.** Capturing the server's microphone (wrong device, and usually no device at all — would appear to "work" in a container with a dummy device and produce silence); silently disabling the UI with no explanation.

**Reversal cost.** Deferred, not rejected: if a supported client-side capture path ever exists, a `client-capture` provider can be added behind TD-16 without touching the pipeline.

---


## TD-3 — Audio never leaves the webview; only transcripts cross the RPC boundary  `[SUPERSEDED by TD-3R]`

> **SUPERSEDED (Revision 2).** The heading was already false with respect to its own body (which sent a WAV through `transcribeUtterance`), and capture has moved out of the webview entirely. Replacement: **TD-3R** immediately below. Do not implement the text below.


**Decision.** The `MediaStream`, `AudioContext`, PCM buffers, and WAV encoding all live in the webview. The ProtoBus carries **one `bytes` payload per utterance** (the completed 16 kHz mono PCM16 WAV) and **text/status events** back.

**Evidence.**
- Existing transport is JSON-serialised protobuf over `postMessage` (`WebviewMessage.ts:1-17`, `grpc-client-base.ts:20-58`). Sending per-chunk audio would mean thousands of messages.
- Every gRPC response is recorded by `GrpcRecorderBuilder` (`grpc-handler.ts:23-36`) — per-chunk audio would balloon the recorder (finding A3).
- Only **one** utterance-sized buffer ever crosses, at completion, so message volume is bounded by recordings, not by seconds.

**Rationale for sending a WAV rather than raw PCM.** A self-describing container removes ambiguity about sample rate/channel/depth at the boundary, and `whisper-cli` decodes WAV natively (feasibility B.3). Raw PCM would require a parallel metadata contract.

**Rejected alternatives.** Streaming PCM chunk-by-chunk over RPC (message volume, recorder, no benefit given no interim transcription in F1); writing audio to a temp file and passing a path (violates TD-13).

**Reversal cost.** Low. If F2 adds interim text, the change is in *when* `transcribeUtterance` is called, not in the transport.

---
## TD-3R — Audio never leaves the extension host; ProtoBus carries text only  (replaces TD-3)

**Decision.** Audio is captured in the extension host and never enters the webview. The only thing that crosses ProtoBus is **text and status**. Audio reaches the recognition engine as an **in-memory WAV on the child's stdin**.

**Evidence.** Measured: capture → PCM in memory → 16 kHz WAV → `whisper-cli` stdin, with the temp directory file count unchanged (453 → 453) and `whisper-cli` creating 0 WAV files (`VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §3.4–3.5). `whisper-cli` reads stdin to EOF (`examples/common-whisper.cpp`).

**The ten transport questions, answered:**

| # | Question | Answer |
| --- | --- | --- |
| 1 | Which process captures the mic? | The extension host, via a native helper child process. |
| 2 | Which process does audio move to? | None. It stays in the host; the helper hands PCM over stdout. |
| 3 | Will WAV cross ProtoBus? | No. ProtoBus carries text/status only. |
| 4 | What carries audio to Whisper? | Helper stdout → host buffer → `whisper-cli` stdin. |
| 5 | How is the buffer serialised? | A WAV RIFF byte stream for the engine hop; never protobuf. |
| 6 | Limits / backpressure? | Utterance duration cap; bounded ring buffer; the helper blocks on its stdout write if the consumer falls behind. |
| 7 | Cancellation / buffer cleanup? | Kill helper / abort engine, drop every chunk reference, zero the buffer, transition to `idle`. |
| 8 | Recorder exclusion? | TD-17 filter (`bytos.VoiceService` + any `audio` payload). |
| 9 | Logs / telemetry? | Never audio, never transcript; codes/ids/durations only. |
| 10 | Disk-free to stdin? | Yes — measured. |

**Rejected alternatives.** Sending audio through the RPC layer (would require recorder exclusion *and* base64 bloat for no benefit, and would invert the process ownership the requirement asks for); staging a temp WAV for the engine (violates TD-13).

**Reversal cost.** Low.

---



## TD-4 — Recognition engine behind an adapter interface

**Decision.** Define a `RecognitionEngine` interface in the extension host with one implementation per engine. whisper.cpp is engine #1. No caller ever imports a whisper-specific type.

```
interface RecognitionEngine {
  readonly id: "whisper-cli" | ...
  init(opts: EngineInitOptions): Promise<EngineStatus>
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>
  dispose(): Promise<void>
}
```

**Evidence.** The failure modes of a CLI engine (spawn errors, missing model, timeouts, exit codes) must not leak into the composer or the settings UI. An interface also makes the engine testable with a fake (`src/test/vscode-vitest-stub.ts`-style doubles already exist).

**Rejected alternatives.** Calling `child_process` directly from the RPC handler — untestable and unrecoverable.

**Reversal cost.** None; it is an internal seam.

---

## TD-5 — whisper.cpp via CLI subprocess with PCM over stdin

**Decision.** Phase F1 uses a bundled `whisper-cli` binary spawned per utterance, fed a WAV via **stdin** (`-` as the input path), with text captured from **stdout**.

**Evidence.**
- `whisper-cli` accepts `-` as the input file and reads stdin to EOF, then decodes from memory (`examples/cli/cli.cpp`; `examples/common-whisper.cpp` `read_audio_data`).
- It converts/resamples to f32 mono 16 kHz internally via `miniaudio` (`common-whisper.cpp`), so feeding 16 kHz mono PCM16 WAV is the well-trodden path.
- Flags needed: `-m <model>`, `-f -`, `-l <lang>|auto`, `-t <threads>`, `-nt` (no timestamps), `-np` (no prints), `--output-txt` or stdout. `main()` sets `SetConsoleOutputCP(CP_UTF8)` on Windows so UTF-8 text survives.
- No official Node native addon exists (`bindings/javascript/README.md` is a WASM binding), so the native path would be Bytos-authored.
- Crash containment: a CLI crash does not take down the extension host, unlike a `.node` crash.
- Packaging: the existing extension already knows how to locate an unpacked binary next to the extension (`extension.ts:699-705`), even though it has never shipped one.

**Rejected alternatives.** Native N-API addon (packaging/ABI burden — TD-5 alternative B-ii), `whisper-stream` (no pipe contract), `whisper-server` (long-lived socket for a single-user tool), WASM (perf).

**Open questions — B2 and B3 are now RESOLVED by measurement.** See §TD-5R below. `/dev/stdin` is not used; `-` is.

**Reversal cost.** Medium. If B3 fails, the adapter swaps its internals to a resident worker; the RPC contract and UI are unaffected.

**Implementation constraints (must be honoured).**
- **Never** `shell: true` — argv must be an array so paths with spaces/Unicode are safe.
- Explicit UTF-8 decoding of stdout buffers; never rely on the platform default encoding.
- Hard timeout per utterance; kill the child and surface a typed error.
- Read stderr only for diagnostics; never parse it for results.
- Exit code must be checked: whisper uses distinct codes for bad args/missing file/missing model (`examples/cli/cli.cpp` returns 1/2/3).


---
## TD-5R — whisper.cpp CLI: confirmed and quantified (extends TD-5)

**Decision unchanged.** TD-5 stands: bundle the `whisper-cli` binary and feed an in-memory 16 kHz mono PCM16 WAV on **stdin**, reading text from **stdout**.

**What measurement added:**

| Question | Measured answer |
| --- | --- |
| Does a usable Windows x64 binary exist? | **Yes** — `whisper-bin-x64.zip` from nightly `b5454`; `whisper-cli.exe` 479,744 B; `--help` exits 0 |
| Can upstream checksums be trusted? | **No** — published `size`/`digest` did not match the served file (8,928,640 actual vs 5,523,979 reported). **Bytos must pin its own SHA-256.** |
| Does `-f -` (stdin) work? | **Yes** — capture → WAV → stdin → text, exit 0 |
| Latency, `tiny`, 3.5 s audio | **701 ms** mean |
| Latency, `base`, 3.5 s audio | **1 493 ms** mean |
| Effect of `-l auto` vs explicit | `auto` 1 485/1 468 ms; `tr` 1 089/1 125 ms; `en` 939/927 ms — **explicit is ~30 % faster** |
| Duration scaling (`base`) | 5 s→1 978 ms, 15 s→2 329 ms, 30 s→4 331 ms, 60 s→3 659 ms |
| Cold-start penalty | ≈ +200 ms (page cache), `tiny` 1 699 ms cold vs ~1 470 ms warm |
| Peak memory (`base`) | **302 MB** working set |
| Cancellation | killing mid-run leaves **0** orphans |
| Model sizes verified | `tiny` 77,691,713 B (74.1 MiB), `base` 147,951,465 B (141.1 MiB) — match documented 75/142 MiB |
| Accuracy, English, `tiny` | mean WER 10.7 %, CER 5.5 % (TTS corpus, lower bound) |
| Accuracy, English, `base` | mean WER 0.0 %, CER 0.0 % (same corpus) |

**Consequence for TD-7 (interim text).** Because a forced language is materially faster than `auto`, the "Automatic language detection" default should be reconsidered for latency-sensitive users: an explicit language is both faster and (per `en` vs `ja` on Turkish audio) more predictable. This does not change TD-7, but it should be surfaced in Settings.

**Consequence for the resident-worker escalation.** At 1.5 s warm for `base`, a resident worker is **not required** for F1. It remains the documented escalation path if real-world use finds 1.5 s unacceptable.

---



## TD-6 — Silence detection in the webview, RMS-based, for F1  `[SUPERSEDED by TD-6R]`

> **SUPERSEDED (Revision 2).** The detector follows the audio buffer, and the buffer is no longer in the webview. Replacement: **TD-6R** immediately below. The *technique* (RMS energy gate, not silero VAD) is unchanged and still correct; only its **location** moved.


**Decision.** F1 detects end-of-speech in the webview with a simple energy gate over the PCM buffer (mean absolute amplitude over a sliding window, with a configurable silence duration). whisper's silero VAD is **not** used in F1.

**Evidence.**
- Silero VAD is a **second model file** (`--vad-model`, e.g. `ggml-silero-v6.2.0.bin`) that must be downloaded, checksummed, and loaded per invocation (whisper README VAD section; `examples/cli/cli.cpp` VAD parameter block). That doubles the model-distribution problem for a marginal gain.
- whisper's own `--vad-min-silence-duration-ms` default is 100 ms and `--vad-speech-pad-ms` 30 ms (`examples/cli/cli.cpp`), i.e. upstream itself treats VAD as a coarse segmentation tool.
- The webview already has the samples; an energy gate is O(n) and free.
- `common.cpp` ships an equivalent energy heuristic for its demos (`vad_simple`, using a high-pass filter plus `energy_last > vad_thold*energy_all`), confirming the technique is adequate for segmentation.

**Rejected alternatives.** Silero VAD in F1 (extra model), no silence detection at all (user must always press Stop — worse UX and worse for the "maximum recording duration" requirement).

**Reversal cost.** Low. VAD is a strategy inside `SilenceDetector`; swapping in silero later is an engine-level change.

**Threshold guidance.** Ship defaults (e.g. silence timeout 1200 ms, minimum utterance 300 ms, RMS floor adaptive over the first 300 ms of noise) and expose them in Settings. Every default is **[PENDING VALIDATION]** against real microphones; nothing here is a measured value.

---
## TD-6R — Silence detection in the extension host, RMS-based  (replaces TD-6)

**Decision.** End-of-speech is detected **in the extension host** over the PCM stream arriving from the helper, using a mean-absolute-amplitude gate over a sliding window with a configurable silence duration. Silero VAD is **not** used in F1.

**Evidence.** Measured capture gives a clean window to compute energy over (`VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §3.3: peak 0.627716, RMS 0.014780 in a 5 s window, 0 silent blocks flagged by WASAPI in a real capture). Silero VAD is a second model file that would have to be downloaded, checksummed, and loaded per invocation — measured model load is a significant share of the 1.5 s latency (`§5.1`), so adding a second model is a real cost for marginal gain.

**Rejected alternatives.** Silero VAD in F1 (second model, extra latency); no silence detection (forces the user to always press Stop and defeats the max-duration requirement).

**Reversal cost.** Low — it is a strategy behind a `SilenceDetector` interface; silero can be added later.

**Threshold defaults (F1 starting points, NOT measured values):** silence timeout 1200 ms, minimum utterance 300 ms, adaptive RMS floor over the first ~300 ms. These must be validated against real microphones in F1.

---



## TD-7 — Utterance-based transcription for F1; interim text deferred

**Decision.** F1 produces **final transcripts only**. While recording, the composer shows a recording indicator, not speculative text. Interim (partial) transcripts are an F2 concern.

**Evidence.**
- `whisper-cli` cannot emit partial results for an unfinished stream (feasibility B.5).
- Any interim text would require re-transcribing the accumulated buffer on a timer, multiplying CPU by roughly `duration / interval`, and would produce text that is then *replaced* — which conflicts with TD-10's append-only ownership model unless the range is replaced wholesale.
- The desktop app's prior art shows the cost of the alternative: it maintains a "live transcript range" with a `generation` guard specifically to avoid applying stale offsets (`chat-input-bar.tsx:749-753`).

**Rejected alternatives.** Timer-driven re-transcription in F1 (CPU, complexity, contradicts B3 measurement plan).

**Reversal cost.** Medium. F2 must add a replaceable draft range (see TD-10's `VoiceOwnedRange`) — designing that range *now* keeps the door open.

---

## TD-8 — Bundle the binary, download the model on demand with consent

**Decision.** The platform binary ships in the VSIX (or, if blocked, is downloaded on first use with signature verification). Models are **never** bundled; they are downloaded to `globalStorageUri.fsPath/voice/models/` after an explicit user action that shows the size, and are SHA-256 verified before use.

**Evidence.** Feasibility Part D: model sizes (75 MiB–2.9 GiB) versus a 12.2 MB VSIX; multilingual requirement eliminates `tiny`/`base`/`small`/`medium` `.en` variants; `globalStorageUri` is already exposed to host code (`extension.ts:641-651`); `download-ripgrep.mjs` is the existing precedent for platform-specific binary acquisition.

**Rejected alternatives.** Bundle everything (size), download everything (worse first-run), WASM model in webview (perf, size).

**Open question.** B5 — Marketplace size/signing constraints for a ~10–40 MB binary. **Strengthened by measurement:** the upstream `whisper-bin-x64.zip` asset's published `size`/`digest` did **not** match the served bytes, so the model/binary provenance chain cannot rely on upstream metadata at all. Bytos must (a) pin its own SHA-256 for every artifact it accepts and (b) **mirror** the exact verified bytes it ships against, because a nightly tag can change underneath.

**Reversal cost.** Low. The `ModelStore` is an internal component; switching between bundled and downloaded model sources is one configuration change.

---

## TD-9 — Voice settings live in the existing settings architecture

**Decision.** Voice settings are ordinary entries in `apps/vscode/src/shared/storage/state-keys.ts` (`USER_SETTINGS_FIELDS`), surfaced as a new `"voice"` tab in `SettingsView.tsx` and a new `VoiceSettingsSection`. No parallel settings store, no separate JSON file, no `vscode.workspace.getConfiguration` contribution.

**Evidence.**
- `state-keys.ts:23-30` declares itself the "SINGLE SOURCE OF TRUTH FOR STORAGE KEYS" and says the proto is regenerated from it.
- The tab system requires four coordinated edits: `SettingsTabID` (`SettingsView.tsx:39`), `SETTINGS_TABS` (`:49-103`), `TAB_CONTENT_MAP` (`:130-141`), and `SETTINGS_NAVIGATION_TARGETS` (`settingsTargets.ts:4-18`), with the host counterpart `scrollToSettings.ts:10-15`.
- `updateSettings.ts:23-120` shows the registration pattern for a new field: one `if (request.X !== undefined)` branch.
- `package.json:343-346` contributes an empty `configuration.properties` object — VS Code-native settings are not the mechanism this product uses.

**Rejected alternatives.** `contributes.configuration` (would create a second settings surface and a second read path); a voice-specific JSON file (duplicates `StateManager`).

**Reversal cost.** Low for adding fields; high for moving the whole settings surface later.

**SecretStorage.** Not required in F1 (local engine, no credentials). Reserved for future cloud providers via the existing `SECRETS_KEYS` list (`state-keys.ts:320-369`) and `VscodeSecretStorage` (`vscode-secret-storage.ts:15-90`) — no new secret store is created.


---

## TD-10 — Composer integration: append-only draft mutation with an owned range

**Decision.** Transcribed text is inserted into the composer draft **through `setInputValue`** (the revision-bumping setter at `useChatState.ts:35-38`), at the caret if the caret is in our owned range, otherwise **appended** after existing content. Existing text is never replaced or trimmed. The inserted region is tracked as `VoiceOwnedRange { start, end, generation }` so later stages (F2 interim text) can replace *only* that region.

**Evidence.**
- `useChatState.ts:13-20` — every write bumps `revision`; `:53-62` — `consumeDraftSnapshot` clears only if no mutation crossed the await; `useMessageHandlers.ts:104-108` — submission reads a snapshot. Any insertion bypassing `setInputValue` is silently lost or triggers a false "draft changed" outcome.
- `subscribeToAddToInput.ts:40-59` + `ChatTextArea.tsx:786-792` (`pendingInsertions`) is the existing "insert text without submitting" mechanism — follow that shape rather than inventing a second one.
- The desktop app's `generation` guard (`chat-input-bar.tsx:749-753`) is prior art for refusing stale range applications.

**Concrete rules.**

1. Never `setInputValue("")` or overwrite; always compute `next = insert(existing, at, text)`.
2. If the user typed while recording, the insertion point is the **current caret at completion time**, not the caret at recording start.
3. If the draft was submitted (revision reset) while recording, the transcript lands in the fresh draft rather than resurrecting the old one.
4. Never touch quotes, images, or files.
5. Never call `handleSendMessage`, `newTask`, or `askResponse`.

**Rejected alternatives.** A parallel "voice buffer" invisible to the submission machinery (would be lost); directly setting the `<textarea>` value (bypasses React state).

**Reversal cost.** Low.

---

## TD-11 — Recording never submits; only Send starts the agent

**Decision.** No voice code path may invoke `TaskServiceClient.newTask` or `askResponse`. The only agent trigger remains `messageHandlers.handleSendMessage(...)` bound at `InputSection.tsx:105` and the Enter key at `ChatTextArea.tsx:666-677`.

**Evidence.** `useMessageHandlers.ts:102-330` is the sole prompt-submission implementation; `newTask` at `:302`/`:555`, `askResponse` at `:222`/`:251`/`:505`/`:524`. No other path exists from the webview to the runtime.

**Enforcement.** A unit test asserts a full record→transcribe→insert cycle makes zero `TaskServiceClient` calls; a second asserts that cancelling a recording during an active task calls neither `cancelTask` (`:582`) nor `askResponse`.

**Reversal cost.** Not applicable — a product requirement, not a preference.

---

## TD-12 — Speech recognition is an independent capability

**Decision.** The recognition path has **no dependency** on `@bytos/llms`, the provider registry, `ProviderSettingsManager`, model catalogs, or any LLM provider credential. It creates no agent, tool, subagent, or chat message. It is a text producer, like a clipboard paste.

**Evidence.** The mission states: "Do not introduce a second AI agent or connect speech recognition to the existing LLM provider orchestration. Speech recognition must remain an independent capability." The desktop voice path *does* go through the provider catalog (`sidecar/ARCHITECTURE.md:180-189`) — precisely what must **not** be replicated here.

**Consequences.**
- No `VoiceService` RPC may accept or return an API key.
- The whisper model is not a "model" in the `@bytos/llms` catalog sense and must not appear in model pickers.
- Settings copy must not suggest that voice uses the chat model.

**Reversal cost.** Not applicable.


---

## TD-13 — No persistent audio retention

**Decision.** Audio exists only as (a) PCM chunks in webview memory during recording and (b) one in-memory WAV blob passed to the host once. **No audio file is written to disk.** If a future requirement forces a file, it must live under `BytosTempManager` and be deleted in a `finally` — and that requirement must be explicitly justified because it weakens the privacy guarantee.

**Evidence.**
- `BytosTempManager` is a generic TTL sweep (50 h, 2 GB) at `BytosTempManager.ts:78-90` — wrong for audio, which would stay readable for up to 50 hours.
- `whisper-cli` reads stdin to EOF (`common-whisper.cpp`), so no file is needed.
- Desktop prior art keeps PCM in memory only (`streaming-transcription.ts:84-121`).

**Secure deletion.** Not applicable while no audio touches disk. If that changes: "secure delete" is best-effort on journaling filesystems and SSD wear levelling; the only reliable control is not writing the file.

**Reversal cost.** Low now, high later (once a file-write path exists, removing it is a user-visible behaviour change).

---

## TD-14 — Lifecycle registered in existing teardown hooks

**Decision.** The host-side engine is a singleton disposed in `apps/vscode/src/common.ts:tearDown()` (`:169-192`), alongside `HookProcessRegistry.terminateAll()` (`:181`). Any spawned child is tracked in a registry analogous to `HookProcessRegistry` so `deactivate()` (`extension.ts:713-725`) kills it. Webview capture stops on unmount **and** on `window` `pagehide`.

**Evidence.** `tearDown()` is the only cross-platform shutdown hook and already terminates child processes. `extension.ts:713-725` runs `tearDown()` first, then flushes secrets, so a process killed in `tearDown()` cannot race a secret flush.

**Rejected alternatives.** Relying on the OS to reap orphans (leaves a whisper process loading a model for minutes after the window closes).

**Reversal cost.** Low.

---

## TD-15 — Feature-flagged and lazily initialised

**Decision.** Voice ships behind a settings switch that defaults to **off**. No binary probe, model stat, or directory scan at activation. Everything initialises on first use (first mic click or first Settings→Voice open).

**Evidence.** Activation is `onStartupFinished` for every window (`package.json:53-56`), and `activate()` already does substantial work (secret hydration, migrations, `initialize()` at `common.ts:34-99`). Adding startup I/O for a feature most users have not enabled contradicts the activation-cost discipline visible at `extension.ts:90` (`performance.now()` timing).

**Concrete rules.** Voice module imports must be inside handlers, not module top-level; `init()` is idempotent and cached.

**Reversal cost.** Low.


---

## 6. Proposed audio pipeline and event contracts

This section defines the contract F1 must implement. It is a **proposal**, not existing code.

### 6.1 Pipeline

```
MICROPHONE
   │  MediaStream (webview)
   ▼
AUDIO CAPTURE            AudioContext → ScriptProcessor(4096,1,1) → Float32 frames
   ▼
RESAMPLE + PCM           stateful linear resampler → 16 kHz mono → PCM16 chunks
   ▼
AUDIO BUFFER             ring buffer in webview memory; duration counter
   ▼
SILENCE DETECTOR         RMS over sliding window (TD-6) → speech / silence events
   ▼
UTTERANCE SEALER         silence timeout | max duration | explicit stop
   │  WAV (16 kHz mono PCM16) in memory
   ▼
RECOGNITION ADAPTER      VoiceService.transcribeUtterance (host RPC)
   ▼
WHISPER ENGINE           child_process.spawn(whisper-cli, [...], stdin=WAV) → stdout text
   ▼
TRANSCRIPT MANAGER       normalize (trim, collapse whitespace), dedupe, order
   ▼
COMPOSER                 setInputValue(insert(existing, at, text))  (TD-10)
```

### 6.2 Lifecycle states (webview capture session)

```
idle ──start()──▶ requestingPermission ──granted──▶ recording
                        │                              │
                     denied                    ┌───────┴────────┐
                        ▼                      │ seal: silence |│max|stop
                     error ◀──────────────────┘                │
                                                               ▼
                                                          transcribing
                                                     ┌─────────┼─────────┐
                                                     ▼         ▼         ▼
                                                  completed  cancelled  failed
                                                     └─────────┴─────────┘
                                                               ▼
                                                              idle
```

| From | Event | To | Notes |
| --- | --- | --- | --- |
| `idle` | `VOICE_START` | `requestingPermission` | Idempotent: a second start while non-idle is ignored |
| `requestingPermission` | granted + graph built | `recording` | `context.resume()` must resolve first (a suspended context yields silence) |
| `requestingPermission` | `NotAllowedError` / `NotFoundError` | `error` | Distinct message per error name |
| `recording` | `VOICE_STOP` | `transcribing` | Explicit stop seals immediately |
| `recording` | silence > `silenceTimeoutMs` after speech | `transcribing` | Auto-seal |
| `recording` | duration ≥ `maxDurationMs` | `transcribing` | Hard cap (also satisfies "maximum recording duration") |
| `recording` | `VOICE_CANCEL` | `idle` | **Discards buffer; no transcription; no composer change; no agent call** |
| `recording` | track `ended`/`error` | `error` | Device unplugged |
| `transcribing` | result (text may be empty) | `completed` → `idle` | Empty text ⇒ no insertion, no error |
| `transcribing` | `VOICE_CANCEL` | `cancelled` → `idle` | Cancels in-flight RPC by `requestId` |
| `transcribing` | engine error/timeout | `failed` → `idle` | Typed error shown once |
| any | `dispose()` / unmount / `pagehide` | `idle` | Stops tracks, closes context, releases nodes |


### 6.3 Event contracts

> **REVISED (Revision 3) — the RPC below previously carried `audio: bytes`, which contradicted TD-3R.** Audio never crosses ProtoBus (TD-3R). Capture control is a separate, audio-free RPC family owned by **F1**; transcription (**F2**) consumes the host-held utterance and therefore needs **no audio in its request**. The superseded shape is retained in §TD-3 for history only.

**Unary RPCs (webview → host) — capture control (F1, audio-free).**

```
StartCaptureRequest  { microphoneId?: string; captureMethod?: "auto" | "wasapi";
                       silenceTimeoutMs?: number; maxDurationMs?: number }
                     → StartCaptureResponse { sessionId, sampleRate, channels, backend }
StopCaptureRequest   { sessionId } → {}
CancelCaptureRequest { sessionId } → {}
ListCaptureDevices   {}            → { devices: CaptureDeviceInfo[] }
GetVoiceStatus       {}            → { enabled, canCapture, backend, unavailableReason,
                                       permissionGranted, deviceCount, selectedMicrophoneId,
                                       captureState, framesReceived, bytesReceived, lastErrorCode }
```

**Transcription (F2 — still audio-free).** The host already holds the utterance in memory, so the request names the utterance and the recognition parameters; it never carries samples.

```
TranscribeUtteranceRequest {
  utteranceId: string;        // identifies the in-memory buffer held by the host
  language: string;           // "auto" | "en" | "de" | "tr" | ...
  modelId: string;            // must resolve to an installed model (F2)
}

TranscribeUtteranceResponse {
  requestId: string;
  text: string;               // may be ""
  language?: string;          // detected language when language === "auto"
  durationMs: number;         // measured on host
  engine: string;             // "whisper-cli"
  modelId: string;
  warnings: string[];         // e.g. suspected language mismatch
}
```

**Model RPCs (F2).**

```
InstallModelRequest  { modelId, consent: true } → InstalledModel  (+ progress via events)
RemoveModelRequest   { modelId }                → {}
```

**Streaming events (host → webview).** Modelled on `subscribeToAddToInput.ts:16-59` — frames are state deltas, never raw audio.

```
VoiceEvent {
  kind: "status" | "modelDownloadProgress" | "transcript" | "error";
  sessionId: string;
  // "transcript":            { text, isFinal: true, revision }
  // "modelDownloadProgress": { modelId, receivedBytes, totalBytes, phase }
  // "error":                 { code, message }   // never includes audio
}
```

**Why deltas and not audio.** TD-3R: **no** RPC carries audio. The only audio in the system lives in host memory between capture and the recognition engine's stdin. Event frames are state deltas (status, progress, transcript text, error code) and therefore never serialise samples.

### 6.4 Duplicate-text prevention

Three independent mechanisms, each covering a different failure:

1. **Seal-once.** The sealer transitions state and clears the ring buffer atomically; a second seal is a no-op.
2. **Request identity.** The host echoes `requestId`; the webview drops responses that are not the current session's.
3. **Insert-once.** The transcript manager marks `{sessionId, revision}` consumed before mutating the draft; a duplicate frame is discarded.

Silence-seal and user-stop can race; both funnel through one `seal()` guarded by the state machine, so exactly one `transcribeUtterance` is ever issued.

### 6.5 Partial transcript reconciliation (F2 scope, designed now)

Interim frames (F2) carry `revision`; a frame applies only if `revision` matches the owned range's current revision **and** the user's caret is outside the range; otherwise the range is dropped, never silently re-applied. This generalises the desktop app's `generation` guard (`chat-input-bar.tsx:749-753`).

F1 ships the range as a **zero-width marker at the insertion point**, so no reconciliation logic is needed yet but the data model exists.

### 6.6 Long-running sessions

| Concern | Handling |
| --- | --- |
| Unbounded buffer growth | Hard cap `maxDurationMs` (proposed default 120 s, **[PENDING VALIDATION]**); seal at the cap rather than truncate mid-word |
| Memory | 16 kHz × 2 bytes = 32 KB/s ⇒ 120 s ≈ 3.8 MB. Trivial; no streaming-to-disk needed |
| Multiple utterances | Sequential; `VOICE_START` while `transcribing` is rejected in F1 with a toast |
| Model drift | Engine `init()` is idempotent and cached; a deleted model surfaces as a typed error |

### 6.7 Cancellation and error recovery

- **Cancel during recording** → stop tracks, discard buffer, no RPC.
- **Cancel during transcription** → host aborts the child and answers `cancelled`, which the webview treats as a no-op.
- **Engine timeout** → kill child, `failed`; composer untouched.
- **Model missing** → `failed` with an actionable message pointing at Settings→Voice.
- **Device lost** (`track.onended`) → seal or discard per setting; never leave the machine in `recording`.
- **Repeated failures** → surface once per session; do not auto-disable the feature.

### 6.8 Audio format constants

| Constant | Value | Rationale |
| --- | --- | --- |
| Sample rate | **16 000 Hz** | Whisper's native rate (`WHISPER_SAMPLE_RATE` in `common-whisper.cpp`) |
| Channels | **1 (mono)** | Whisper is mono; stereo would be downmixed anyway |
| Sample format | **PCM16 little-endian** | Half the size of f32; whisper converts internally |
| Container sent to host | **WAV (RIFF)** | Self-describing; `whisper-cli` decodes natively |
| Capture buffer | **4096 frames** | Matches the in-repo precedent; ≈85 ms @48 kHz |
| Bytes per second | 32 000 | 16 000 × 2 |

---

## 7. Requirement → decision cross-reference

| Requirement (F0 mission) | Decision |
| --- | --- |
| Microphone input must not replace existing text | TD-10 rule 1 |
| Existing prompt content preserved | TD-10 rules 1–3 |
| Transcribed text editable | TD-10 (plain draft text, no custom widget) |
| Recording must not auto-submit | TD-11 |
| Only Send initiates the agent | TD-11 |
| Voice cancellation must not trigger execution | TD-11 enforcement test |
| No separate chat/agent pipeline | TD-12 |
| Independent recognition capability | TD-12 |
| Local processing, no persistent audio | TD-1, TD-13 |
| Cloud only with explicit consent | TD-1 (none in F1–F5 scope) |
| Settings inside existing architecture | TD-9 |
| Model selection + installation | TD-8 |
| Language selection + auto detection | TD-5 (`-l auto`) + a dedicated settings key (not `preferredLanguage`, finding A12) |
| Microphone selection + testing | TD-2 (enumerate); mic-test playback needs a `media-src` CSP addition (finding A1) |
| Push-to-talk / recording mode | TD-2 constraints; PTT while the webview is hidden is a documented limitation (feasibility A.3) |
| Silence detection | TD-6 |
| Maximum recording duration | §6.6 |
| SecretStorage for future cloud | TD-9 (reserved, unused in F1) |


---

## 8. Proposed Voice Settings architecture

### 8.1 Placement

New tab `"voice"` alongside the seven existing tabs. All of these are mandatory for parity with existing tabs:

| File | Change |
| --- | --- |
| `webview-ui/src/components/settings/SettingsView.tsx:39` | add `"voice"` to `SettingsTabID` |
| same `:49-103` | add a `SETTINGS_TABS` entry (`name: "Voice"`, icon e.g. `Mic` from lucide) |
| same `:130-141` | add `voice: VoiceSettingsSection` to `TAB_CONTENT_MAP` |
| `webview-ui/src/components/settings/settingsTargets.ts:4-18` | add `voice: { tabId: "voice" }` |
| new `components/settings/sections/VoiceSettingsSection.tsx` | the pane |
| `src/shared/storage/state-keys.ts` `USER_SETTINGS_FIELDS` | the keys |
| `src/core/controller/state/updateSettings.ts` | one branch per key |
| `proto/bytos/state.proto` | regenerated by tooling, never hand-edited |

### 8.2 Settings inventory — implemented vs future

| Setting | Key (proposed) | Type / default | Phase | Status |
| --- | --- | --- | --- | --- |
| Voice enabled/disabled | `voiceEnabled` | `boolean`, `false` | F1 | **Implemented in F1** |
| Recognition engine | `voiceEngine` | enum, single value `"whisper-cli"` in F1 | F1 | Implemented in F1 |
| Model selection | `voiceModelId` | `string \| undefined` | F1 | Implemented in F1 |
| Model installation | — | RPC-driven, not a settings key | F1 | Implemented in F1 (list from `VoiceStatus`) |
| Language selection | `voiceLanguage` | `string`, `"auto"` | F1 | Implemented in F1 |
| Automatic language detection | `voiceLanguage === "auto"` | — | F1 | Implemented in F1 |
| Microphone selection | `voiceMicrophoneId` | `string \| undefined` (undefined = system default) | F1 | Implemented in F1 |
| Microphone testing | — | transient UI action (level meter) | F2 | **Future** — needs `media-src` CSP (finding A1) |
| Recording mode (toggle vs hold) | `voiceRecordingMode` | `"toggle" \| "pushToTalk"`, `"toggle"` | F2 | **Future** |
| Push-to-talk keybinding | `voicePushToTalkKey` | `string \| undefined` | F3 | **Future** — hidden-webview limitation (A.3) |
| Silence detection enabled | `voiceSilenceDetectionEnabled` | `boolean`, `true` | F1 | Implemented in F1 |
| Silence timeout | `voiceSilenceTimeoutMs` | `number`, `1200` | F1 | Implemented in F1 |
| Max recording duration | `voiceMaxDurationMs` | `number`, `120000` | F1 | Implemented in F1 |
| Transcription preferences (lowercase, trim) | `voicePostProcessing` | `{ lowercase: boolean; trim: boolean }`, off | F2 | **Future** |
| Privacy: local-processing notice | — | static copy | F1 | Implemented in F1 (informational) |
| Privacy: cloud consent | `voiceCloudConsent` | `boolean`, `false` | F5+ | **Future — outside F1–F5 scope** |
| Cloud provider credentials | `SECRETS_KEYS` entry | `undefined` | F5+ | **Future — SecretStorage reserved, unused** |

All are ordinary `USER_SETTINGS_FIELDS` entries. Nothing is stored outside `state-keys.ts` (TD-9).

### 8.3 Why not `contributes.configuration`

`apps/vscode/package.json:343-346` contributes an **empty** `configuration.properties` object — the product deliberately keeps settings inside its own `StateManager` store, which is synchronised to `~/.bytos/data`, to the webview, and to remote config. Adding `contributes.configuration` entries would create a second, divergent settings surface and a second read path. Rejected (TD-9).

### 8.4 Host surface for settings

`updateSettings` gains one branch per key, following the existing style at `updateSettings.ts:69-88`:

```ts
if (request.voiceEnabled !== undefined) {
    const previous = controller.stateManager.getGlobalSettingsKey("voiceEnabled")
    controller.stateManager.setGlobalState("voiceEnabled", request.voiceEnabled)
    if (previous !== request.voiceEnabled) { voiceSessionManager.handleEnabledChanged(request.voiceEnabled) }
}
```

Side effects go through one manager so they cannot be duplicated per field.


---

## 9. Measurable acceptance criteria (F1 onward)

**Every number below is a target, not a measurement.** Values marked **[PENDING VALIDATION]** must be replaced with observed data during F1 and recorded in the F1 report. No benchmark result is asserted in F0.

### 9.1 Latency

| Metric | Definition | Target | Status |
| --- | --- | --- | --- |
| Microphone initialisation | `VOICE_START` → `recording` (permission already granted) | ≤ 300 ms | **[PENDING VALIDATION]** |
| First-ever permission grant | `VOICE_START` → `recording` incl. OS prompt | user-bound; instrumented only | **[PENDING VALIDATION]** |
| Recording startup | `AudioContext` + nodes connected, first `onaudioprocess` | ≤ 150 ms | **[PENDING VALIDATION]** |
| Engine warm (model in page cache) | seal → transcript for a 5 s utterance, `base` | ≤ 1.5 s | **[PENDING VALIDATION]** |
| Engine cold | seal → transcript, first call after VS Code start | instrumented; no target until measured | **[PENDING VALIDATION]** |
| Insert into composer | transcript received → text in draft | ≤ 50 ms | **[PENDING VALIDATION]** |

### 9.2 Accuracy

Measured on a fixed, versioned corpus per language; Word Error Rate (WER) and Character Error Rate (CER) reported separately (Turkish needs CER because of agglutination).

| Language | Metric | Target | Status |
| --- | --- | --- | --- |
| English | WER | ≤ 12 % (`small`), ≤ 8 % (`large-v3-turbo-q5_0`) | **[PENDING VALIDATION]** |
| German | WER | ≤ 15 % / ≤ 10 % | **[PENDING VALIDATION]** |
| Turkish | WER / CER | ≤ 25 % WER, ≤ 10 % CER | **[PENDING VALIDATION]** |
| Automatic detection | correctness | ≥ 90 % over 20 mixed utterances | **[PENDING VALIDATION]** |

Corpus, microphone, room, and model must be recorded with every published number.

### 9.3 Resource consumption

| Metric | Target | Status |
| --- | --- | --- |
| Peak RSS of `whisper-cli`, `base` | measured per platform; no target until measured | **[PENDING VALIDATION]** |
| Peak RSS, `small` | idem | **[PENDING VALIDATION]** |
| Extension host RSS delta, idle, voice enabled | ≤ 20 MB | **[PENDING VALIDATION]** |
| Webview RSS delta while recording | ≤ 30 MB | **[PENDING VALIDATION]** |
| CPU while recording (no transcription) | ≤ 5 % of one core | **[PENDING VALIDATION]** |
| CPU while transcribing | bounded by the `-t` thread setting | **[PENDING VALIDATION]** |

### 9.4 Stability

| Metric | Target | Status |
| --- | --- | --- |
| 50 consecutive utterances | RSS growth ≤ 10 % over the run | **[PENDING VALIDATION]** |
| 30-minute session, 100 utterances | no orphan child processes | **[PENDING VALIDATION]** |
| Window close during recording | process exits, no orphan | **must pass** |
| Window close during transcription | child killed, no orphan | **must pass** |

### 9.5 Behavioural acceptance (binary, no measurement)

| Criterion | Test |
| --- | --- |
| Existing draft text preserved | type `"hello "`, record, assert draft starts with `"hello "` |
| Recording never submits | spy on `TaskServiceClient`: zero calls |
| Cancel never submits, never calls `cancelTask`/`askResponse` | spy assertions |
| Transcript editable | after insertion, typing appends normally and Send uses the edited text |
| Duplicate frames never duplicate text | replay same `requestId`; assert single insertion |
| Empty transcript inserts nothing | assert draft unchanged |
| Settings persist across reload | write → reload → read |
| Voice disabled ⇒ no mic button, no engine probe | assert |

### 9.6 Cleanup

| Criterion | Assertion |
| --- | --- |
| No audio file created | temp-dir snapshot before/after |
| Capture nodes released | `context.state === "closed"` after stop |
| Child process reaped | process-list snapshot before/after |

---

## 10. Open technical questions (Revision 2 — most blockers now closed)

| # | Question | Status | Answer / remaining work |
| --- | --- | --- | --- |
| **B1** | Does `getUserMedia` succeed inside a real VS Code webview? | **CLOSED — NO** | Measured `NotAllowedError` ×3; `permissions='denied'`, labels hidden. TD-2 → TD-2R. |
| **B1′** | Does native OS capture work? | **CLOSED — YES (Windows)** | WASAPI capture, real signal, device enumeration, default resolution, all measured. |
| **B2** | Is a whisper.cpp binary obtainable? | **CLOSED with caveat** | Windows x64 from nightly `b5454`; **upstream checksum metadata is wrong**, so Bytos pins its own and must mirror. |
| **B3** | Per-utterance CLI latency? | **CLOSED** | `tiny` 701 ms, `base` 1 493 ms (3.5 s audio); 302 MB peak; explicit language ~30 % faster than `auto`. |
| **B4** | Accuracy on Turkish / English / German? | **PARTIAL** | English measured (`base` 0 % WER, `tiny` 10.7 % on a TTS corpus). **Turkish NOT MEASURED**, **German BLOCKED** (no German TTS voice). |
| **B5** | Marketplace size/signing for a bundled binary? | **OPEN** | F2 gate. Not attempted in F0. |
| **R-2** | Does the recorder persist audio? | **CLOSED — YES, fix required** | `recordRequest` stores `request.message`; log handler writes JSON to disk. Filter proven (5/5). |
| Q6 | Is `AudioWorklet` needed? | **MOOT** | Capture is no longer in the webview. |
| Q7 | macOS Gatekeeper / TCC for a nested helper? | **OPEN — NOT TESTED** | Blocking for macOS. F2 gate. |
| Q8 | Linux glibc / PipeWire / PulseAudio behaviour? | **OPEN — NOT TESTED** | Blocking for Linux. F2 gate. |
| Q9 | `whisper-cli` WAV decode stability across versions? | **OPEN** | Pin an exact build; test upgrade. F1. |
| Q10 | Where does the mic button live? | **OPEN** | `ChatTextArea` or `InputSection`. F1 design review. |
| Q11 | UX when no model is installed? | **OPEN** | Product decision. F1. |
| Q12 | Is `media-src` needed? | **DEFERRED** | Only for the mic-test playback meter, which is F2. |
| **Q13** | Windows privacy-denial error path (`E_ACCESSDENIED`)? | **OPEN — NOT TESTED** | Host had the mic allowed. F2 gate. |
| **Q14** | Device hot-plug / default-change notifications? | **OPEN — NOT TESTED** | Documented API, not exercised. F1 tests. |
| **Q15** | Multi-device selection end to end? | **BLOCKED** | Only one ACTIVE input on the test host. Needs a ≥2-input machine. F1. |
| **Q16** | Helper vs N-API performance? | **NOT TESTED** | Only revisit if 1.5 s proves unacceptable. |



---

## 11. Security and privacy design

### 11.1 Microphone permission handling

| Aspect | Design |
| --- | --- |
| Who prompts | Chromium, on the first `getUserMedia` in the webview; Bytos never proxies the prompt |
| Denial | `NotAllowedError` → state `error` with an actionable message; the mic button stays available so the user can retry after changing OS settings |
| No device | `NotFoundError` → distinct message; the mic button is hidden when `enumerateDevices` reports zero `audioinput` |
| Persistence | The webview origin belongs to the extension host's webview origin; Chromium decides whether to remember the grant. **Bytos must not assume it is remembered** — every `VOICE_START` handles a prompt path |
| Pre-flight | Never call `getUserMedia` on activation or when opening Settings; only on an explicit user gesture (TD-15) |

### 11.2 Audio data lifetime

```
t0  user clicks mic         → MediaStream acquired; PCM accumulating in memory
t1  seal                    → WAV Blob (webview memory only)
t2  RPC                     → bytes copied into a protobuf message
t3  host spawns whisper     → bytes written to the child's stdin
t4  child exits             → host drops the request object
t5  response returned       → webview drops the Blob reference
t6  text inserted           → only text persists (draft, then chat history if sent)
```

Audio is never written to disk (TD-13), never logged, and never included in an error report. The **only** durable artifact is the transcript, which becomes ordinary chat text under existing chat-history rules.

### 11.3 Temporary storage

None for audio. If a future phase must stage audio it must use `BytosTempManager` (`BytosTempManager.ts:72-76`) and delete before returning, and that must be reviewed as a privacy change.

### 11.4 Secure deletion

Not applicable in F1 because nothing is written. Recorded so the decision is explicit: were audio staged, "shredding" is unreliable on journaling/COW filesystems and SSD wear levelling. The correct control is **never writing**.

### 11.5 Cloud upload consent

Out of scope for F1–F5. The gate for any future cloud engine:

1. `voiceCloudConsent === true`, set only by an explicit per-provider user action — never a default, never inherited from another setting.
2. A visible indicator while cloud transcription is active.
3. Credentials in `SecretStorage` (`vscode-secret-storage.ts:15-90`), never in `globalState.json`.
4. Audio sent only to the consented provider, never to Bytos infrastructure.

**No cloud code path will be written in F1.**

### 11.6 API key storage

Voice uses no keys in F1 (TD-12). Existing secret infrastructure is untouched: `SECRETS_KEYS` (`state-keys.ts:320-369`) and `VscodeSecretStorage` (`vscode-secret-storage.ts:15-90`).

### 11.7 Native process permissions

| Concern | Design |
| --- | --- |
| Provenance | Bundled in the signed VSIX, or downloaded with signature verification (TD-8) |
| Invocation | `spawn(binary, args, { stdio: ["pipe","pipe","pipe"] })`, argv array, **never** `shell: true` |
| Input | Only WAV bytes on stdin; no path-traversal surface |
| Output | stdout parsed as UTF-8; stderr only for diagnostics, truncated, never shown raw |
| Environment | Child inherits a minimal env; **no provider API keys in the child env** (they live in the secret store, not `process.env`) — assert in a test |
| Working directory | A controlled directory, not the user's workspace |
| Model path | Only under `globalStorageUri.fsPath/voice/models` or an explicitly user-imported file |

### 11.8 Lifecycle cleanup

Registered in `common.ts:tearDown()` (TD-14) and `extension.ts:deactivate()`. Webview capture stops on unmount and `pagehide`. **Unexpected termination:** spawn with `detached: false` and track children in a `HookProcessRegistry`-style registry so no orphan survives the host.

### 11.9 Error reporting

| Rule | Detail |
| --- | --- |
| Never include audio | Not even a base64 excerpt |
| Never include the transcript | Transcripts are user content; not attached to `ErrorService.logException` (`services/error/ErrorService.ts:43-48`) properties |
| Allowed properties | error `code`, engine id, model id, duration bucket, platform, extension version |
| Telemetry | If captured at all, a coarse counter (e.g. `voice_transcription_failed`) with no content |

### 11.10 Threat notes

| Threat | Relevance | Mitigation |
| --- | --- | --- |
| Malicious workspace influencing the model path | low | model path never read from workspace config |
| Model file tampering in `globalStorage` | medium | SHA-256 re-verified on load, not only on download |
| Binary replacement | medium | bundled binary lives inside the signed extension directory |
| Prompt-injection via transcript | **not applicable** — text lands in the composer, not the agent; the user still decides to send (TD-11) |
| Accidental capture of a meeting | medium | visible recording indicator, max-duration cap, no background listening |
| Over-broad telemetry | medium | §11.9 |

---

## 12. Decision log summary

| Decision | Status | Reversibility |
| --- | --- | --- |
| TD-1 no Web Speech / no cloud | Firm | Low cost |
| TD-2 webview capture | **Conditional on B1** | High cost |
| TD-3 audio stays in webview | Firm | Low cost |
| TD-4 engine adapter | Firm | None |
| TD-5 CLI + stdin | **Conditional on B2/B3** | Medium cost |
| TD-6R host RMS silence detection | Firm for F1 | Low cost |
| TD-7 utterance-based, no interim | Firm for F1 | Medium cost |
| TD-8 bundle binary, download model | **Conditional on B5** | Low cost |
| TD-9 existing settings registry | Firm | Low cost |
| TD-10 append-only draft range | Firm | Low cost |
| TD-11 never auto-submit | Firm (requirement) | n/a |
| TD-12 independent capability | Firm (requirement) | n/a |
| TD-13 no persistent audio | Firm | High cost |
| TD-14 teardown registration | Firm | Low cost |
| TD-15 flag + lazy init | Firm | Low cost |
| **TD-16 capture provider abstraction** | Firm | None (internal seam) |
| **TD-17 recorder exclusion** | Firm (privacy defect fix) | None |
| **TD-18 local-only F1** | Firm for F1 | Deferred, not rejected |

### Revision-2 supersessions

| Superseded | Replaced by | Reason |
| --- | --- | --- |
| TD-2 (webview capture) | **TD-2R** (native capture) | Measured `NotAllowedError` ×3 |
| TD-3 (audio in webview) | **TD-3R** (audio in host, text-only ProtoBus) | Old text was self-contradictory; capture moved |
| TD-6 (silence detection in webview) | **TD-6R** (silence detection in host) | Follows the buffer |
| TD-5 (whisper CLI) | **TD-5R** (extends, confirms) | B2/B3 measured |

---

**End of Revision 2.** Any statement in Sections 1–12 that still describes webview capture (TD-2), webview-side silence detection (TD-6), or audio crossing ProtoBus (TD-3) is superseded by the `R`-suffixed decisions above. The sections are retained unedited so the change history is auditable.

