// Negative-path smoke cases against the REAL helper (F1 §6.4 S1/S6 + error paths):
//   S1  --probe with no usable microphone  → available:false, exit 0, no crash
//   E1  --capture with an unknown endpoint id → typed CAPTURE_DEVICE_NOT_FOUND
//   E2  provider with a missing helper path   → typed CAPTURE_HELPER_FAILED
//   E3  capability for a remote / non-Windows host → unavailable + reason, no spawn
// Counters and codes only; no audio is printed or written.
//
//   bun scripts/voice-negative-paths.ts
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const helper = path.resolve(import.meta.dir, "..", "assets", "voice", "bin", "win32-x64", "bv-os-audio-helper.exe")
if (!fs.existsSync(helper)) {
	throw new Error(`helper not found: ${helper} (run scripts/build-voice-helper.ps1 first)`)
}

const results: Array<{ case: string; pass: boolean; detail: string }> = []

function record(name: string, pass: boolean, detail: string): void {
	results.push({ case: name, pass, detail })
	console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`)
}

// E1 — unknown endpoint id must be a typed error, not a crash.
{
	const run = spawnSync(helper, ["--capture", "--device", "{0.0.1.00000000}.{does-not-exist}", "--rate", "16000"], {
		encoding: "utf8",
		input: "",
		timeout: 20_000,
	})
	const lines = (run.stdout ?? "").trim().split(/\r?\n/).filter(Boolean)
	const errorLine = lines.find((line) => line.includes('"kind":"error"'))
	const code = errorLine ? (JSON.parse(errorLine) as { code?: string }).code : undefined
	record(
		"E1 unknown device id",
		code === "CAPTURE_DEVICE_NOT_FOUND" && run.status === 0,
		`exit=${run.status} code=${code ?? "(none)"}`,
	)
}

// S1 — probe reports availability honestly (no crash) even with no active mic.
{
	const run = spawnSync(helper, ["--probe"], { encoding: "utf8", timeout: 20_000 })
	let parsed: { available?: boolean; activeDeviceCount?: number; deviceCount?: number } = {}
	try {
		parsed = JSON.parse((run.stdout ?? "").trim().split(/\r?\n/)[0] ?? "{}")
	} catch {
		parsed = {}
	}
	const honest = typeof parsed.available === "boolean" && parsed.available === (parsed.activeDeviceCount ?? 0) > 0
	record(
		"S1 probe availability",
		run.status === 0 && honest,
		`exit=${run.status} available=${parsed.available} active=${parsed.activeDeviceCount} total=${parsed.deviceCount}`,
	)
}

// E2 — a missing helper must surface as a typed error, never a crash.
{
	const { WasapiCaptureProvider } = await import("@core/voice/capture/WasapiCaptureProvider")
	const missing = new WasapiCaptureProvider({ helperPath: path.join(path.dirname(helper), "does-not-exist.exe") })
	let code = "(none)"
	try {
		await missing.startCapture({})
	} catch (error) {
		code = (error as { code?: string }).code ?? "(none)"
	}
	await missing.dispose()
	record("E2 missing helper binary", code === "CAPTURE_HELPER_FAILED", `code=${code}`)
}

// E3 — unsupported hosts are refused with a reason and spawn nothing.
{
	const { detectVoiceCapability } = await import("@core/voice/capability")
	const remote = detectVoiceCapability({
		platform: "win32",
		arch: "x64",
		remoteName: "ssh-remote",
		helperPath: helper,
		deviceCount: 1,
	})
	const mac = detectVoiceCapability({ platform: "darwin", arch: "arm64", helperPath: helper, deviceCount: 1 })
	const linux = detectVoiceCapability({ platform: "linux", arch: "x64", helperPath: helper, deviceCount: 1 })
	const pass =
		!remote.canCapture &&
		remote.reason === "REMOTE_HOST_UNSUPPORTED" &&
		!mac.canCapture &&
		mac.reason === "PLATFORM_NOT_SUPPORTED_IN_F1" &&
		!linux.canCapture &&
		linux.reason === "PLATFORM_NOT_SUPPORTED_IN_F1"
	record("E3 unsupported hosts", pass, `remote=${remote.reason} darwin=${mac.reason} linux=${linux.reason}`)
}

const failed = results.filter((entry) => !entry.pass)
console.log(`\n${results.length - failed.length}/${results.length} negative-path checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
