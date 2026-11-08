import { SILENCE_RMS_MAX_THRESHOLD, SILENCE_RMS_MIN_THRESHOLD, SilenceDetector } from "@core/voice/audio/SilenceDetector"
import { AudioCaptureCoordinator } from "@core/voice/capture/AudioCaptureCoordinator"
import type {
	AudioCaptureProvider,
	CaptureDeviceInfo,
	ProviderProbeResult,
	ProviderStartResult,
	ProviderStopResult,
} from "@core/voice/capture/AudioCaptureProvider"
import { type PcmFrame, type VoiceCapability, VoiceError } from "@core/voice/types"
import { VoiceRuntime } from "@core/voice/VoiceRuntime"
import { describe, expect, it } from "vitest"

class ScriptedProvider implements AudioCaptureProvider {
	readonly id = "wasapi"
	started = 0
	stopped = 0
	cancelled = 0
	disposed = 0
	private listeners = new Set<(frame: PcmFrame) => void>()

	constructor(
		private readonly available = true,
		private readonly startError?: VoiceError,
	) {}

	async isAvailable(): Promise<boolean> {
		return this.available
	}
	async probe(): Promise<ProviderProbeResult> {
		return { available: this.available, permission: "granted", deviceCount: 1, activeDeviceCount: 1 }
	}
	async enumerateDevices(): Promise<CaptureDeviceInfo[]> {
		return []
	}
	async startCapture(): Promise<ProviderStartResult> {
		if (this.startError && this.started === 0) {
			this.started++
			throw this.startError
		}
		this.started++
		return { backend: this.id, sampleRate: 16000, channels: 1, deviceId: "default" }
	}
	async stopCapture(): Promise<ProviderStopResult> {
		this.stopped++
		return { framesReceived: 0, bytesReceived: 0 }
	}
	async cancelCapture(): Promise<void> {
		this.cancelled++
	}
	onFrames(listener: (frame: PcmFrame) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}
	async dispose(): Promise<void> {
		this.disposed++
	}
	emit(samples: Int16Array): void {
		const frame: PcmFrame = { samples, byteLength: samples.length * 2, sampleRate: 16000, channels: 1, timestampMs: 0 }
		for (const listener of this.listeners) listener(frame)
	}
}

const CAPABLE: VoiceCapability = {
	canCapture: true,
	backend: "wasapi",
	reason: "",
	detail: "",
	osLabel: "Windows x64 (local)",
	platform: "win32",
	arch: "x64",
	remoteName: undefined,
	helperPath: "C:\\ext\\helper.exe",
	deviceCount: 1,
	permission: "granted",
}

function build(options: { capability?: Partial<VoiceCapability>; provider?: ScriptedProvider; silenceTimeoutMs?: number } = {}) {
	const provider = options.provider ?? new ScriptedProvider()
	const coordinator = new AudioCaptureCoordinator({ providers: [provider], captureMethod: "auto" })
	const runtime = new VoiceRuntime({ ...CAPABLE, ...options.capability }, coordinator, {
		silenceTimeoutMs: options.silenceTimeoutMs ?? 1200,
		maxDurationMs: 120000,
	})
	return { runtime, coordinator, provider }
}

function speech(samples: number): Int16Array {
	const out = new Int16Array(samples)
	for (let i = 0; i < samples; i++) out[i] = Math.round(Math.sin((2 * Math.PI * 300 * i) / 16000) * 8000)
	return out
}

