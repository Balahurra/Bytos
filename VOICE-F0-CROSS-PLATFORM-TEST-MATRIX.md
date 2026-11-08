# VOICE-F0 — Cross-Platform Test Matrix

**Feature:** Bytos Voice
**Phase:** F0 — audit only.
**Date:** 2026-11-07

> **This document's single job is to prevent a theoretical capability from being reported as a tested one.**
>
> Every cell is exactly one of: `PASS`, `FAIL`, `BLOCKED`, `NOT TESTED`, `NOT APPLICABLE`.
> A `PASS` must be backed by §3 evidence (environment + method + observed output).

---

## 1. Test environments actually used

| ID | Platform | Details | Available |
| --- | --- | --- | --- |
| W10 | Windows 10 Home **10.0.19045**, x64 | AMD Ryzen 7 260, AMD Audio Device `Microphone Array`, Realtek HD Audio, NVIDIA HD Audio, JBL bluetooth headset | **YES** — all Windows tests ran here |
| M1 | macOS x64 | — | **NO** |
| M2 | macOS arm64 | — | **NO** |
| U1 | Ubuntu LTS x64 | — | **NO** |
| U2 | Other Linux (Fedora / Arch) | — | **NO** |
| R1 | Remote SSH / WSL | — | **NO** (host reports `HypervisorPresent=False`, no WSL, no Docker) |

**The only platform with real results is Windows 10 x64.** Everything else is `NOT TESTED` by definition, not by failure.

---

## 2. The matrix

| Test | Windows (W10) | macOS (M1/M2) | Ubuntu (U1) | Other Linux (U2) | Remote/WSL (R1) |
| --- | --- | --- | --- | --- | --- |
| OS detection | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Audio backend detection | **PASS** (WASAPI) | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Microphone enumeration | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Default microphone | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Manual device selection | **BLOCKED** | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Permission status | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Real audio capture | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT APPLICABLE |
| Device disconnect | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT APPLICABLE |
| Device reconnect | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT APPLICABLE |
| Sample rate conversion | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT APPLICABLE |
| Whisper transcription | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT APPLICABLE |
| Cancel cleanup | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Window close cleanup | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| Offline operation | **PASS** | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |
| **Webview getUserMedia** | **FAIL** | NOT TESTED | NOT TESTED | NOT TESTED | NOT TESTED |

### 2.1 Why "Manual device selection" is `BLOCKED` everywhere

The *capability* exists (`IMMDeviceEnumerator::GetDevice(id)` is documented, and the endpoint id was read successfully). What is blocked is **exercising it end to end**, because the test host has only **one** ACTIVE input:

```
active=1  -> {0.0.1.00000000}.{de3487ce-8afe-4004-9582-4d511e5fdacc}
```

With a single active device there is no second device to switch to. This is an **equipment limitation, not a technical unknown**. F1 must verify on a host with ≥2 active inputs.

---

## 3. Evidence for every PASS

### 3.1 OS detection — PASS

```
Microsoft Windows 10 Home   10.0.19045.0   64 bit
PROCESSOR_ARCHITECTURE = AMD64     (Win32_Processor.Architecture = 9)
```
Method: `[System.Environment]::OSVersion`, `Get-CimInstance Win32_OperatingSystem`, `process.env.PROCESSOR_ARCHITECTURE`, `node --version`.
Conclusion: a backend can branch on `process.platform === "win32"` and `process.arch === "x64"`.

### 3.2 Audio backend detection — PASS

```
AudioEndpointBuilder  Running  Automatic
Audiosrv              Running  Automatic
IMMDeviceEnumerator created OK; EnumAudioEndpoints(eCapture, 0xF) -> 15 endpoints
```
Method: `Get-Service` + direct COM `CoCreateInstance` / `EnumAudioEndpoints`.
Conclusion: WASAPI is present and usable; detection is real, not inferred.

### 3.3 Microphone enumeration — PASS

```
11  ACTIVE   YES   Microphone Array (AMD Audio Device) | Microphone Array
10  UNPLUGGED       Mikrofon (Realtek High Definition Audio) | Mikrofon
 3  DISABLED        Stereo Karışımı (Realtek High Definition Audio)
 0,1,2,4-9,12-14    NOTPRESENT   (AUX inputs)
total=15 active=1
```
Method: `IMMDeviceCollection` iteration, `GetId`, `GetState`, `OpenPropertyStore` + `PKEY_Device_FriendlyName`.
Conclusion: names, stable ids and availability states are all obtainable — everything Settings needs, including reasons.

### 3.4 Default microphone — PASS

```
GetDefaultAudioEndpoint(eCapture, eConsole)
  -> {0.0.1.00000000}.{de3487ce-8afe-4004-9582-4d511e5fdacc}
  == the single ACTIVE endpoint ("Microphone Array")
```
Conclusion: "System default" resolves to a concrete id for display.

### 3.5 Permission status — PASS (positive path only)

```
CapabilityAccessManager\\ConsentStore\\microphone : Value = Allow
Native capture succeeded -> permission granted for this session
```

