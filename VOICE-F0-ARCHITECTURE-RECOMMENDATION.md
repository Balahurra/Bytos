# VOICE-F0 — Architecture Recommendation

**Feature:** Bytos Voice
**Phase:** F0 — audit only. Nothing here is implemented.
**Date:** 2026-11-07
**Supersedes:** TD-2 (webview `getUserMedia`) and the TD-3 wording implying audio stays in the webview — both contradicted by measured evidence.

---

## 1. The recommended architecture in one page

```
┌─────────────────────────── Extension Host (Node) ───────────────────────────┐
│  VoiceService (ProtoBus)                 AudioCaptureCoordinator            │
│   ├─ getVoiceStatus                       ├─ detects OS/arch                 │
│   ├─ enumerateInputDevices                ├─ probes providers (isAvailable)  │
│   ├─ startCapture / stopCapture           ├─ resolves default vs user choice │
│   ├─ transcribeUtterance                  └─ publishes one status model       │
│   └─ subscribeToVoiceEvents                          │                        │
│                                                      ▼                        │
│  AudioCaptureProvider (interface) ──┬── WasapiCaptureProvider   (helper .exe) │
│                                     ├── CoreAudioCaptureProvider(helper)      │
│                                     └── LinuxCaptureProvider (pipewire/pulse) │
│                                                      │ PCM16 16 kHz mono       │
│                                                      ▼                        │
│                                          UtteranceBuffer (memory)             │
│                                                      ▼                        │
│                             RecognitionEngine (interface)                     │
│                                      └─ WhisperCliEngine (stdin WAV → stdout) │
│                                                      │ text                   │
│                                                      ▼                        │
│                                    TranscriptManager (normalise, dedupe)      │
└──────────────────────────────────────────────────────┬──────────────────────┘
                                                       │ TranscriptEvent (text only)
┌──────────────────────────── Webview (React) ─────────▼──────────────────────┐
│  Composer draft  ◄── setInputValue(prev => insert(prev, text))  (TD-10)      │
│  Mic button / recording indicator (never submits)                            │
│  Voice Settings pane (capture method, device, detection status, test)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Audio never enters the webview.** Capture happens in the host through the OS API; only text crosses ProtoBus. This inverts the first audit's design, and it is what the evidence supports.

---

## 2. Native vs webview — the actual difference

| Dimension | Native OS capture (recommended) | Webview `getUserMedia` |
| --- | --- | --- |
| Works in stock VS Code | **yes (measured)** | **no (measured, `NotAllowedError`)** |
| Device names | real names from the OS (measured) | empty — denied here (measured) |
| Device selection | by stable endpoint id (measured) | impossible without a grant |
| Permission model | OS (Windows privacy / macOS TCC / portals) | iframe permissions policy we cannot control |
| Extra dependency | none (OS API) | none |
| Binary cost | small helper per OS | none |
| Crash blast radius | isolated process | n/a |
| Remote-correctness | wrong (host mic) | would be right — but unusable |
| Debuggability | stderr + exit codes | browser console only |

The only advantage webview capture had was remote correctness — moot, because the call is denied. **Native capture wins on every dimension that is actually achievable.**

---

## 3. The four components that make this work

### 3.1 Provider abstraction (`AudioCaptureProvider`)

```ts
export interface AudioCaptureProvider {
  readonly id: string;                       // "wasapi" | "coreaudio" | "pipewire" | "pulse" | "alsa"
  readonly platform: NodeJS.Platform;        // expected platform
  readonly displayName: string;              // "Windows WASAPI"