describe("VoiceRuntime lifecycle", () => {
	it("walks idle → starting → capturing → stopping → idle", async () => {
		const { runtime } = build()
		expect(runtime.captureState).toBe("idle")
		const started = await runtime.startCapture({})
		expect(runtime.captureState).toBe("capturing")
		expect(started.sampleRate).toBe(16000)
		const stopped = await runtime.stopCapture({ reason: "stopped" })
		expect(runtime.captureState).toBe("idle")
		expect(stopped.reason).toBe("stopped")
	})

	it("refuses to start when capability says no", async () => {
		const { runtime } = build({ capability: { canCapture: false, reason: "NO_CAPTURE_DEVICE", backend: "none" } })
		await expect(runtime.startCapture({})).rejects.toMatchObject({ code: "NO_CAPTURE_DEVICE" })
		expect(runtime.captureState).toBe("idle")
	})

	it("refuses to start while recorder isolation is unverified (T1 gate)", async () => {
		const { runtime } = build({ capability: { reason: "RECORDER_ISOLATION_UNVERIFIED" } })
		await expect(runtime.startCapture({})).rejects.toMatchObject({ code: "RECORDER_ISOLATION_UNVERIFIED" })
	})

	it("refuses a second capture while one is running", async () => {
		const { runtime } = build()
		await runtime.startCapture({})
		await expect(runtime.startCapture({})).rejects.toMatchObject({ code: "CAPTURE_ALREADY_ACTIVE" })
		await runtime.dispose()
	})

	it("reports CAPTURE_NOT_ACTIVE when stopping without a session", async () => {
		const { runtime } = build()
		await expect(runtime.stopCapture({})).rejects.toMatchObject({ code: "CAPTURE_NOT_ACTIVE" })
	})

	it("enters failed and leaves no active session when the provider fails to start", async () => {
		const provider = new ScriptedProvider(true, new VoiceError("MICROPHONE_ACCESS_DENIED"))
		const { runtime, coordinator } = build({ provider })
		await expect(runtime.startCapture({})).rejects.toMatchObject({ code: "MICROPHONE_ACCESS_DENIED" })
		expect(runtime.captureState).toBe("failed")
		// The coordinator never marked a session active, so nothing is left dangling.
		expect(coordinator.activeProviderId).toBeUndefined()
		expect(runtime.snapshot().lastErrorCode).toBe("MICROPHONE_ACCESS_DENIED")
		// A failed runtime can be started again (state machine allows failed → idle).
		const retried = await runtime.startCapture({})
		expect(retried.sessionId).toContain("voice-")
		expect(runtime.captureState).toBe("capturing")
		await runtime.cancelCapture()
	})

	it("accumulates frames into the in-memory buffer and exposes counters only", async () => {
		const { runtime, provider } = build()
		await runtime.startCapture({})
		provider.emit(speech(320))
		provider.emit(speech(320))
		const snapshot = runtime.snapshot()
		expect(snapshot.framesReceived).toBe(2)
		expect(snapshot.bytesReceived).toBe(320 * 2 * 2)
		const stopped = await runtime.stopCapture({ reason: "stopped" })
		expect(stopped.samples.length).toBe(640)
		expect(stopped.counters.frames).toBe(2)
	})
})

