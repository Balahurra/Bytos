import { describe, expect, it } from "vitest"
import { VoiceError } from "../../types"
import { parseWavHeader, WAV_HEADER_BYTES, wavFromPcm16, wavHeaderBytes } from "../wav"

/**
 * The 44-byte RIFF wrapper is what lets an F1 `Int16Array` reach whisper's
 * `miniaudio` decoder with no file on disk, so its exact bytes are pinned here.
 */
describe("wavHeaderBytes", () => {
	it("emits a canonical 16 kHz mono PCM16 header", () => {
		const header = wavHeaderBytes(32000)
		expect(header.length).toBe(WAV_HEADER_BYTES)

		expect(header.toString("ascii", 0, 4)).toBe("RIFF")
		expect(header.readUInt32LE(4)).toBe(36 + 32000)
		expect(header.toString("ascii", 8, 12)).toBe("WAVE")
		expect(header.toString("ascii", 12, 16)).toBe("fmt ")
		expect(header.readUInt32LE(16)).toBe(16)
		expect(header.readUInt16LE(20)).toBe(1) // PCM
		expect(header.readUInt16LE(22)).toBe(1) // mono
		expect(header.readUInt32LE(24)).toBe(16000)
		expect(header.readUInt32LE(28)).toBe(16000 * 2) // byte rate
		expect(header.readUInt16LE(32)).toBe(2) // block align
		expect(header.readUInt16LE(34)).toBe(16) // bits per sample
		expect(header.toString("ascii", 36, 40)).toBe("data")
		expect(header.readUInt32LE(40)).toBe(32000)
	})

	it("matches a byte-for-byte known-good header", () => {
		// 1 second of silence: 16000 samples × 2 bytes = 32000 payload bytes.
		// RIFF size = 36 + 32000 = 32036 = 0x00007D24 → little-endian `247d0000`.
		expect(wavHeaderBytes(32000).toString("hex")).toBe(
			"52494646" + // "RIFF"
				"247d0000" + // 36 + 32000
				"57415645" + // "WAVE"
				"666d7420" + // "fmt "
				"10000000" + // fmt chunk size 16
				"0100" + // WAVE_FORMAT_PCM
				"0100" + // mono
				"803e0000" + // 16000 Hz
				"007d0000" + // 32000 byte/s
				"0200" + // block align
				"1000" + // 16 bits
				"64617461" + // "data"
				"007d0000", // 32000 payload bytes
		)
	})

	it("rejects a negative or non-integer payload size", () => {
		expect(() => wavHeaderBytes(-1)).toThrow(VoiceError)
		expect(() => wavHeaderBytes(1.5)).toThrow(VoiceError)
	})
})

describe("wavFromPcm16", () => {
	it("wraps samples without altering them", () => {
		const samples = Int16Array.from([0, 1, -1, 32767, -32768, 1234])
		const wav = wavFromPcm16(samples)

		expect(wav.length).toBe(WAV_HEADER_BYTES + samples.length * 2)
		const header = parseWavHeader(wav)
		expect(header).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, dataBytes: samples.length * 2 })

		for (let i = 0; i < samples.length; i++) {
			expect(wav.readInt16LE(WAV_HEADER_BYTES + i * 2)).toBe(samples[i])
		}
	})

	it("writes little-endian payload bytes", () => {
		const wav = wavFromPcm16(Int16Array.from([0x0102]))
		expect(wav.readUInt8(WAV_HEADER_BYTES)).toBe(0x02)
		expect(wav.readUInt8(WAV_HEADER_BYTES + 1)).toBe(0x01)
	})

	it("does not alias the caller's buffer", () => {
		const samples = Int16Array.from([100, 200])
		const wav = wavFromPcm16(samples)
		samples[0] = -999
		expect(wav.readInt16LE(WAV_HEADER_BYTES)).toBe(100)
	})

	it("rejects a non-Int16Array argument", () => {
		expect(() => wavFromPcm16(new Float32Array(4) as unknown as Int16Array)).toThrow(VoiceError)
	})

	it("produces a 1-second file for 16000 samples", () => {
		const wav = wavFromPcm16(new Int16Array(16000))
		expect(parseWavHeader(wav).dataBytes).toBe(32000)
		expect(wav.readUInt32LE(24)).toBe(16000)
	})
})

describe("parseWavHeader", () => {
	it("rejects a buffer that is too short", () => {
		expect(() => parseWavHeader(Buffer.alloc(10))).toThrow(VoiceError)
	})

	it("rejects a non-RIFF buffer", () => {
		expect(() => parseWavHeader(Buffer.alloc(WAV_HEADER_BYTES, 7))).toThrow(VoiceError)
	})

	it("rejects a RIFF file with an unexpected chunk layout", () => {
		const header = wavHeaderBytes(0)
		header.write("junk", 12, "ascii")
		expect(() => parseWavHeader(header)).toThrow(VoiceError)
	})
})
