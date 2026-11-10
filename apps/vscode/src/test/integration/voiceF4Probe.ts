/**
 * Thin probe over the real speech guard, so the integration suite asserts on
 * production behaviour rather than re-implementing the thresholds.
 */
import { containsSpeech } from "@core/voice/transcription/speechGuard"

/** Builds a frame sequence at a given 100 ms level, with speech-like variance. */
function frames(levels: readonly number[]): Int16Array {
	const perFrame = 1600
	const samples = new Int16Array(perFrame * levels.length)
	let seed = 424242
	for (let frame = 0; frame < levels.length; frame++) {
		for (let i = 0; i < perFrame; i++) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff
			const noise = (seed / 0x7fffffff) * 2 - 1
			samples[frame * perFrame + i] = Math.round(noise * levels[frame] * 1.732)
		}
	}
	return samples
}

export class SpeechGuardProbe {
	/** Real-device speech levels measured on the reference host. */
	acceptsLaptopSpeech(): boolean {
		const levels = [...Array(10).fill(20), ...Array(35).fill(40), ...Array(12).fill(70)]
		return containsSpeech(frames(levels))
	}

	acceptsSilence(): boolean {
		return containsSpeech(new Int16Array(16000 * 3))
	}
}