  isAvailable(): Promise<ProviderAvailability>;      // probes, never throws
  getStatus(): Promise<ProviderStatus>;              // permission + backend state
  enumerateDevices(): Promise<AudioInputDevice[]>;   // includes state + isDefault
  startCapture(opts: AudioCaptureOptions): Promise<AudioCaptureSession>;
  dispose(): Promise<void>;
}
```

Key contracts:
- `isAvailable()` **probes** (spawn the helper with `--probe`, or check the Pulse/PipeWire socket) and returns `{ available, reason }`. It must never throw — unavailability is data, not an exception.
- `enumerateDevices()` returns **unavailable devices too**, with `state: "active" | "disabled" | "notpresent" | "unplugged"`, so Settings can explain *why* a device is missing (mirroring the measured WASAPI states).
- `startCapture()` returns a session with `onData(chunk: Uint8Array)` and `stop()`. **No provider writes audio to disk.**

### 3.2 Selection and fallback (`AudioCaptureCoordinator`)

**One resolver, not per-provider logic.** Deterministic order:

```
1. User pinned a capture method AND its provider isAvailable()  -> use it
2. User pinned, but it is NOT available                         -> explicit error + show the
                                                                   next viable option;
                                                                   do NOT silently switch
3. No pin -> first available provider in platform order:
      win32  : wasapi
      darwin : coreaudio
      linux  : pipewire -> pulse -> alsa
4. Nothing available -> voice disabled, with the collected reasons
```

**Hard rules:**
- A user's explicit manual choice is **never** silently replaced.
- Automatic fallback happens only when the user has **not** pinned a method.
- Every fallback is **reported** to the UI ("Using PulseAudio because PipeWire was not detected").
- No silent switch to a different **input device**. A device that disappears is an error, not an invitation to record something else.

### 3.3 Device selection

- Persist the **endpoint id** (the stable OS string, verified above), not an index.
- Resolve `default` at capture time, so following the system default is a real behaviour rather than a snapshot.
- On a stale id: surface `DEVICE_NOT_FOUND` with a one-click "use system default"; never a silent substitution.
- On hot-unplug mid-recording: seal what exists (or discard, per setting) and move the UI to `error`; never leave the machine in `recording`.

### 3.4 IPC and audio transport

| Hop | Transport | Format | Rationale |
| --- | --- | --- | --- |
| OS → helper | native API | native mix format (measured: 48 kHz stereo f32) | whatever the device gives us |
| helper → host | **stdout, length-prefixed binary frames** | PCM16 16 kHz mono | simple, no disk, no socket |
| host → engine | **child stdin** | WAV (RIFF, 16 kHz mono PCM16) | `whisper-cli` reads stdin to EOF (measured) |
| host → webview | **ProtoBus, text only** | `TranscriptEvent { text, isFinal, revision }` | audio never crosses |

**Why a helper process rather than an N-API addon:**
- matches the existing `HookProcessRegistry` child-process discipline (`common.ts:181`);
- a helper crash cannot take down the extension host;
- the host already resolves unpacked binaries next to the extension (`extension.ts:699-705`);
- N-API adds a per-platform `.node` build matrix and a host-crashing failure mode for no measured F1 benefit.

A length-prefixed frame on stdout (`[4-byte LE length][payload]`) is sufficient; no framing library is needed.


---

## 4. Resolving the TD-3 contradiction

The first audit contained a real contradiction:

- TD-3 said "audio never leaves the webview; only transcripts cross the RPC boundary".
- TD-3's own transport section, and the F1 plan, sent a **WAV through `transcribeUtterance`**.

Both cannot be true. Resolved as follows; this is the wording that applies from now on.

| Question | Answer |
| --- | --- |
| 1. Which process captures the mic? | **The extension host**, via a native helper child process. |
| 2. Which process does audio move to? | **No other process.** It stays in the host; the helper hands PCM to the host over stdout. |
| 3. Will WAV cross ProtoBus? | **No.** ProtoBus carries text/status only. |
| 4. With native capture, what carries audio to Whisper? | Helper **stdout** → host buffer → `whisper-cli` **stdin**. |
| 5. How is the buffer serialised? | As a **WAV RIFF byte stream** for the engine hop; never as protobuf. |
| 6. Limits / backpressure? | Hard cap on utterance duration; bounded ring buffer; if the helper outpaces the consumer it blocks on its stdout write (natural backpressure). |
| 7. Cancellation and buffer cleanup? | Cancel → kill helper / abort engine, drop all chunk references, zero the buffer, transition to `idle`. |
| 8. How is audio kept out of the gRPC recorder? | A `GrpcRequestFilter` excluding `bytos.VoiceService` **and** any message carrying `audio` (proven, 5/5 — blocker report §7). |
| 9. How is audio kept out of logs/telemetry? | Audio is never logged; error/telemetry properties allow only codes, ids, durations — enforced by test. |
| 10. Can audio reach whisper stdin without touching disk? | **Yes — measured** (capture → memory → WAV in memory → stdin; temp dir unchanged; whisper wrote 0 files). |

**Corrected TD-3 statement:**

> **TD-3 (revised).** Audio is captured in the extension host and never enters the webview. Only text crosses ProtoBus. Audio reaches the recognition engine as an in-memory WAV on the child's stdin and is never written to disk. Voice RPCs are excluded from the gRPC recorder by filter.

---

## 5. Settings integration

Same architecture as the first audit (TD-9) — one registry, one tab — with the new capture fields added.

```text
VOICE
├── General
│   └── Enable Voice                                   (boolean)
├── Audio Capture
│   ├── Capture Method        Automatic | WASAPI | CoreAudio | PipeWire | PulseAudio | ALSA
│   │                         (only methods that exist for this OS are listed)
│   ├── Input Device          System Default | <enumerated devices with state>
│   └── Detection
│       ├── Operating System  Windows 10 x64        (read-only, measured)
│       ├── Capture Backend   WASAPI (detected)      (read-only)
│       ├── Permission        Allowed / Denied / Unknown
│       └── Devices           1 active, 1 unplugged, 1 disabled, 12 not present
├── Test Microphone                                  (level meter; needs a media-src CSP rule)
├── Speech Recognition
│   ├── Engine                whisper.cpp (whisper-cli)
│   ├── Model                 tiny | base | small | (installed models only)
│   ├── Language              Automatic | English | Türkçe | Deutsch | ...
│   └── Auto Language         (implied by Language = Automatic)
├── Recording
│   ├── Silence Detection     (boolean)
│   ├── Silence Timeout       (ms)
│   └── Maximum Duration      (ms)
└── Privacy
    ├── Local Processing      always on (informational)
    └── Audio Retention       "Disabled — audio is never written to disk"
