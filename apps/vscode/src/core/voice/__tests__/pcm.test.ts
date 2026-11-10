import { decodeToFloat, downmixToMono, floatToPcm16, monoFloatToPcm16, normaliseToPcm16 } from "@core/voice/audio/pcm"
import { describe, expect, it } from "vitest"

describe("floatToPcm16", () => {
	it("maps the full range with clamping", () => {
		expect(floatToPcm16(0)).toBe(0)
		expect(floatToPcm16(1)).toBe(32767)
		expect(floatToPcm16(-1)).toBe(-32768)
		expect(floatToPcm16(2)).toBe(32767)
		expect(floatToPcm16(-2)).toBe(-32768)
	})

	it("clamps ordinary out-of-range samples", () => {
		expect(floatToPcm16(2)).toBe(32767)
		expect(floatToPcm16(-2)).toBe(-32768)
	})

	it("maps non-finite input to silence instead of NaN", () => {
		expect(floatToPcm16(Number.NaN)).toBe(0)
		expect(floatToPcm16(Number.POSITIVE_INFINITY)).toBe(0)
		expect(floatToPcm16(Number.NEGATIVE_INFINITY)).toBe(0)
	})
})

describe("downmixToMono", () => {
	it("AVERAGES channels instead of summing them", () => {
		// Two identical full-scale channels must stay full scale, not clip at 2.0.
		const interleaved = new Float32Array([1, 1, -1, -1, 0.5, 0.5])
		const mono = downmixToMono(interleaved, 2)
		expect(Array.from(mono)).toEqual([1, -1, 0.5])
	})

	it("passes mono through untouched", () => {
		const monoInput = new Float32Array([0.25, -0.25])
		expect(downmixToMono(monoInput, 1)).toBe(monoInput)
	})

	it("drops a partial trailing frame", () => {
		const interleaved = new Float32Array([1, 1, -1])
		expect(downmixToMono(interleaved, 2).length).toBe(1)
	})
})

describe("decodeToFloat", () => {
	it("decodes 16-bit PCM", () => {
		const bytes = new Uint8Array(4)
		const view = new DataView(bytes.buffer)
		view.setInt16(0, 16384, true)
		view.setInt16(2, -16384, true)
		const floats = decodeToFloat(bytes, { sampleRate: 16000, channels: 1, format: "s16" })
		expect(floats[0]).toBeCloseTo(0.5, 4)
		expect(floats[1]).toBeCloseTo(-0.5, 4)
	})

	it("decodes 32-bit float", () => {
		const bytes = new Uint8Array(8)
		const view = new DataView(bytes.buffer)
		view.setFloat32(0, 0.75, true)
		view.setFloat32(4, -0.75, true)
		const floats = decodeToFloat(bytes, { sampleRate: 48000, channels: 2, format: "f32" })
		expect(floats[0]).toBeCloseTo(0.75, 5)
		expect(floats[1]).toBeCloseTo(-0.75, 5)
	})

	it("decodes 24-bit PCM with sign extension", () => {
		// 0x400000 = +0.5, 0xC00000 = -0.5
		const bytes = new Uint8Array([0x00, 0x00, 0x40, 0x00, 0x00, 0xc0])
		const floats = decodeToFloat(bytes, { sampleRate: 48000, channels: 1, format: "s24" })
		expect(floats[0]).toBeCloseTo(0.5, 5)
		expect(floats[1]).toBeCloseTo(-0.5, 5)
	})

	it("decodes 32-bit PCM", () => {
		const bytes = new Uint8Array(8)
		const view = new DataView(bytes.buffer)
		view.setInt32(0, 1073741824, true) // 0.5 * 2^31
		view.setInt32(4, -1073741824, true)
		const floats = decodeToFloat(bytes, { sampleRate: 48000, channels: 1, format: "s32" })
		expect(floats[0]).toBeCloseTo(0.5, 5)
		expect(floats[1]).toBeCloseTo(-0.5, 5)
	})
})

describe("normaliseToPcm16 (48 kHz stereo float32 → 16 kHz mono PCM16)", () => {
	function stereoF32(frames: number, hz: number): Uint8Array {
		const bytes = new Uint8Array(frames * 2 * 4)
		const view = new DataView(bytes.buffer)
		for (let i = 0; i < frames; i++) {
			const value = Math.sin((2 * Math.PI * hz * i) / 48000) * 0.5
			view.setFloat32(i * 8, value, true)
			view.setFloat32(i * 8 + 4, value, true)
		}
		return bytes
	}

	for (const seconds of [6, 30, 60]) {
		it(`produces ~1 second of 16 kHz mono per second of input (${seconds}s)`, () => {
			const frames = 48000 * seconds
			const pcm = normaliseToPcm16(stereoF32(frames, 440), { sampleRate: 48000, channels: 2, format: "f32" }, 16000)
			const expected = 16000 * seconds
			expect(Math.abs(pcm.length - expected)).toBeLessThanOrEqual(1)
		})
	}

	it("keeps a 16 kHz mono input unchanged in length", () => {
		const bytes = new Uint8Array(3200)
		const pcm = normaliseToPcm16(bytes, { sampleRate: 16000, channels: 1, format: "s16" }, 16000)
		expect(pcm.length).toBe(1600)
	})
})

describe("monoFloatToPcm16", () => {
	it("clamps out-of-range floats", () => {
		const pcm = monoFloatToPcm16(new Float32Array([2, -2, 0.5]))
		expect(Array.from(pcm)).toEqual([32767, -32768, 16384])
	})
})
