import { VOICE_SAMPLE_RATE } from "../types"

/**
 * RMS silence gate (TD-6R). Silence detection lives in the host, next to the
 * audio buffer, not in the webview.
 *
 * Behaviour: while speech is present the detector stays "open"; once the level
 * drops to the noise floor for `timeoutMs` it emits exactly ONE seal per speech
 * burst. Pure silence from the start emits nothing — there is no burst to seal.
 *
 * ## Why the gate is relative, not one fixed number (F4 regression)
 *
 * The gate used to be a single absolute value (0.0056, ≈ −45 dBFS). Measured on
 * the reference laptop's built-in microphone array, real speech carried a
 * 100 ms frame RMS of ≈ 20–203 PCM16 while room tone sat at ≈ 21–23 and digital
 * silence at 0 — so *no single absolute number* separates speech from silence
 * across devices, positions and input gains. The fixed gate classified normal
 * speech as silence, sealed the utterance after ~1.8 s, and `VoiceRuntime`
 * discarded the audio; "Metne Çevir" then had nothing to transcribe and the
 * composer never received text.
 *
 * The detector therefore learns the noise floor from the audio it is given
 * ({@link SilenceDetector.observeNoiseFloor}) and gates at a margin above it,
 * clamped between {@link SILENCE_RMS_MIN_THRESHOLD} and
 * {@link SILENCE_RMS_MAX_THRESHOLD}. A device with a loud room tone raises the
 * gate; a quiet one lowers it. Digital silence keeps the minimum, so a genuinely
 * silent microphone still never produces text.
 */

export interface SilenceDetectorOptions {
	/** Silence duration that seals a burst. */
	timeoutMs?: number
	/**
	 * Absolute gate on the −1..1 scale. When supplied, adaptive calibration is
	 * skipped entirely — used by tests and by callers that already know the floor.
	 */
	threshold?: number
	/** Frames below the gate before a burst can start (noise immunity). */
	minSpeechFrames?: number
	/**
	 * Multiplier applied to the measured noise floor to obtain the gate.
	 * 2.5× is ≈ +8 dB: real speech on the reference device is 3–10× its floor.
	 */
	noiseFloorMultiplier?: number
}

/**
 * Lowest gate the detector will ever use (0.0008 ≈ 26 PCM16).
 *
 * Below this, digital silence and the quietest room tone would both read as
 * speech. It stays at the level where a truly silent microphone is still
 * correctly classified as silent.
 */
export const SILENCE_RMS_MIN_THRESHOLD = 0.0008

/**
 * Highest gate adaptive calibration will reach (0.02 ≈ 655 PCM16).
 *
 * A noisy room can legitimately raise the floor, but the gate must never climb
 * so high that it swallows a normal speaking voice.
 */
export const SILENCE_RMS_MAX_THRESHOLD = 0.02

/**
 * Default gate before any calibration: the minimum. Callers that measure the
 * floor first (`VoiceRuntime`) replace this via `observeNoiseFloor`.
 */
export const SILENCE_RMS_THRESHOLD_NORMALISED = SILENCE_RMS_MIN_THRESHOLD

/** PCM16 equivalent of {@link SILENCE_RMS_THRESHOLD_NORMALISED}, for reporting. */
export const SILENCE_RMS_THRESHOLD_PCM16 = Math.round(SILENCE_RMS_THRESHOLD_NORMALISED * 32768)

export interface SilenceUpdate {
	/** True exactly once, when a speech burst ends. */
	sealed: boolean
	rms: number
	speech: boolean
}

export class SilenceDetector {
	private readonly timeoutMs: number
	private readonly minSpeechFrames: number
	private readonly noiseFloorMultiplier: number
	private readonly fixedThreshold: number | undefined

	/** The gate actually in force, updated by `observeNoiseFloor`. */
	private threshold: number
	private noiseFloor: number | undefined

	private speechFrames = 0
	private silenceMs = 0
	private burstActive = false
	private sealedForBurst = false

	constructor(options: SilenceDetectorOptions = {}) {
		this.timeoutMs = options.timeoutMs ?? 1200
		this.fixedThreshold = options.threshold
		this.noiseFloorMultiplier = options.noiseFloorMultiplier ?? 2.5
		this.threshold = options.threshold ?? SILENCE_RMS_THRESHOLD_NORMALISED
		this.minSpeechFrames = options.minSpeechFrames ?? 1
	}

	get isBurstActive(): boolean {
		return this.burstActive
	}

	/** The gate currently in force, on the −1..1 scale. */
	get currentThreshold(): number {
		return this.threshold
	}

	/** The measured noise floor, once one has been observed. */
	get measuredNoiseFloor(): number | undefined {
		return this.noiseFloor
	}

	/**
	 * Learns the room-tone floor from an observed RMS sample (the quietest frames
	 * of the current session) and moves the gate a margin above it.
	 *
	 * Ignored when a fixed `threshold` was supplied, so an explicit gate always
	 * wins. The result is clamped to
	 * [{@link SILENCE_RMS_MIN_THRESHOLD}, {@link SILENCE_RMS_MAX_THRESHOLD}], so a
	 * mis-measured floor can never disable silence detection entirely.
	 */
	observeNoiseFloor(floorRms: number): void {
		if (this.fixedThreshold !== undefined) return
		if (!Number.isFinite(floorRms) || floorRms < 0) return
		this.noiseFloor = floorRms
		const target = floorRms * this.noiseFloorMultiplier
		this.threshold = Math.min(SILENCE_RMS_MAX_THRESHOLD, Math.max(SILENCE_RMS_MIN_THRESHOLD, target))
	}

	reset(): void {
		this.speechFrames = 0
		this.silenceMs = 0
		this.burstActive = false
		this.sealedForBurst = false
	}

	/**
	 * Feed one PCM16 chunk. `durationMs` defaults to the chunk's real duration at
	 * 16 kHz mono, which keeps the timeout accurate regardless of chunk size.
	 */
	update(samples: Int16Array, durationMs?: number): SilenceUpdate {
		const rms = computeRms(samples)
		const speech = rms >= this.threshold
		const elapsed = durationMs ?? (samples.length / VOICE_SAMPLE_RATE) * 1000

		if (speech) {
			this.speechFrames++
			this.silenceMs = 0
			if (this.speechFrames >= this.minSpeechFrames && !this.burstActive) {
				this.burstActive = true
				this.sealedForBurst = false
			}
			return { sealed: false, rms, speech }
		}

		// Below the gate.
		this.speechFrames = 0
		if (!this.burstActive) {
			return { sealed: false, rms, speech }
		}
		this.silenceMs += elapsed
		if (this.silenceMs >= this.timeoutMs && !this.sealedForBurst) {
			this.sealedForBurst = true
			this.burstActive = false
			return { sealed: true, rms, speech }
		}
		return { sealed: false, rms, speech }
	}
}

/** RMS of a PCM16 chunk on the −1..1 scale. */
function computeRms(samples: Int16Array): number {
	if (samples.length === 0) return 0
	let sumSquares = 0
	for (let i = 0; i < samples.length; i++) {
		const value = samples[i] / 32768
		sumSquares += value * value
	}
	return Math.sqrt(sumSquares / samples.length)
}
