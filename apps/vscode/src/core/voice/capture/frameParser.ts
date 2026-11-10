/**
 * Length-prefixed binary frame decoder for the native helper's stdout.
 *
 * Wire format (see `native/voice-helper-windows/bv-os-audio-helper.cpp`):
 *   uint32 length          payload bytes that follow the header (little-endian)
 *   uint16 formatTag       1 = WAVE_FORMAT_PCM
 *   uint32 sampleRate      Hz
 *   uint16 channels
 *   uint16 bitsPerSample   16
 *   uint8[length]          payload (PCM16 LE)
 *
 * The parser is pure and stateful across chunks only in the buffering sense: it
 * accepts arbitrary re-chunking (partial headers, several frames per chunk, one
 * frame split across chunks) and never throws out of `push()` for corrupt input —
 * it raises `CAPTURE_FRAME_CORRUPT` through its `onError` callback and skips the
 * bad bytes so one corrupt length cannot take the capture down.
 *
 * Bytes never leave memory: the only sink is the utterance buffer.
 */

export const FRAME_HEADER_BYTES = 14
const FORMAT_TAG_PCM = 1
/** Anything above this is treated as a corrupt length, not an allocation request. */
const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024

export interface DecodedFrame {
	formatTag: number
	sampleRate: number
	channels: number
	bitsPerSample: number
	payload: Uint8Array
}

export interface FrameParserOptions {
	onFrame: (frame: DecodedFrame) => void
	onError?: (code: "CAPTURE_FRAME_CORRUPT" | "CAPTURE_FRAME_TOO_LARGE", detail: string) => void
	maxPayloadBytes?: number
}

export class FrameParser {
	private buffer: Uint8Array = new Uint8Array(0)
	private readonly maxPayloadBytes: number

	constructor(private readonly options: FrameParserOptions) {
		this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_FRAME_PAYLOAD_BYTES
	}

	/** Number of buffered bytes not yet consumed (diagnostics only). */
	get bufferedBytes(): number {
		return this.buffer.length
	}

	push(chunk: Uint8Array): void {
		if (chunk.length === 0) return
		this.buffer = this.buffer.length === 0 ? chunk : concat(this.buffer, chunk)
		this.drain()
	}

	reset(): void {
		this.buffer = new Uint8Array(0)
	}

	private drain(): void {
		while (this.buffer.length >= FRAME_HEADER_BYTES) {
			const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength)
			const length = view.getUint32(0, true)
			if (length > this.maxPayloadBytes) {
				this.options.onError?.("CAPTURE_FRAME_TOO_LARGE", `payload length ${length} exceeds cap`)
				// The stream is unrecoverable here: drop everything we have and let
				// the provider report a typed failure to the coordinator.
				this.buffer = new Uint8Array(0)
				return
			}
			if (this.buffer.length < FRAME_HEADER_BYTES + length) {
				return // wait for more bytes
			}
			const formatTag = view.getUint16(4, true)
			const sampleRate = view.getUint32(6, true)
			const channels = view.getUint16(10, true)
			const bitsPerSample = view.getUint16(12, true)
			const payload = this.buffer.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length)
			this.buffer = this.buffer.subarray(FRAME_HEADER_BYTES + length)

			if (formatTag !== FORMAT_TAG_PCM || bitsPerSample !== 16 || channels < 1 || channels > 2) {
				this.options.onError?.(
					"CAPTURE_FRAME_CORRUPT",
					`unexpected format tag=${formatTag} bits=${bitsPerSample} channels=${channels}`,
				)
				continue
			}
			if (sampleRate === 0 || sampleRate > 192000) {
				this.options.onError?.("CAPTURE_FRAME_CORRUPT", `implausible sample rate ${sampleRate}`)
				continue
			}
			if (length % (2 * channels) !== 0) {
				this.options.onError?.("CAPTURE_FRAME_CORRUPT", `payload length ${length} is not a whole sample count`)
				continue
			}
			this.options.onFrame({ formatTag, sampleRate, channels, bitsPerSample, payload })
		}
	}
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const merged = new Uint8Array(a.length + b.length)
	merged.set(a, 0)
	merged.set(b, a.length)
	return merged
}

/** Convenience: PCM16 little-endian payload → Int16Array view (copied). */
export function payloadToInt16(payload: Uint8Array): Int16Array {
	const sampleCount = Math.floor(payload.length / 2)
	const out = new Int16Array(sampleCount)
	const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
	for (let i = 0; i < sampleCount; i++) {
		out[i] = view.getInt16(i * 2, true)
	}
	return out
}
