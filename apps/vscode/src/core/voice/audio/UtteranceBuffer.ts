import { VOICE_BYTES_PER_SAMPLE, VOICE_SAMPLE_RATE } from "../types"

export interface UtteranceBufferOptions {
	/** Hard cap on utterance length. Default 120 s. */
	maxDurationMs?: number
	/** Hard cap on bytes held. Default 8 MB (≈ 4 minutes of 16 kHz mono PCM16). */
	maxBytes?: number
}

export interface AppendResult {
	accepted: boolean
	truncated: boolean
	/** True once the buffer has hit a cap and refuses further audio. */
	sealed: boolean
}

/**
 * Bounded in-memory accumulation of one utterance (16 kHz mono PCM16).
 *
 * Rules:
 *  - never grows past `maxDurationMs` / `maxBytes`;
 *  - on overflow it TRUNCATES and reports it (`truncated`) — it never silently
 *    drops the overflow, and it never keeps growing;
 *  - holds audio only in memory; there is no file sink anywhere in this class.
 */
export class UtteranceBuffer {
	private chunks: Int16Array[] = []
	private byteCount = 0
	private sampleCount = 0
	private truncated = false
	private sealed = false
	private readonly maxBytes: number
	private readonly maxSamples: number

	constructor(options: UtteranceBufferOptions = {}) {
		const maxDurationMs = options.maxDurationMs ?? 120000
		this.maxSamples = Math.floor((maxDurationMs / 1000) * VOICE_SAMPLE_RATE)
		this.maxBytes = Math.min(options.maxBytes ?? 8 * 1024 * 1024, this.maxSamples * VOICE_BYTES_PER_SAMPLE)
	}

	get bytes(): number {
		return this.byteCount
	}

	get samples(): number {
		return this.sampleCount
	}

	get durationMs(): number {
		return (this.sampleCount / VOICE_SAMPLE_RATE) * 1000
	}

	get isTruncated(): boolean {
		return this.truncated
	}

	get isSealed(): boolean {
		return this.sealed
	}

	get isFull(): boolean {
		return this.sealed
	}

	append(samples: Int16Array): AppendResult {
		if (this.sealed) {
			return { accepted: false, truncated: true, sealed: true }
		}
		const roomSamples = this.maxSamples - this.sampleCount
		const roomBytes = Math.floor((this.maxBytes - this.byteCount) / VOICE_BYTES_PER_SAMPLE)
		const room = Math.min(roomSamples, roomBytes)
		if (room <= 0) {
			this.sealed = true
			this.truncated = true
			return { accepted: false, truncated: true, sealed: true }
		}
		if (samples.length <= room) {
			this.chunks.push(samples.slice())
			this.sampleCount += samples.length
			this.byteCount += samples.length * VOICE_BYTES_PER_SAMPLE
			const nowFull = this.sampleCount >= this.maxSamples || this.byteCount >= this.maxBytes
			if (nowFull) this.sealed = true
			return { accepted: true, truncated: false, sealed: this.sealed }
		}
		// Partial accept: keep exactly what fits, report the truncation.
		const kept = samples.slice(0, room)
		this.chunks.push(kept)
		this.sampleCount += kept.length
		this.byteCount += kept.length * VOICE_BYTES_PER_SAMPLE
		this.truncated = true
		this.sealed = true
		return { accepted: true, truncated: true, sealed: true }
	}

	/** Concatenated PCM16 for the current utterance (a copy). */
	toInt16Array(): Int16Array {
		const out = new Int16Array(this.sampleCount)
		let offset = 0
		for (const chunk of this.chunks) {
			out.set(chunk, offset)
			offset += chunk.length
		}
		return out
	}

	/** Drop all audio and release it. Nothing is retained "just in case". */
	clear(): void {
		this.chunks = []
		this.byteCount = 0
		this.sampleCount = 0
		this.truncated = false
		this.sealed = false
	}
}
