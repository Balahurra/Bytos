import { mkdtempSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { scrubHelperEnv, WasapiCaptureProvider } from "@core/voice/capture/WasapiCaptureProvider"
import { VoiceError } from "@core/voice/types"
import { VoiceSessionRegistry } from "@core/voice/VoiceSessionRegistry"
import { afterEach, describe, expect, it } from "vitest"

/**
 * Provider tests against a FAKE helper process. The fake speaks the same wire
 * protocol as the native helper (one JSON line, then length-prefixed PCM
 * frames), so the provider's framing, lifecycle and cleanup are exercised
 * without a microphone. The REAL helper is covered by the Windows smoke run.
 *
 * The provider spawns behind an injectable `spawnImpl`; the fake routes that
 * spawn to the current runtime executing the fake script, which keeps the test
 * cross-platform (no `.cmd` shim, no shell).
 */

const FAKE_HELPER_SOURCE = `
const mode = process.argv[2]
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n")
function frame(samples) {
  const header = Buffer.alloc(14)
  header.writeUInt32LE(samples.length * 2, 0)
  header.writeUInt16LE(1, 4)
  header.writeUInt32LE(16000, 6)
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(16, 12)
  const payload = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) payload.writeInt16LE(samples[i], i * 2)
  process.stdout.write(Buffer.concat([header, payload]))
}
if (mode === "--probe") {
  emit({ kind: "probe", backend: "wasapi", version: "fake-0.1.0", available: true, deviceCount: 2, activeDeviceCount: 1, permission: "granted" })
  process.exit(0)
}
if (mode === "--list-devices") {
  emit({ kind: "devices", devices: [
    { id: "dev-a", name: "Microphone Array (Fake)", state: "active", isDefault: true },
    { id: "dev-b", name: "Mikrofon (Fake)", state: "unplugged", isDefault: false }
  ]})
  process.exit(0)
}
if (mode === "--capture") {
  if (process.env.FAKE_HELPER_DENY === "1") {
    emit({ kind: "error", code: "MICROPHONE_ACCESS_DENIED" })
    process.exit(0)
  }
  process.stderr.write("[fake-helper] device_open\\n")
  emit({ kind: "captureStarted", backend: "wasapi", sampleRate: 16000, channels: 1 })
  let i = 0
  const timer = setInterval(() => { frame([i % 100, -(i % 100), 5, -5]); i++ }, 20)
  const stop = () => { clearInterval(timer); emit({ kind: "captureStopped", frames: i, bytes: i * 8 }); process.exit(0) }
  process.stdin.on("data", (buf) => { if (buf.toString().includes("q")) stop() })
  process.stdin.on("end", stop)
  return
}
process.exit(2)
`

let helperDir: string | undefined

function fakeHelperDir(): string {
	if (!helperDir) {
		helperDir = mkdtempSync(path.join(os.tmpdir(), "bv-fake-helper-"))
		writeFileSync(path.join(helperDir, "fake-helper.js"), FAKE_HELPER_SOURCE, "utf8")
	}
	return helperDir
}

/** Spawns the fake helper script via the current runtime. */
function fakeSpawn(_command: string, args: readonly string[], options: Record<string, unknown>) {
	const { spawn } = require("node:child_process") as typeof import("node:child_process")
	return spawn(process.execPath, [path.join(fakeHelperDir(), "fake-helper.js"), ...args], options as never)
}

function provider(): WasapiCaptureProvider {
	return new WasapiCaptureProvider({ helperPath: "fake-helper", spawnImpl: fakeSpawn as never })
}

afterEach(async () => {
	await VoiceSessionRegistry.terminateAll()
	delete process.env.FAKE_HELPER_DENY
})

describe("WasapiCaptureProvider (fake helper)", () => {
	it("probes availability, permission and device counts", async () => {
		const result = await provider().probe()
		expect(result.available).toBe(true)
		expect(result.permission).toBe("granted")
		expect(result.deviceCount).toBe(2)
		expect(result.activeDeviceCount).toBe(1)
		expect(result.version).toBe("fake-0.1.0")
	})

	it("lists devices with UTF-8 names and states (audio-free metadata)", async () => {
		const devices = await provider().enumerateDevices()
		expect(devices).toHaveLength(2)
		expect(devices[0]).toEqual({ id: "dev-a", name: "Microphone Array (Fake)", state: "active", isDefault: true })
		expect(devices[1].state).toBe("unplugged")
	})

	it("starts capture, streams normalised frames, and stops on demand", async () => {
		const p = provider()
		const frames: number[] = []
		p.onFrames((frame) => {
			expect(frame.sampleRate).toBe(16000)
			expect(frame.channels).toBe(1)
			frames.push(frame.samples.length)
		})
		const started = await p.startCapture({ deviceId: "default" })
		expect(started.backend).toBe("wasapi")
		expect(started.sampleRate).toBe(16000)
		expect(started.channels).toBe(1)

		await new Promise((resolve) => setTimeout(resolve, 250))
		expect(frames.length).toBeGreaterThan(0)

		const stopped = await p.stopCapture()
		expect(stopped.framesReceived).toBeGreaterThan(0)
		expect(stopped.bytesReceived).toBe(stopped.framesReceived * 8)
		await p.dispose()
	})

	it("reports a typed MICROPHONE_ACCESS_DENIED instead of crashing", async () => {
		process.env.FAKE_HELPER_DENY = "1"
		try {
			const p = provider()
			await expect(p.startCapture({})).rejects.toMatchObject({ code: "MICROPHONE_ACCESS_DENIED" })
			expect(VoiceSessionRegistry.getActiveCount()).toBe(0)
			await p.dispose()
		} finally {
			delete process.env.FAKE_HELPER_DENY
		}
	})

	it("cancelCapture kills the child and leaves the registry empty", async () => {
		const p = provider()
		await p.startCapture({})
		expect(VoiceSessionRegistry.getActiveCount()).toBe(1)
		await p.cancelCapture()
		expect(VoiceSessionRegistry.getActiveCount()).toBe(0)
		await p.dispose()
	})

	it("dispose() is idempotent and kills a live child", async () => {
		const p = provider()
		await p.startCapture({})
		await p.dispose()
		await p.dispose()
		expect(VoiceSessionRegistry.getActiveCount()).toBe(0)
	})

	it("refuses a second concurrent capture", async () => {
		const p = provider()
		await p.startCapture({})
		await expect(p.startCapture({})).rejects.toBeInstanceOf(VoiceError)
		await p.dispose()
	})
})

describe("scrubHelperEnv", () => {
	it("strips provider credentials from the helper environment", () => {
		const env = scrubHelperEnv({
			PATH: "/usr/bin",
			ANTHROPIC_API_KEY: "secret",
			OPENROUTER_API_KEY: "secret",
			BYTOS_API_KEY: "secret",
			SOME_TOKEN: "secret",
			GITHUB_TOKEN: "secret",
			DB_PASSWORD: "secret",
			HOME: "/home/user",
		})
		expect(env.PATH).toBe("/usr/bin")
		expect(env.HOME).toBe("/home/user")
		for (const key of [
			"ANTHROPIC_API_KEY",
			"OPENROUTER_API_KEY",
			"BYTOS_API_KEY",
			"SOME_TOKEN",
			"GITHUB_TOKEN",
			"DB_PASSWORD",
		]) {
			expect(env[key]).toBeUndefined()
		}
	})

	it("does not mutate the source env", () => {
		const source = { ANTHROPIC_API_KEY: "secret" }
		scrubHelperEnv(source)
		expect(source.ANTHROPIC_API_KEY).toBe("secret")
	})
})