describe("VoiceRuntime cancel, silence and cleanup", () => {
	it("cancelCapture drops the audio and cancels the provider", async () => {
		const { runtime, provider } = build()
		await runtime.startCapture({})
		provider.emit(speech(1600))
		expect(runtime.snapshot().bytesReceived).toBeGreaterThan(0)
		await runtime.cancelCapture()
		expect(provider.cancelled).toBe(1)
		expect(runtime.captureState).toBe("idle")
		// Nothing is retained after a cancel.
		expect(runtime.drain().length).toBe(0)
		await runtime.dispose()
	})

	it("cancelCapture is safe with no active session", async () => {
		const { runtime, provider } = build()
		await runtime.cancelCapture()
		expect(provider.cancelled).toBe(0)
	})

	it("stops automatically when silence seals the utterance", async () => {
		const { runtime, provider } = build({ silenceTimeoutMs: 40 })
		await runtime.startCapture({})
		provider.emit(speech(320))
		for (let i = 0; i < 10; i++) {
			provider.emit(new Int16Array(320))
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(runtime.captureState).not.toBe("capturing")
		expect(provider.stopped).toBeGreaterThanOrEqual(1)
		await runtime.dispose()
	})

	it("dispose() is idempotent and disposes the provider once", async () => {
		const { runtime, provider } = build()
		await runtime.startCapture({})
		await runtime.dispose()
		await runtime.dispose()
		expect(provider.disposed).toBe(1)
		expect(runtime.captureState).toBe("closed")
	})

	it("refuses to start after dispose", async () => {
		const { runtime } = build()
		await runtime.dispose()
		await expect(runtime.startCapture({})).rejects.toMatchObject({ code: "VOICE_RUNTIME_DISPOSED" })
	})

	it("drops audio that arrives after a stop (no late writes into the buffer)", async () => {
		const { runtime, provider } = build()
		await runtime.startCapture({})
		provider.emit(speech(160))
		await runtime.stopCapture({ reason: "stopped" })
		provider.emit(speech(1600))
		expect(runtime.snapshot().framesReceived).toBe(1)
		await runtime.dispose()
	})

	it("emits status/error events without any audio payload", async () => {
		const { runtime } = build()
		const events: Array<Record<string, unknown>> = []
		runtime.onEvent((event) => events.push(event as unknown as Record<string, unknown>))
		await runtime.startCapture({})
		await runtime.stopCapture({ reason: "stopped" })
		expect(events.map((event) => event.kind)).toContain("captureStatus")
		expect(events.map((event) => event.kind)).toContain("captureStopped")
		for (const event of events) {
			for (const value of Object.values(event)) {
				expect(value).not.toBeInstanceOf(Int16Array)
				expect(value).not.toBeInstanceOf(Uint8Array)
			}
			// Events are JSON-serialisable (ProtoBus-safe) by construction.
			expect(() => JSON.stringify(event)).not.toThrow()
		}
	})
})

/**
 * F4 regression suite — the defect was that a real recording produced no text.
 *
 * The silence detector seals an utterance when the speaker pauses. That seal
 * calls `stopCapture({ reason: "silence" })` internally, so by the time the user
 * presses "Metne Çevir" the runtime is already `idle` and `stopCapture` throws
 * `CAPTURE_NOT_ACTIVE`. The audio used to be dropped at that point, so
 * `transcribeUtterance` fell through to `drain()` and got zero samples: no text,
 * with no error to explain it.
 *
 * These tests pin the two halves of the fix:
 *  1. an AUTOMATIC stop retains the utterance instead of discarding it;
 *  2. an explicit stop / cancel does NOT retain it (no stale audio).
 */
describe("VoiceRuntime retained utterance (F4)", () => {
	it("keeps the audio after a silence seal so Metne Çevir can still transcribe it", async () => {
		const { runtime, provider } = build({ silenceTimeoutMs: 40 })
		await runtime.startCapture({})
		provider.emit(speech(3200))
		for (let i = 0; i < 10; i++) {
			provider.emit(new Int16Array(320))
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		await new Promise((resolve) => setTimeout(resolve, 60))

		// The detector stopped the capture on its own.
		expect(runtime.captureState).not.toBe("capturing")
		expect(runtime.hasPendingUtterance).toBe(true)
		expect(runtime.pendingUtteranceReason).toBe("silence")

		// The "Metne Çevir" click path.
		const samples = runtime.drain()
		expect(samples.length).toBeGreaterThan(0)
		expect(runtime.hasPendingUtterance).toBe(false)
		await runtime.dispose()
	})

	it("does not keep audio after an explicit stop (the caller already has it)", async () => {
		const { runtime, provider } = build()
		await runtime.startCapture({})
		provider.emit(speech(1600))
		const stopped = await runtime.stopCapture({ reason: "stopped" })
		expect(stopped.samples.length).toBeGreaterThan(0)
		// Nothing is retained: the caller got the audio as a return value.
		expect(runtime.hasPendingUtterance).toBe(false)
		expect(runtime.drain().length).toBe(0)
		await runtime.dispose()
	})

	it("drops a retained utterance when the user cancels", async () => {
		const { runtime, provider } = build({ silenceTimeoutMs: 40 })
		await runtime.startCapture({})
		provider.emit(speech(3200))
		for (let i = 0; i < 10; i++) {
			provider.emit(new Int16Array(320))
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		await new Promise((resolve) => setTimeout(resolve, 60))
		expect(runtime.hasPendingUtterance).toBe(true)

		await runtime.cancelCapture()
		// Cancel means "do not transcribe this".
		expect(runtime.hasPendingUtterance).toBe(false)
		expect(runtime.drain().length).toBe(0)
		await runtime.dispose()
	})

	it("a new capture supersedes a retained utterance instead of mixing sessions", async () => {
		const { runtime, provider } = build({ silenceTimeoutMs: 40 })
		await runtime.startCapture({})
		provider.emit(speech(3200))
		for (let i = 0; i < 10; i++) {
			provider.emit(new Int16Array(320))
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		await new Promise((resolve) => setTimeout(resolve, 60))
		expect(runtime.hasPendingUtterance).toBe(true)

		await runtime.startCapture({})
		// The previous recording's audio must not leak into this one.
		expect(runtime.hasPendingUtterance).toBe(false)
		expect(runtime.drain().length).toBe(0)
		await runtime.dispose()
	})

	it("releases a retained utterance on dispose", async () => {
		const { runtime, provider } = build({ silenceTimeoutMs: 40 })
		await runtime.startCapture({})
		provider.emit(speech(3200))
		for (let i = 0; i < 10; i++) {
			provider.emit(new Int16Array(320))
			await new Promise((resolve) => setTimeout(resolve, 10))
		}
		await new Promise((resolve) => setTimeout(resolve, 60))
		expect(runtime.hasPendingUtterance).toBe(true)
		await runtime.dispose()
		expect(runtime.hasPendingUtterance).toBe(false)
	})

	it("honours an explicit silence threshold instead of adapting", async () => {
		// A fixed gate must win over calibration, so a caller that knows its
		// device is not silently overridden.
		const provider = new ScriptedProvider()
		const coordinator = new AudioCaptureCoordinator({ providers: [provider], captureMethod: "auto" })
		const detector = new SilenceDetector({ threshold: 0.01 })
		detector.observeNoiseFloor(0.0001)
		expect(detector.currentThreshold).toBe(0.01)
		expect(detector.measuredNoiseFloor).toBeUndefined()
		await coordinator.dispose()
	})

	it("raises the gate above a loud room tone and keeps it above digital silence", () => {
		const quiet = new SilenceDetector()
		quiet.observeNoiseFloor(0) // digital silence
		expect(quiet.currentThreshold).toBeCloseTo(SILENCE_RMS_MIN_THRESHOLD, 10)

		const noisy = new SilenceDetector()
		noisy.observeNoiseFloor(0.01) // measured room tone ≈ 328 PCM16
		expect(noisy.currentThreshold).toBeGreaterThan(0.01)
		expect(noisy.currentThreshold).toBeLessThanOrEqual(SILENCE_RMS_MAX_THRESHOLD)

		const absurd = new SilenceDetector()
		absurd.observeNoiseFloor(0.5)
		expect(absurd.currentThreshold).toBe(SILENCE_RMS_MAX_THRESHOLD)
	})
})
