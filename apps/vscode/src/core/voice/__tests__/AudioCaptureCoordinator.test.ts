import { AudioCaptureCoordinator, FrameNormaliser } from "@core/voice/capture/AudioCaptureCoordinator"
import type {
	AudioCaptureProvider,
	CaptureDeviceInfo,
	ProviderProbeResult,
	ProviderStartOptions,
	ProviderStartResult,
	ProviderStopResult,
} from "@core/voice/capture/AudioCaptureProvider"
import { type PcmFrame, VoiceError } from "@core/voice/types"
import { describe, expect, it } from "vitest"

/** Minimal in-memory provider so the coordinator policy is tested in isolation. */
class FakeProvider implements AudioCaptureProvider {
	started = 0
	stopped = 0
	cancelled = 0
	disposed = 0
	listeners = new Set<(frame: PcmFrame) => void>()

	constructor(
		readonly id: string,
		private readonly available: boolean,
	) {}

	async isAvailable(): Promise<boolean> {
		return this.available
	}

	async probe(): Promise<ProviderProbeResult> {
		return { available: this.available, permission: "granted", deviceCount: 1, activeDeviceCount: 1 }
	}

	async enumerateDevices(): Promise<CaptureDeviceInfo[]> {
		return [{ id: `${this.id}-mic`, name: `${this.id} microphone`, state: "active", isDefault: true }]
	}

	async startCapture(_options: ProviderStartOptions): Promise<ProviderStartResult> {
		this.started++
		return { backend: this.id, sampleRate: 16000, channels: 1, deviceId: "default" }
	}

	async stopCapture(): Promise<ProviderStopResult> {
		this.stopped++
		return { framesReceived: 1, bytesReceived: 2 }
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

	emit(samples: Int16Array, sampleRate = 16000, channels = 1): void {
		const frame: PcmFrame = { samples, byteLength: samples.length * 2, sampleRate, channels, timestampMs: 0 }
		for (const listener of this.listeners) listener(frame)
	}
}

describe("AudioCaptureCoordinator selection", () => {
	it("picks the first available provider in automatic mode", async () => {
		const coordinator = new AudioCaptureCoordinator({
			providers: [new FakeProvider("wasapi", false), new FakeProvider("other", true)],
			captureMethod: "auto",
		})
		const selected = await coordinator.resolveProvider()
		expect(selected.provider.id).toBe("other")
		expect(selected.pinned).toBe(false)
	})

	it("fails with a typed error when nothing is available", async () => {
		const coordinator = new AudioCaptureCoordinator({
			providers: [new FakeProvider("wasapi", false)],
			captureMethod: "auto",
		})
		await expect(coordinator.resolveProvider()).rejects.toMatchObject({ code: "CAPTURE_HELPER_MISSING" })
	})

	it("honours a manual pin when the provider is available", async () => {
		const coordinator = new AudioCaptureCoordinator({
			providers: [new FakeProvider("wasapi", true)],
			captureMethod: "wasapi",
		})
		const selected = await coordinator.resolveProvider()
		expect(selected.provider.id).toBe("wasapi")
		expect(selected.pinned).toBe(true)
	})

	it("NEVER silently overrides a manual pin that is unavailable", async () => {
		const other = new FakeProvider("other", true)
		const coordinator = new AudioCaptureCoordinator({
			providers: [other, new FakeProvider("wasapi", false)],
			captureMethod: "wasapi",
		})
		await expect(coordinator.resolveProvider()).rejects.toMatchObject({ code: "CAPTURE_METHOD_NOT_SUPPORTED" })
		expect(other.started).toBe(0)
	})

	it("rejects an unknown capture method instead of guessing", async () => {
		const coordinator = new AudioCaptureCoordinator({
			providers: [new FakeProvider("wasapi", true)],
			captureMethod: "coreaudio",
		})
		await expect(coordinator.resolveProvider()).rejects.toBeInstanceOf(VoiceError)
	})
})

describe("AudioCaptureCoordinator lifecycle", () => {
	it("routes start/stop to the selected provider and refuses double starts", async () => {
		const wasapi = new FakeProvider("wasapi", true)
		const coordinator = new AudioCaptureCoordinator({ providers: [wasapi], captureMethod: "auto" })
		await coordinator.start({ deviceId: "mic-1" })
		expect(wasapi.started).toBe(1)
		expect(coordinator.activeProviderId).toBe("wasapi")
		await expect(coordinator.start({})).rejects.toMatchObject({ code: "CAPTURE_ALREADY_ACTIVE" })
		await coordinator.stop()
		expect(wasapi.stopped).toBe(1)
		expect(coordinator.activeProviderId).toBeUndefined()
	})

	it("reports CAPTURE_NOT_ACTIVE when stopping with no session", async () => {
		const coordinator = new AudioCaptureCoordinator({ providers: [new FakeProvider("wasapi", true)] })
		await expect(coordinator.stop()).rejects.toMatchObject({ code: "CAPTURE_NOT_ACTIVE" })
	})

	it("cancel is a no-op without a session and cancels an active one", async () => {
		const wasapi = new FakeProvider("wasapi", true)
		const coordinator = new AudioCaptureCoordinator({ providers: [wasapi] })
		await coordinator.cancel()
		expect(wasapi.cancelled).toBe(0)
		await coordinator.start({})
		await coordinator.cancel()
		expect(wasapi.cancelled).toBe(1)
	})

	it("dispose() disposes every provider", async () => {
		const a = new FakeProvider("wasapi", true)
		const b = new FakeProvider("other", true)
		const coordinator = new AudioCaptureCoordinator({ providers: [a, b] })
		await coordinator.dispose()
		expect(a.disposed).toBe(1)
		expect(b.disposed).toBe(1)
	})

	it("subscribes frame listeners to every provider", async () => {
		const a = new FakeProvider("wasapi", true)
		const b = new FakeProvider("other", true)
		const coordinator = new AudioCaptureCoordinator({ providers: [a, b] })
		const received: string[] = []
		const unsubscribe = coordinator.onFrames((frame) => received.push(`${frame.samples[0]}`))
		a.emit(new Int16Array([1]))
		b.emit(new Int16Array([2]))
		unsubscribe()
		a.emit(new Int16Array([3]))
		expect(received).toEqual(["1", "2"])
	})
})

describe("FrameNormaliser", () => {
	const normaliser = new FrameNormaliser()
	const frame = (samples: Int16Array, sampleRate: number, channels: number): PcmFrame => ({
		samples,
		byteLength: samples.length * 2,
		sampleRate,
		channels,
		timestampMs: 0,
	})

	it("passes a 16 kHz mono frame through", () => {
		const out = normaliser.normalise(frame(new Int16Array([100, -100]), 16000, 1))
		expect(out.sampleRate).toBe(16000)
		expect(out.channels).toBe(1)
		expect(Array.from(out.samples)).toEqual([100, -100])
	})

	it("downmixes stereo by averaging", () => {
		const out = normaliser.normalise(frame(new Int16Array([100, 100, -100, -100]), 16000, 2))
		expect(out.channels).toBe(1)
		expect(Array.from(out.samples)).toEqual([100, -100])
	})

	it("resamples 48 kHz to 16 kHz, one third the sample count", () => {
		const samples = new Int16Array(4800)
		for (let i = 0; i < samples.length; i++) {
			samples[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / 48000) * 10000)
		}
		const out = normaliser.normalise(frame(samples, 48000, 1))
		expect(out.sampleRate).toBe(16000)
		expect(Math.abs(out.samples.length - 1600)).toBeLessThanOrEqual(1)
	})
})
