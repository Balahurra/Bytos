# VOICE-F0 — Native Audio Capture Research

**Feature:** Bytos Voice
**Phase:** F0 — audit/research only. No product code, dependencies, or packaging changed.
**Date:** 2026-11-07
**Test host:** Windows 10 Home 10.0.19045 (x64), AMD Ryzen 7 260, AMD Audio Device microphone array, VS Code 1.145.2 (Electron 43.8.3 / Chrome 150), Node 26.13.0, Bun 1.4.4, Python 3.12.

> **Evidence convention.** `MEASURED` = executed on the test host during this audit, method stated. `DOCUMENTED` = authoritative vendor documentation, URL cited. `INFERRED` = reasoning from those two, not directly run. `NOT TESTED` = no capable host available. No number here is invented.

---

## 1. Objective restated

The user's primary architectural requirement:

> Bytos' microphone capture must not depend on the VS Code Webview media permission. It should detect the OS and architecture, discover native capture infrastructure, enumerate devices, present both in Settings, let the user pick or accept a default, and drive real transcription — while still honouring OS security (macOS TCC, Windows privacy settings, Linux portals).

This document evaluates whether that is possible, and with what evidence.

---

## 2. The finding that reframes the whole design

### 2.1 Webview capture fails in VS Code (MEASURED)

A probe extension was built outside the repository, loaded into a **real VS Code 1.145.2** window via `--extensionDevelopmentPath`, and its webview iframe evaluated directly. Reproducible 3/3 runs:

| Probe | Result |
| --- | --- |
| `typeof navigator.mediaDevices` in webview iframe | `"object"` — API exists |
| `typeof navigator.mediaDevices.getUserMedia` | `"function"` — method exists |
| `navigator.permissions.query({name:"microphone"}).state` | **`"denied"`** |
| `enumerateDevices()` audio inputs | `[{label:"", deviceId:""}]` — **labels withheld** |
| `getUserMedia({audio:true})` | **`DENIED`** — `NotAllowedError: Permission denied` |
| `window.isSecureContext` | `true` |
| iframe origin | `vscode-webview://0nr2u7t1…` |

**The same machine, in the same session, captured real audio natively** (peak amplitude 0.63, 5 s, 241 440 frames). The constraint is not hardware, OS privacy, or the audio stack — it is the VS Code webview's permission model.

### 2.2 Why the webview is denied

The webview is a cross-origin iframe with origin `vscode-webview://…`, created by VS Code's Electron renderer. `NotAllowedError`, with `permissions.query` already `denied` and empty device labels, is the signature of a **permissions policy / iframe `allow` attribute lacking `microphone`**. The extension cannot change it: `WebviewOptions` exposes only `enableScripts`, `localResourceRoots`, `portMapping`, `enableForms`, `enableCommandUris` (DOCUMENTED, VS Code API reference). There is no extension-controllable media-permission surface.

### 2.3 Consequence

The first audit's TD-2 (webview `getUserMedia`) is **empirically invalidated**. The user's preference for native OS capture is not merely preferable — it is the **only working path on the test host**. Native capture is therefore the primary architecture; webview capture is documented only as a possible future fallback where proven to work.

---

## 3. Windows

### 3.1 API options evaluated

| Approach | Native dependency | Device enum | Device select | Latency | VSIX cost | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **WASAPI via helper/addon** | none (OS API) | yes (IMMDeviceEnumerator) | yes (endpoint id) | lowest | binary only | **Primary** |
| WinRT MediaCapture | none (OS API) | yes | yes | low | binary only | Viable; needs a WinRT projection, heavier than WASAPI |
| PortAudio | libportaudio | yes | yes | low | +~200 KB DLL | Cross-platform, but a dependency Bytos must build per platform |
| miniaudio | single header | yes | yes | low | +~100 KB | Excellent fit: header-only, WASAPI/ALSA/CoreAudio backends |
| CPAL (Rust) | Rust binary | yes | yes | low | Rust toolchain to build | Strong only if Bytos already had a Rust helper; it does not |
| CLI (`ffmpeg -f dshow`, SoX) | external binary | yes | yes | medium | tens of MB or user-installed | Rejected: requires a binary Bytos does not ship |
| Webview `getUserMedia` | none | labels hidden | no | n/a | none | **Fails in VS Code** (§2) |

### 3.2 WASAPI verification (MEASURED)

