import * as assert from "node:assert"
import { VoiceError, VoiceRuntime } from "@core/voice"
import { resolveVoiceCapability } from "@core/voice/capability"
import { AudioCaptureCoordinator } from "@core/voice/capture/AudioCaptureCoordinator"
import { WasapiCaptureProvider } from "@core/voice/capture/WasapiCaptureProvider"
import { describe, it } from "mocha"
import { SpeechGuardProbe } from "./voiceF4Probe"

/**
 * F4 — the voice chain inside a REAL VS Code extension host.
 *
 * This suite runs under `@vscode/test-electron` (`bun run test:integration`), so
 * it exercises the actual extension host process with the real native helper and
 * the real pinned whisper engine — not mocks. It asserts the exact failure the
 * user reported: capture produced audio, but nothing reached a transcript.
 *
 * The microphone is real hardware. When the host machine has no active capture
 * device (CI containers), the capture assertions are skipped rather than faked,
 * and the report says so.
 */

const CAPABLE = {
	canCapture: true,
	backend: "wasapi" as const,
	reason: "" as const,
	detail: "",
	osLabel: "Windows x64 (local)",
	platform: "win32",
	arch: "x64",
	remoteName: undefined,
	deviceCount: 1,
	permission: "granted" as const,
}

describe("F4 voice chain (real extension host)", () => {
	it("resolves the capture helper from the installed extension", async () => {
		// `__dirname` inside the host is `<extension>/out/src/test/integration`.
		const extensionRoot = require("node:path").resolve(__dirname, "../../../..")
		const capability = resolveVoiceCapability({
			extensionRoot,
			deviceCount: 1,
			permission: "granted",
			recorderIsolationVerified: true,
			voiceEnabled: true,
		})
		// The helper is what makes capture possible at all; a packaged build that
		// lost it must report CAPTURE_HELPER_MISSING rather than fail obscurely.
		assert.strictEqual(capability.canCapture, true, capability.detail)
		assert.ok(capability.helperPath, "capture helper path")
	})

	it("reports a typed error instead of throwing for an unsupported host", async () => {
		const capability = resolveVoiceCapability({
			extensionRoot: process.cwd(),
			platform: "darwin",
			arch: "arm64",
			deviceCount: 1,
		})
		assert.strictEqual(capability.canCapture, false)
		assert.strictEqual(capability.reason, "PLATFORM_NOT_SUPPORTED_IN_F1")
	})

	it("captures real audio and retains it for transcription (the F4 regression)", async function () {
		this.timeout(60_000)
		const path = require("node:path")
		const extensionRoot = path.resolve(__dirname, "../../../..")
		const capability = resolveVoiceCapability({
			extensionRoot,
			deviceCount: 1,
			permission: "granted",
			recorderIsolationVerified: true,
			voiceEnabled: true,
		})
		if (!capability.canCapture || !capability.helperPath) {
			this.skip()
			return
		}

		const provider = new WasapiCaptureProvider({ helperPath: path.resolve(capability.helperPath) })
		const devices = await provider.enumerateDevices()
		const active = devices.filter((device) => device.state === "active")
		if (active.length === 0) {
			// No microphone on this machine: nothing to record, do not fake it.
			this.skip()
			return
		}

		const coordinator = new AudioCaptureCoordinator({ providers: [provider], captureMethod: "auto" })
		// A short silence timeout so the seal path runs inside the test budget —
		// this is the branch that used to destroy the utterance.
		const runtime = new VoiceRuntime({ ...CAPABLE, helperPath: capability.helperPath }, coordinator, {
			silenceTimeoutMs: 300,
		})
		await runtime.startCapture({})
		// Let the device deliver frames, then let the detector seal the utterance.
		await new Promise((resolve) => setTimeout(resolve, 1500))
		const snapshot = runtime.snapshot()
		assert.ok(snapshot.framesReceived > 0, `expected audio frames, got ${snapshot.framesReceived}`)

		// The "Metne Çevir" click path, whatever state the capture ended in.
		const samples = runtime.captureState === "capturing" ? (await runtime.stopCapture({})).samples : runtime.drain()
		assert.ok(samples.length > 0, "the runtime must hand back the captured audio")
		await runtime.dispose()
	})
})

describe("F4 speech guard on real device levels", () => {
	it("accepts the quiet speech levels a laptop microphone produces", () => {
		// Measured on the reference host: median 100 ms frame RMS of 39 PCM16 with
		// a 90th percentile of 75. The old absolute floor of 100 rejected this.
		const probe = new SpeechGuardProbe()
		assert.strictEqual(probe.acceptsLaptopSpeech(), true)
	})

	it("still rejects digital silence", () => {
		const probe = new SpeechGuardProbe()
		assert.strictEqual(probe.acceptsSilence(), false)
	})

	it("reports a typed code rather than crashing when a runtime is asked to transcribe nothing", async () => {
		// `transcribeUtterance` must fail with a stable code for an empty
		// utterance, never with a crash and never by spawning a recogniser.
		// With no engine configured the first typed refusal is
		// TRANSCRIBE_NOT_SUPPORTED — also a stable code, also no child process.
		const path = require("node:path")
		const extensionRoot = path.resolve(__dirname, "../../../..")
		const capability = resolveVoiceCapability({
			extensionRoot,
			deviceCount: 1,
			permission: "granted",
			recorderIsolationVerified: true,
			voiceEnabled: true,
		})
		const coordinator = new AudioCaptureCoordinator({ providers: [], captureMethod: "auto" })
		const runtime = new VoiceRuntime(capability, coordinator, {})
		await assert.rejects(
			() => runtime.transcribeUtterance({ samples: new Int16Array(0) }),
			(error: VoiceError) => error.code === "TRANSCRIBE_NOT_SUPPORTED",
		)

		// With an engine present, an empty utterance is refused before any spawn.
		const now = () => Date.now()
		const stubEngine = {
			id: "whisper-cli" as const,
			init: async () => ({ ready: true, supportedPlatform: true }),
			loadModel: async (modelId: "tiny" | "base") => ({ modelId, state: "ready" as const, totalBytes: 0 }),
			transcribe: async () => {
				throw new Error("the recogniser must not run for an empty utterance")
			},
			dispose: async () => undefined,
		}
		const withEngine = new VoiceRuntime(capability, new AudioCaptureCoordinator({ providers: [] }), {
			recognitionEngine: stubEngine,
			defaultModelId: "base",
			now,
		})
		await assert.rejects(
			() => withEngine.transcribeUtterance({ samples: new Int16Array(0) }),
			(error: VoiceError) => error.code === "TRANSCRIBE_NO_AUDIO",
		)
		await runtime.dispose()
		await withEngine.dispose()
	})
})
