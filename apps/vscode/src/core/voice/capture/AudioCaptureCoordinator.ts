import { LinearResampler } from "../audio/resample"
import { type PcmFrame, VOICE_BYTES_PER_SAMPLE, VOICE_CHANNELS, VOICE_SAMPLE_RATE, VoiceError } from "../types"
import type { AudioCaptureProvider, CaptureDeviceInfo, ProviderProbeResult, ProviderStartResult } from "./AudioCaptureProvider"

/**
 * Selection and fallback ONLY (TD-16). The coordinator decides which provider
 * wins; providers report what they can do and what they observed. Keeping the
 * policy here makes it unit-testable in isolation.
 *
 * F1 ships exactly one provider (WASAPI). The resolver is written as a list so a
 * later phase can add a backend without touching call sites, but a manual pin is
 * NEVER silently overridden: if the pinned provider is unavailable the
 * coordinator fails with a typed error instead of quietly using another one.
 */

export type CaptureMethod = "auto" | "wasapi"

export interface CoordinatorOptions {
	providers: AudioCaptureProvider[]
	/** Persisted preference; "auto" picks the first available provider. */
	captureMethod?: CaptureMethod | string
	/** Persisted device pin. */
	microphoneId?: string
}

export interface SelectedProvider {
	provider: AudioCaptureProvider
	pinned: boolean
}

export class AudioCaptureCoordinator {
	private readonly providers: AudioCaptureProvider[]
	private readonly captureMethod: string
	private readonly microphoneId: string | undefined
	private active: AudioCaptureProvider | undefined

	constructor(options: CoordinatorOptions) {
		this.providers = options.providers
		this.captureMethod = options.captureMethod ?? "auto"
		this.microphoneId = options.microphoneId
	}

	get activeProviderId(): string | undefined {
		return this.active?.id
	}

	/** Providers that report themselves available (cheap check, no spawn). */
	async availableProviders(): Promise<AudioCaptureProvider[]> {
		const available: AudioCaptureProvider[] = []
		for (const provider of this.providers) {
			if (await provider.isAvailable()) {
				available.push(provider)
			}
		}
		return available
	}

	/**
	 * Resolve the provider to use.
	 *  - pinned ("wasapi"): must exist and be available, else CAPTURE_METHOD_NOT_SUPPORTED
	 *  - automatic ("auto"): first available provider, else the first provider's
	 *    missing-helper error
	 */
	async resolveProvider(): Promise<SelectedProvider> {
		if (this.captureMethod !== "auto") {
			const pinned = this.providers.find((provider) => provider.id === this.captureMethod)
			if (!pinned) {
				throw new VoiceError("CAPTURE_METHOD_NOT_SUPPORTED", `Unknown capture method: ${this.captureMethod}`)
			}
			if (!(await pinned.isAvailable())) {
				// Never silently fall back: the user pinned this backend on purpose.
				throw new VoiceError(
					"CAPTURE_METHOD_NOT_SUPPORTED",
					`Pinned capture method ${this.captureMethod} is not available`,
				)
			}
			return { provider: pinned, pinned: true }
		}
		const available = await this.availableProviders()
		if (available.length === 0) {
			throw new VoiceError("CAPTURE_HELPER_MISSING")
		}
		return { provider: available[0], pinned: false }
	}

	async probe(): Promise<{ provider: string; result: ProviderProbeResult }> {
		const selected = await this.resolveProvider()
		return { provider: selected.provider.id, result: await selected.provider.probe() }
	}

	async listDevices(): Promise<{ provider: string; devices: CaptureDeviceInfo[] }> {
		const selected = await this.resolveProvider()
		return { provider: selected.provider.id, devices: await selected.provider.enumerateDevices() }
	}

	/** Start capture on the resolved provider, pinned to the configured device. */
	async start(options: { deviceId?: string; signal?: AbortSignal } = {}): Promise<ProviderStartResult> {
		if (this.active) {
			throw new VoiceError("CAPTURE_ALREADY_ACTIVE")
		}
		const selected = await this.resolveProvider()
		const deviceId = options.deviceId ?? this.microphoneId
		const result = await selected.provider.startCapture({ deviceId, signal: options.signal })
		this.active = selected.provider
		return result
	}

	async stop(): Promise<{ framesReceived: number; bytesReceived: number }> {
		const provider = this.active
		if (!provider) {
			throw new VoiceError("CAPTURE_NOT_ACTIVE")
		}
		try {
			return await provider.stopCapture()
		} finally {
			this.active = undefined
		}
	}

	async cancel(): Promise<void> {
		const provider = this.active
		this.active = undefined
		if (!provider) return
		await provider.cancelCapture()
	}

	onFrames(listener: (frame: PcmFrame) => void): () => void {
		// Attach to every provider so a future fallback swap cannot silence the stream.
		const unsubscribers = this.providers.map((provider) => provider.onFrames(listener))
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe()
		}
	}

	async dispose(): Promise<void> {
		this.active = undefined
		await Promise.all(this.providers.map((provider) => provider.dispose()))
	}
}

/**
 * Normalise an arbitrary PCM16 chunk into the F1 contract. Providers are
 * expected to already emit 16 kHz mono, but downmix/resample is applied here so
 * a provider bug degrades into correct-but-slower audio, not corrupt audio.
 */
export class FrameNormaliser {
	private resampler = new LinearResampler(VOICE_SAMPLE_RATE)

	normalise(frame: PcmFrame): PcmFrame {
		let samples = frame.samples
		if (frame.channels > 1) {
			const frames = Math.floor(samples.length / frame.channels)
			const mono = new Int16Array(frames)
			for (let i = 0; i < frames; i++) {
				let sum = 0
				const base = i * frame.channels
				for (let c = 0; c < frame.channels; c++) sum += samples[base + c]
				mono[i] = Math.round(sum / frame.channels)
			}
			samples = mono
		}
		if (frame.sampleRate !== VOICE_SAMPLE_RATE) {
			this.resampler.reset(frame.sampleRate)
			const floats = new Float32Array(samples.length)
			for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768
			this.resampler.push(floats)
			const out = this.resampler.drain()
			const resampled = new Int16Array(out.length)
			for (let i = 0; i < out.length; i++) {
				const clamped = Math.max(-1, Math.min(1, out[i]))
				resampled[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
			}
			samples = resampled
		}
		return {
			samples,
			byteLength: samples.length * VOICE_BYTES_PER_SAMPLE,
			sampleRate: VOICE_SAMPLE_RATE,
			channels: VOICE_CHANNELS,
			timestampMs: frame.timestampMs,
		}
	}
}