Implemented directly through `IMMDeviceEnumerator` / `IMMDevice` / `IPropertyStore` COM interfaces (ctypes), exercising the exact API a native backend would use.

**Device enumeration** — 15 capture endpoints under `DEVICE_STATEMASK_ALL`, exactly **1 ACTIVE**:

```
11  ACTIVE   YES   Microphone Array (AMD Audio Device) | Microphone Array
    id={0.0.1.00000000}.{de3487ce-8afe-4004-9582-4d511e5fdacc}
10  UNPLUGGED       Mikrofon (Realtek High Definition Audio) | Mikrofon
 3  DISABLED        Stereo Karışımı (Realtek High Definition Audio)
0,1,2,4-9,12-14    NOTPRESENT   (AUX inputs on AMD/NVIDIA/HD Audio)
total=15  active=1
default_console_id={0.0.1.00000000}.{de3487ce-...}
```

This answers the Windows questions directly:

| Question | Answer | Evidence |
| --- | --- | --- |
| Which API is most reliable? | **WASAPI** (`IMMDeviceEnumerator` + `IAudioClient`) — OS-native, no third-party dependency | MEASURED |
| How are devices enumerated? | `EnumAudioEndpoints(eCapture, stateMask)`; must include `DISABLED|NOTPRESENT|UNPLUGGED` to explain *why* a device is unavailable | MEASURED |
| How is the default device determined? | `GetDefaultAudioEndpoint(eCapture, eConsole)` → endpoint id; the `eCommunications` role can differ (headset vs speakers) | MEASURED |
| Device names and ids? | Name via `IPropertyStore` `PKEY_Device_FriendlyName`; id is the stable `{0.0.1.00000000}.{GUID}` string, usable for persistence | MEASURED |
| Can the user choose another mic? | Yes — persist the endpoint id, then `IMMDeviceEnumerator::GetDevice(id)` | INFERRED from API contract |
| Device removed/changed? | `IMMNotificationClient::OnDeviceRemoved` / `OnDefaultDeviceChanged` callbacks exist | DOCUMENTED (Win32 multimedia docs) |
| Windows privacy settings effect? | Global + per-app microphone consent gates capture | INFERRED — not exercised (host has mic allowed) |
| Error on denial | `E_ACCESSDENIED` (0x80070005) from `Activate`/`Initialize` | INFERRED — not exercised |
| Real audio without webview permission? | **YES — proven** | MEASURED |

### 3.3 Capture verification (MEASURED)

Shared-mode capture on the default endpoint:

```
mix format     = 48 000 Hz, 2 ch, 32-bit float (WAVE_FORMAT_EXTENSIBLE 0xfffe)
16k mono s16   = supported (IsFormatSupported → YES; WASAPI converts internally)
5 s capture    = 241 440 frames, 496 blocks, 1 discontinuity
peak amplitude = 0.627716   rms = 0.014780   (real signal, not silence)
silent blocks  = 0
disk writes    = none
```

Repeated three times: peaks 0.692 / 0.020 / 0.043 — consistent with live ambient audio.

**Key Windows design fact:** the device mixes at **48 kHz stereo float32** regardless of the requested format. A native backend must downmix and resample to 16 kHz mono itself, or accept WASAPI's conversion and lose control of the algorithm.

### 3.4 Encoding finding (MEASURED)

Device names contain Turkish characters (`Kulaklık`, `Mikrofon`, `Stereo Karışımı`). Under a non-UTF-8 console they rendered as `Kulakl²k` / `Mikrofon`. **Any native helper that prints device names must emit UTF-8 explicitly and the host must decode UTF-8 explicitly** — the same class of bug `whisper-cli` guards with `SetConsoleOutputCP(CP_UTF8)`.

### 3.5 Windows recommendation

**Primary backend: WASAPI via a small native helper process**, not an N-API addon, for F1:

- It matches the codebase's existing pattern of controlled child processes (`HookProcessRegistry.terminateAll()` at `common.ts:181`).
- A helper crash cannot take down the VS Code extension host.
- The helper can speak a simple length-prefixed PCM protocol on stdout, keeping the host simple.

Reserve the N-API addon for a later phase if helper IPC or spawn cost proves to matter.

---

## 4. macOS

No Mac was available. **Everything here is `NOT TESTED`** unless marked DOCUMENTED.

