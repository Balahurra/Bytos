/**
 * Sample-format normalisation to the F1 contract: 16 kHz mono PCM16.
 *
 * Device mix formats on Windows are commonly 48 kHz stereo 32-bit float
 * (measured in F0), so the host owns downmix and conversion explicitly instead
 * of relying on whatever the OS pipeline happens to do. Everything here is pure
 * and allocation-bounded — the output is dropped by the caller after it reaches
 * the utterance buffer.
 */
import { resampleAll } from "./resample"

/** Convert a float sample in [-1, 1] to PCM16 with clamping. */
export function floatToPcm16(sample: number): number {
	if (!Number.isFinite(sample)) return 0
	const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
	// Asymmetric scaling: -1.0 → -32768, 1.0 → 32767.
	return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
}

function int24ToFloat(bytes: Uint8Array, offset: number): number {
	let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
	if (value & 0x800000) value |= 0xff000000
	return value / 8388608
}

function int32ToFloat(value: number, validBits = 32): number {
	const shift = validBits > 0 && validBits < 32 ? 32 - validBits : 0
	return (value >> shift) / 2147483648
}

type SampleFormat = "s16" | "s24" | "s32" | "f32"

export interface DeviceMixFormat {
	sampleRate: number
	channels: number
	format: SampleFormat
	/** Valid bits for 32-bit containers. */
	validBits?: number
}

/**
 * Interleaved device frames → mono, by AVERAGING the channels.
 *
 * Averaging, never summing: summing two correlated channels clips at half
 * scale, which destroys audio before it ever reaches the recogniser.
 */
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
	if (channels <= 1) return interleaved
	if (interleaved.length % channels !== 0) {
		// Drop a partial trailing frame rather than reading past the end.
		const usable = Math.floor(interleaved.length / channels) * channels
		interleaved = interleaved.subarray(0, usable)
	}
	const frames = interleaved.length / channels
	const mono = new Float32Array(frames)
	const scale = 1 / channels
	for (let i = 0; i < frames; i++) {
		let sum = 0
		const base = i * channels
		for (let c = 0; c < channels; c++) {
			sum += interleaved[base + c]
		}
		mono[i] = sum * scale
	}
	return mono
}

/**
 * Decode arbitrary PCM/float bytes into interleaved float samples.
 */
export function decodeToFloat(bytes: Uint8Array, format: DeviceMixFormat): Float32Array {
	const bytesPerSample = format.format === "s16" ? 2 : format.format === "s24" ? 3 : 4
	const total = Math.floor(bytes.length / bytesPerSample)
	const out = new Float32Array(total)
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	for (let i = 0; i < total; i++) {
		if (format.format === "s16") {
			out[i] = view.getInt16(i * 2, true) / 32768
		} else if (format.format === "s24") {
			out[i] = int24ToFloat(bytes, i * 3)
		} else if (format.format === "s32") {
			out[i] = int32ToFloat(view.getInt32(i * 4, true), format.validBits ?? 32)
		} else {
			out[i] = view.getFloat32(i * 4, true)
		}
	}
	return out
}

/** mono float samples → PCM16 (clamped). */
export function monoFloatToPcm16(samples: Float32Array): Int16Array {
	const out = new Int16Array(samples.length)
	for (let i = 0; i < samples.length; i++) {
		out[i] = floatToPcm16(samples[i])
	}
	return out
}

/**
 * One-shot normalisation: device bytes → 16 kHz mono PCM16.
 * The stateful `LinearResampler` is used by the streaming path; this helper is for
 * callers that already hold a complete buffer (tests, diagnostics).
 */
export function normaliseToPcm16(bytes: Uint8Array, format: DeviceMixFormat, targetRate: number): Int16Array {
	const interleaved = decodeToFloat(bytes, format)
	const mono = downmixToMono(interleaved, format.channels)
	if (format.sampleRate === targetRate) {
		return monoFloatToPcm16(mono)
	}
	return monoFloatToPcm16(resampleAll(mono, format.sampleRate, targetRate))
}