**Limitation:** the *denied* path was not exercised (host has the mic allowed). OS-denied behaviour is `NOT TESTED`; expected signal is `E_ACCESSDENIED` (0x80070005) from `Activate`/`Initialize` (INFERRED).

### 3.6 Real audio capture — PASS

Three independent runs, default endpoint, shared mode:

| Run | Duration | Blocks | Frames | Peak | RMS | Silent blocks |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 5.03 s | 496 | 241 440 | 0.627716 | 0.014780 | 0 |
| 2 | 5.00 s | — | — | 0.692841 | 0.005829 | — |
| 3 | 5.00 s | — | — | 0.020081 | 0.001804 | — |

Method: `IAudioClient::Initialize(SHARED)` + `IAudioCaptureClient::GetBuffer`/`ReleaseBuffer`.
Conclusion: **the microphone works with no webview permission.** This is the central result of the re-audit.

### 3.7 Sample rate conversion — PASS

```
device mix format   = 48 000 Hz, 2 ch, 32-bit float (0xfffe EXTENSIBLE)
pipeline output     = 16 000 Hz, 1 ch, 16-bit
6.01 s  -> 96 000 samples
30.01 s -> 480 320 samples
60.01 s -> 960 160 samples
WAV header verified = 1 ch, 16000 Hz, 16-bit, correct frame count
```
Conclusion: downmix + resample to whisper's native rate works at three durations (the algorithm the native helper must reproduce).

### 3.8 Whisper transcription — PASS

```
whisper-cli.exe --help                                            -> exit 0
whisper-cli.exe -m ggml-tiny.bin  -f capture.wav -l auto -nt -np  -> exit 0, Turkish text
whisper-cli.exe -m ggml-base.bin  -f en_ref.wav  -l en   -nt -np  -> exit 0, WER 0.0%
```
Conclusion: a real binary, checksummed by Bytos, transcribes real captured audio.

### 3.9 Cancel cleanup — PASS

```
Start whisper-cli (base, 60 s audio), kill after 400 ms
whisper_before = 0   whisper_after = 0
```
Conclusion: killing the child leaves no orphan. (Process kill tested; the in-app AbortSignal path is F1 work.)

### 3.10 Offline operation — PASS

Transcription after capture required no network: model on local disk, binary local, audio in memory/WAV. The earlier model download was a one-time step and is a separate concern.
Conclusion: once the model is present, capture→transcribe is fully offline.

### 3.11 Webview getUserMedia — FAIL

See `VOICE-F0-BLOCKER-RESOLUTION-REPORT.md` §2 — `NotAllowedError` on 3/3 runs.

---

## 4. What each `NOT TESTED` cell blocks

| Untested area | Blocks | Gate |
| --- | --- | --- |
| macOS capture + TCC | macOS release | **F2 gate** — needs Apple hardware |
| macOS helper nesting / notarization | macOS release | **F2 gate** |
| Linux PipeWire | Linux release | **F2 gate** — needs Fedora |
| Linux PulseAudio | Linux release | **F2 gate** — needs Ubuntu LTS |
| Linux sandbox / portal | Linux release | F2 gate |
| Windows privacy denial | Windows robustness | F2 gate |
| Device disconnect / reconnect | Release robustness | F1 test + F2 gate |
| Window-close cleanup (in-app) | Release robustness | F1 |
| Remote / WSL voice | Product scope | Documented as unavailable in F1 |
| Turkish / German accuracy | Accuracy claims | F1 with human corpus |

---

## 5. Known limitations to disclose in the product

These are honest consequences of the evidence, not bugs to hide:

1. **Voice is available on local VS Code only in F1.** Remote SSH, WSL, Dev Containers and Codespaces report voice as unavailable with an explicit reason, because the microphone belongs to the client while a native host capture would use the server.
2. **Webview capture is not a fallback.** It is denied in stock VS Code on the tested platform.
3. **One active input on the test host**, so multi-device selection is unverified.
4. **`auto` language detection costs ~30 % more latency** than an explicit language.
5. **`tiny` mishears technical terms** ("async await" → "a single weight"); `base` does not.
6. **Turkish and German accuracy are unmeasured.** No claim will be made until a human corpus exists.
7. **Upstream whisper checksum metadata is unreliable**, so trust rests on Bytos-pinned hashes.

---

## 6. Reproduction

Harnesses live outside the repository under `%TEMP%\bytos-voice-audit\`:

| Script | Purpose |
| --- | --- |
| `wasapi_probe.py` | enumerate capture endpoints with names/ids/states/default |
| `wasapi_capture_diag.py` | 5 s capture with buffer flags, peak/RMS |
| `capture_to_wav.py` | capture N seconds → 16 kHz mono PCM16 WAV |
| `b1-ext/` + `b1b_runner.js` | load a probe extension into real VS Code, test `getUserMedia` in a webview |
| `GenSpeech.cs` | .NET TTS → 16 kHz WAV ground truth |
| `wer.py` | WER/CER against generated ground truth |
| `r2_filter_proof.js` | prove the recorder exclusion filter |

None are product code; all are disposable.

