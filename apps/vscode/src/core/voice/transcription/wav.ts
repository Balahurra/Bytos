import { VOICE_BYTES_PER_SAMPLE, VOICE_CHANNELS, VOICE_SAMPLE_RATE, VoiceError } from "../types"

/**
 * In-memory RIFF/WAVE wrapper for the F1 utterance (F2, TD-13).
 *
 * ## Why a header is needed at all
 *
 * `whisper-cli` pipes stdin into `miniaudio`, which is a *container* decoder:
 * it needs to know the sample rate, channel count and sample format. Measured on
 * the pinned `b5454` build, raw PCM16 on stdin fails with
 * `read_audio_data: failed to open audio data from stdin (Invalid argument)`.
 * A 44-byte RIFF header is what makes the same bytes decodable.
 *
 * The header is built **in memory and streamed immediately** to the child's
 * stdin. No file is created, no temp path exists, and the buffer is released as
 * soon as the write completes — so TD-13 ("no audio on disk") still holds even
 * though the engine sees a WAV.
 *
 * The output is deterministic for a given input, which is what the tests pin.
 */

/** Canonical PCM WAV header size for a 16-bit mono file. */
export const WAV_HEADER_BYTES = 44

/** True when `samples` can be handed to whisper unchanged. */
export function isTranscribable(samples: Int16Array): boolean {
	return samples instanceof Int16Array && samples.length > 0
}

/**
 * Builds a 44-byte RIFF/WAVE header for `dataBytes` of PCM16 mono audio at
 * `sampleRate`. Kept separate from `wavFromPcm16` so the header can be asserted
 * byte-for-byte in a test without allocating the payload.
 */
export function wavHeaderBytes(dataBytes: number, sampleRate = VOICE_SAMPLE_RATE): Buffer {
	if (!Number.isInteger(dataBytes) || dataBytes < 0) {
		throw new VoiceError("TRANSCRIBE_AUDIO_INVALID", "WAV payload size must be a non-negative integer")
	}
	if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
		throw new VoiceError("TRANSCRIBE_AUDIO_INVALID", "WAV sample rate must be a positive integer")
	}
	const byteRate = sampleRate * VOICE_CHANNELS * VOICE_BYTES_PER_SAMPLE
	const blockAlign = VOICE_CHANNELS * VOICE_BYTES_PER_SAMPLE
	const header = Buffer.alloc(WAV_HEADER_BYTES)
	header.write("RIFF", 0, "ascii")
	// RIFF size = everything after this field: 36 + payload.
	header.writeUInt32LE(36 + dataBytes, 4)
	header.write("WAVE", 8, "ascii")
	header.write("fmt ", 12, "ascii")
	header.writeUInt32LE(16, 16) // fmt chunk size for PCM
	header.writeUInt16LE(1, 20) // WAVE_FORMAT_PCM
	header.writeUInt16LE(VOICE_CHANNELS, 22)
	header.writeUInt32LE(sampleRate, 24)
	header.writeUInt32LE(byteRate, 28)
	header.writeUInt16LE(blockAlign, 32)
	header.writeUInt16LE(VOICE_BYTES_PER_SAMPLE * 8, 34)
	header.write("data", 36, "ascii")
	header.writeUInt32LE(dataBytes, 40)
	return header
}

/**
 * Wraps PCM16 samples as a complete in-memory WAV buffer.
 *
 * This is the only place audio is copied; the caller drops the result as soon as
 * it has been written to the child's stdin.
 */
export function wavFromPcm16(samples: Int16Array, sampleRate = VOICE_SAMPLE_RATE): Buffer {
	if (!(samples instanceof Int16Array)) {
		throw new VoiceError("TRANSCRIBE_AUDIO_INVALID", "Expected PCM16 samples")
	}
	const dataBytes = samples.length * VOICE_BYTES_PER_SAMPLE
	const header = wavHeaderBytes(dataBytes, sampleRate)
	// Copy the samples into a little-endian byte view. `Buffer.from(view.buffer)`
	// would alias caller memory, so the bytes are copied explicitly.
	const payload = Buffer.alloc(dataBytes)
	for (let i = 0; i < samples.length; i++) {
		payload.writeInt16LE(samples[i], i * 2)
	}
	return Buffer.concat([header, payload], WAV_HEADER_BYTES + dataBytes)
}

/** Reads the header fields back out; used by tests and by the engine's guard. */
export interface ParsedWavHeader {
	sampleRate: number
	channels: number
	bitsPerSample: number
	dataBytes: number
}

export function parseWavHeader(buffer: Buffer): ParsedWavHeader {
	if (buffer.length < WAV_HEADER_BYTES) {
		throw new VoiceError("TRANSCRIBE_AUDIO_INVALID", "Buffer is too short to be a WAV file")
	}
	if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
		throw new VoiceError("TRANSCRIBE_AUDIO_INVALID", "Missing RIFF/WAVE signature")
	}
	if (buffer.toString("ascii", 12, 16) !== "fmt " || buffer.toString("ascii", 36, 40) !== "data") {
		throw new VoiceError("TRANSCRIBE_AUDIO_INVALID", "Unexpected WAV chunk layout")
	}
	return {
		sampleRate: buffer.readUInt32LE(24),
		channels: buffer.readUInt16LE(22),
		bitsPerSample: buffer.readUInt16LE(34),
		dataBytes: buffer.readUInt32LE(40),
	}
}