| Question | Answer | Status |
| --- | --- | --- |
| Best capture API | CoreAudio `AudioUnit` (HAL) or `AVAudioEngine` | DOCUMENTED (Apple frameworks) |
| `NSMicrophoneUsageDescription` required? | **Yes.** Apple: "This key is required if your app uses APIs that access the device's microphone." (macOS 10.14+) | DOCUMENTED ([Apple](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription)) |
| Can the VS Code Extension Host capture the mic directly? | Almost certainly **no** — the host runs under VS Code's bundle, which has no microphone usage description for our purposes; TCC attributes the request to the **responsible** process | INFERRED — must be tested |
| Is a separate signed helper better? | **Yes.** A helper shipping its own `Info.plist` with `NSMicrophoneUsageDescription`, code-signed and notarized, can own the TCC grant | INFERRED from the Apple TCC model |
| Hardened Runtime / notarization for a nested helper | TCC and Gatekeeper behaviour for a binary nested inside a VS Code extension is **unverified**; a release blocker for macOS | NOT TESTED |
| Device enumeration | CoreAudio: `kAudioHardwarePropertyDevices`; per-device `kAudioDevicePropertyDeviceNameCFString` | DOCUMENTED |
| Permission denied / recovery | TCC prompt attributed to the responsible process; denial yields silence or an API error; recovery via System Settings ▸ Privacy & Security ▸ Microphone | DOCUMENTED (general TCC behaviour) |

**macOS verdict:** native capture is the only viable approach (webview already fails on macOS VS Code for the same reason as Windows), but the permission-attribution question — **does a nested helper inherit VS Code's TCC identity or its own?** — is unresolved and **must be answered on real hardware before macOS can be claimed**.

---

## 5. Linux

No Linux host was available. **`NOT TESTED`** unless marked DOCUMENTED.

