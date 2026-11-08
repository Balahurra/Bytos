# Bytos Voice — native capture helper (F1, Windows x64)

This directory holds the **Windows audio capture helper** the extension host spawns
for Bytos Voice F1. It is not a library and not an addon: it is a small,
self-contained child process.

- Source: [`../../native/voice-helper-windows/bv-os-audio-helper.cpp`](../../native/voice-helper-windows/bv-os-audio-helper.cpp)
- Artifact: `bin/win32-x64/bv-os-audio-helper.exe`
- Build recipe: [`../../scripts/build-voice-helper.ps1`](../../scripts/build-voice-helper.ps1)

## Contract

| Command | stdout |
| --- | --- |
| `--probe` | one UTF-8 JSON line: backend, version, `available`, device counts, permission |
| `--list-devices` | one UTF-8 JSON line: `id`, `name`, `state`, `isDefault` per endpoint |
| `--capture --device <id\|default> --rate 16000 --channels 1` | `captureStarted` JSON line, then **length-prefixed binary PCM16 frames** |
| `--version` / `--help` | one JSON line |

Frame header (host side: `src/core/voice/capture/frameParser.ts`):

```
uint32 length          payload bytes that follow the header (LE)
uint16 formatTag       1 = WAVE_FORMAT_PCM
uint32 sampleRate      Hz
uint16 channels        1 = mono
uint16 bitsPerSample   16
uint8[length]          PCM16 little-endian payload
```

Diagnostics go to **stderr only** and carry codes/ids/counters — never audio.

## Hard rules (enforced by review and by the F1 tests)

- **No file I/O, no temp files, no network, no shell.** Audio exists only in the
  helper's buffers and on stdout.
- **Device names are UTF-8.** The reference host's endpoints contain Turkish
  characters (`Mikrofon`, `Kulaklık`, `Stereo Karışımı`); the helper converts
  UTF-16 → UTF-8 explicitly.
- **Downmix averages channels** (summing clips).
- **stdout during capture is unbuffered**, so frames stream as they are captured.
- **stdin EOF terminates capture**, so the helper cannot outlive the extension host.
- **No microphone / denied access is reported, never crashed**: `--probe` returns
  `available: false` with exit 0, and `--capture` emits a typed `error` line.

## Building

Requires the Microsoft C++ toolchain (Visual Studio 2022 Build Tools or newer with
the "Desktop development with C++" workload) and the Windows 10/11 SDK.

```powershell
cd apps/vscode
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-voice-helper.ps1
```

The script resolves `vcvars64.bat` via `vswhere` (falling back to the well-known
Build Tools install path), compiles with `/std:c++17 /W4 /utf-8`, writes the
executable, and prints its size and SHA-256.

## Current artifact

| Field | Value |
| --- | --- |
| Toolchain | MSVC 14.44.35207 (VS 2022 Build Tools), Windows SDK 10.0.26100.0 |
| Configuration | Release (`/O2 /DNDEBUG`) |
| Size | 197 120 bytes |
| SHA-256 | `05e8706715fa2c54d6a3e2cf10442e28e3d498659390b6f1b5670d248511997f` |
| Helper version | `0.1.0` |

Re-running the build script prints the new hash; keep this table in sync when the
artifact changes.

## Scope

Windows x64 only. macOS (CoreAudio/TCC) and Linux (PipeWire/PulseAudio) capture are
**not implemented and not claimed** in F1 — no `darwin`/`linux` helper exists here,
and capability detection reports `PLATFORM_NOT_SUPPORTED_IN_F1` on those hosts.

## Packaging

The helper is a development/F1 artifact. Whether it ships in a packaged extension is
an **F5** decision; F1 does not change what a packaged build contains.