```

Rules that shape the UI:
- **Only really available methods are selectable.** A backend that fails `isAvailable()` is hidden or shown disabled **with its reason**.
- **System Default is always present** as the fallback device option.
- **Device list is dynamic**, refreshed on a device-change notification where the OS provides one, and on opening the pane otherwise.
- **Permission denied** shows an explanation plus a pointer to OS settings (Windows: Settings ▸ Privacy ▸ Microphone; macOS: System Settings ▸ Privacy & Security ▸ Microphone).
- **No dependency on LLM provider selection** appears anywhere in this pane (TD-12).

### 5.1 Proposed settings keys (F1)

```ts
voiceEnabled:                 { default: false }        // boolean
voiceCaptureMethod:           { default: "auto" }       // "auto" | "wasapi" | "coreaudio" | "pipewire" | "pulse" | "alsa"
voiceInputDeviceId:           { default: undefined }     // endpoint id, undefined = system default
voiceEngine:                  { default: "whisper-cli" }
voiceModelId:                 { default: undefined }
voiceLanguage:                { default: "auto" }
voiceSilenceDetectionEnabled: { default: true }
voiceSilenceTimeoutMs:        { default: 1200 }
voiceMaxDurationMs:           { default: 120000 }
```

`voiceCaptureMethod` and `voiceInputDeviceId` are **new** relative to the first audit; they are what the user's requirement adds. `voiceMicrophoneId` is renamed to `voiceInputDeviceId` to make clear it is an **OS input device**, not a browser `MediaDeviceInfo.deviceId`.


---

## 6. Security and privacy

| Concern | Recommendation | Evidence |
| --- | --- | --- |
| OS permission | Never bypass. Windows privacy, macOS TCC, Linux portals apply normally | DOCUMENTED |
| macOS permission attribution | A signed helper with its own `NSMicrophoneUsageDescription`; nested-helper TCC still **must be tested** | Apple docs + NOT TESTED |
| Audio lifetime | Memory only: helper stdout → host buffer → engine stdin | MEASURED (temp dir unchanged) |
| Temp files | None (no WAV on disk) | MEASURED (whisper wrote 0 files) |
| Secure deletion | Not applicable; the control is never writing | DESIGN |
| Recorder exclusion | `GrpcRequestFilter` on `bytos.VoiceService` + `audio` field | PROVEN (5/5) |
| Logging / telemetry | Codes, ids, durations only; never audio or transcript | DESIGN + test required |
| Native process isolation | Helper spawned with argv array, no shell, controlled cwd, minimal env without provider credentials | DESIGN |
| Cloud | None in F1–F5; future gate requires explicit consent | TD-1 |
| Prompt injection via transcript | Not applicable — text lands in the composer; the user still presses Send | TD-11 |

---

## 7. Alternatives considered and why they lost

| Alternative | Why not |
| --- | --- |
| **Webview `getUserMedia`** | Measured `NotAllowedError` in VS Code; no extension-controlled permission surface |
| **Host-side N-API addon** | Per-platform `.node` matrix; a crash kills the extension host; no measured F1 benefit over a helper |
| **`ffmpeg`/SoX capture** | Requires binaries Bytos does not ship; large VSIX cost; duplicates what the OS provides |
| **PortAudio / miniaudio library link** | Adds a per-platform build dependency for behaviour WASAPI/CoreAudio already give us |
| **`whisper-stream` for capture+ASR in one process** | Captures the mic itself, has no pipe contract, tuned for a terminal UI; measured `whisper-cli` + stdin is simpler |
| **Native addon for Whisper instead of CLI** | Kept as the escalation path if latency becomes a problem; not needed at the measured 1.5 s |

---

## 8. Consequences the product must accept

1. **F1 is local-VS-Code-only.** Remote/WSL/containers report voice unavailable.
2. **A native helper must be built and shipped per OS** — a real, ongoing maintenance cost (F2).
3. **macOS is not claimable** until TCC-for-nested-helper is verified (F2 gate).
4. **Linux is not claimable** until PipeWire and PulseAudio are each verified (F2 gate).
5. **Model load dominates short-utterance latency** (~1.5 s with `base`); acceptable but perceptible.
6. **Turkish/German accuracy remains unproven** and must not be advertised yet.

None of these is a surprise introduced here; each follows directly from the measured evidence.

---

## 9. Deviation log (what changed from the first audit, and why)

| First audit | Now | Why | Evidence |
| --- | --- | --- | --- |
| TD-2: capture in the webview | **Capture in the extension host via a native helper** | Webview `getUserMedia` is denied in stock VS Code | `NotAllowedError` ×3 (blocker report §2) |
| TD-3: "audio never leaves the webview" | **Revised: audio never leaves the host; ProtoBus is text-only** | The old wording contradicted its own transport; capture moved anyway | Architecture §4 |
| TD-3: WAV payload in `transcribeUtterance` | **No audio in any RPC** | Audio now goes helper→host→engine stdin | MEASURED capture→WAV→stdin |
| TD-6: RMS silence detection in the webview | **RMS silence detection in the host** | Capture moved; the detector follows the buffer | consequence of TD-2 change |
| TD-7: utterance-based, no interim | **Unchanged** | Still correct | — |
| TD-5: CLI + stdin | **Unchanged** | Confirmed by measurement | 701/1493 ms, exit 0 |
| TD-8: bundle binary, download model | **Unchanged, strengthened** | Upstream checksums are unreliable → Bytos must pin its own | API digest mismatch |
| TD-9/10/11/12/13/14/15 | **Unchanged** | Still correct | — |
| New | **TD-16 capture provider abstraction** | Needed for the user's method-selection requirement | Architecture §3.1 |
| New | **TD-17 recorder exclusion filter** | R-2 is a confirmed privacy defect | 5/5 filter proof |
| New | **TD-18 local-only scope for F1** | Native host capture is not remote-correct | Architecture §9 / matrix |