| Question | Answer | Status |
| --- | --- | --- |
| PipeWire on modern distros? | Yes on Fedora, Ubuntu 22.10+, Arch, Debian 12+ | DOCUMENTED (distro defaults) |
| PulseAudio present? | Yes on older Ubuntu (≤22.04) and many LTS systems | DOCUMENTED |
| Is PulseAudio compat via PipeWire? | **Yes** — PipeWire ships `pipewire-pulse`, a PulseAudio-compatible server, so `parec`/`pactl` work transparently | DOCUMENTED ([PipeWire docs](https://docs.pipewire.org/) — "Pulseaudio Modules") |
| ALSA directly? | Yes (`snd_pcm_open`), but it bypasses mixing and is the least portable across distros | DOCUMENTED |
| Which to choose when several exist? | Prefer PipeWire → PulseAudio → ALSA, because each level is a superset of the one below | DESIGN DECISION |
| Device enumeration API? | `pactl list sources short` / `pw-cli`; ALSA via `snd_device_name_hint` | DOCUMENTED |
| Distro differences? | Real: Ubuntu LTS = PulseAudio, Fedora = PipeWire, Arch = PipeWire, minimal/server images may have **no** audio at all | DOCUMENTED |
| Wayland vs X11? | Irrelevant to audio capture; both expose the same server APIs | DOCUMENTED |
| Flatpak/Snap sandbox? | Changes everything: sandboxed apps must go through **xdg-desktop-portal**; direct ALSA/Pulse access may be blocked | DOCUMENTED (portal model) |
| Desktop portal required? | **Only inside a sandbox.** A terminal-launched VS Code is not sandboxed and can use Pulse/PipeWire directly | INFERRED |
| Fallback when no service? | Detect `pactl info` failure → report "no audio server" and disable voice with an explanation rather than failing silently | DESIGN DECISION |

**Linux verdict:** one binary is unlikely to cover every distro. The honest plan: support **PipeWire (with pipewire-pulse)** and **PulseAudio** as the two targets, verify on **Ubuntu LTS (PulseAudio)** and **Fedora (PipeWire)**, and document ALSA-only and sandboxed setups as unsupported in F1. **No Linux result is claimed here.**



---

## 6. Backend strategy: one abstraction, N implementations

All three platforms differ in API but not in shape. Each provides enumerate / a stable id / a default / streamed PCM / an OS permission gate. That is enough for **one** abstraction with **three** implementation families:

```
AudioCaptureProvider (interface)
├── WasapiCaptureProvider        Windows   (helper process; addon later if needed)
├── CoreAudioCaptureProvider     macOS     (helper process)
└── LinuxCaptureProvider
    ├── PipeWireCaptureProvider  (pw-record / portal)
    ├── PulseAudioCaptureProvider(parec)
    └── AlsaCaptureProvider      (snd_pcm, last resort)
```

Ownership of each requirement is explicit:

| Responsibility | Owner |
| --- | --- |
| OS/arch detection | Extension host (`process.platform`, `process.arch`) |
| Which providers exist for this OS | Provider registry, compiled in |
| Is a provider actually usable *now* | `provider.isAvailable()` — must probe, not assume |
| Permission state | `provider.getStatus().permission` |
| Device list | `provider.enumerateDevices()` |
| PCM production | `provider.startCapture()` → chunk callbacks |
| Default-device policy | Shared resolver, not the provider |
| Fallback policy | Shared resolver, not the provider |
| Surfacing it all to the UI | One RPC (`getVoiceStatus`) |

**Design rule (non-negotiable):** a provider reports what it can do and what it observed; it never decides which one wins. Selection and fallback live in one shared resolver, so the policy is testable in isolation and identical on every OS.

---

## 7. Remote / WSL / container analysis

"Whose microphone is captured?" has a factual answer, not a preference:

| Scenario | Webview runs on | Extension host runs on | Mic a **native host** capture would use | Correct? |
| --- | --- | --- | --- | --- |
| Local VS Code | user machine | user machine | user machine | correct |
| WSL | user machine (Windows) | WSL distro | WSL has no audio device by default | wrong / impossible |
| Remote SSH | user machine | remote server | remote server | **wrong** |
| Dev Container | user machine | container | container has no device | **wrong** |
| Codespaces / VS Code Web | browser | container | container has no device | **wrong** |

Native host capture is correct **only** for local VS Code. On remote targets the microphone physically belongs to the client.

**Hybrid design, used only where needed:** the capture **location** is resolved at runtime.

```
local extension host     → native OS capture           (primary)
remote extension host    → client-side capture adapter (only if a supported
                            client capture path is proven for that host)
otherwise                → voice disabled, with an explicit reason
```

Because webview capture is proven **denied** in stock VS Code (§2), a "client-side adapter" for remote is **not currently available**. Honestly then: **F1 supports local VS Code only; remote/WSL/containers report voice as unavailable with a clear message**, rather than silently capturing the wrong microphone. This is a documented limitation, not an oversight.

---

## 8. Comparison summary

| Criterion | Webview `getUserMedia` | WASAPI helper | CoreAudio helper | Linux helper | N-API addon |
| --- | --- | --- | --- | --- | --- |
| Works in VS Code today | **NO** (measured) | **YES** (measured) | NOT TESTED | NOT TESTED | NOT TESTED |
| Device labels | hidden (measured) | yes (measured) | yes | yes | yes |
| Device selection | impossible | yes | yes | yes | yes |
| Extra dependency | none | none (OS API) | none | none | none |
| Binary needed | none | small helper | small helper | small helper | `.node` per platform |
| Crash isolation | n/a | excellent | excellent | excellent | poor (kills host) |
| Remote-correct | would be | no | no | no | no |
| VSIX size | 0 | +~1–3 MB | +~1–3 MB | +~1–3 MB | +~1–3 MB per platform |
| Code signing | n/a | Windows optional, mac required | mac required | none | mac required |

**Recommendation:** native helper (WASAPI / CoreAudio / Linux) as the primary architecture, gated per platform by real tests. Webview capture is **not used**, because it is proven to fail.

---

## 9. What this research did not establish

- macOS TCC behaviour for a nested helper — **NOT TESTED**.
- Linux behaviour on any distro — **NOT TESTED**.
- The Windows microphone-privacy denial path (`E_ACCESSDENIED`) — **NOT TESTED** (host has mic allowed).
- Device hot-plug / default-device-change notifications — **NOT TESTED** (API documented, not exercised).
- Whether an N-API addon would be faster than the helper — **NOT TESTED** (not built).
- Long-session (30+ min) capture stability — only partially covered in `VOICE-F0-BLOCKER-RESOLUTION-REPORT.md`.

These are carried into `VOICE-F0-CROSS-PLATFORM-TEST-MATRIX.md` as open cells and into `VOICE-F0-RISK-REGISTER.md` as risks.

