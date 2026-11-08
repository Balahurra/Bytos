import { expectedOutputLength, LinearResampler, resampleAll } from "@core/voice/audio/resample"
import { describe, expect, it } from "vitest"

function sine(samples: number, hz: number, rate: number): Float32Array {
	const out = new Float32Array(samples)
	for (let i = 0; i < samples; i++) {
		out[i] = Math.sin((2 * Math.PI * hz * i) / rate)
	}
	return out
}

describe("resampleAll", () => {
	it("returns the input untouched at the same rate", () => {
		const input = new Float32Array([0.1, 0.2, 0.3])
		expect(resampleAll(input, 16000, 16000)).toBe(input)
	})

	for (const seconds of [6, 30, 60]) {
		it(`keeps the length within ±1 sample for ${seconds}s at 48k→16k`, () => {
			const input = sine(48000 * seconds, 440, 48000)
			const output = resampleAll(input, 48000, 16000)
			expect(Math.abs(output.length - expectedOutputLength(input.length, 48000, 16000))).toBeLessThanOrEqual(1)
		})
	}

	it("does not drift across 100 chunks", () => {
		const resampler = new LinearResampler(16000)
		resampler.reset(48000)
		let produced = 0
		let consumed = 0
		// 100 chunks of 20 ms each (960 frames at 48 kHz).
		for (let chunk = 0; chunk < 100; chunk++) {
			resampler.push(sine(960, 300, 48000))
			consumed += 960
			produced += resampler.drain().length
		}
		produced += resampler.flush().length
		const expected = expectedOutputLength(consumed, 48000, 16000)
		expect(Math.abs(produced - expected)).toBeLessThanOrEqual(1)
	})

	it("preserves the signal shape (a 0.5 sine stays a 0.5 sine)", () => {
		const input = sine(4800, 300, 48000).map((value) => value * 0.5) as Float32Array
		const output = resampleAll(input, 48000, 16000)
		let peak = 0
		for (const value of output) {
			peak = Math.max(peak, Math.abs(value))
		}
		expect(peak).toBeGreaterThan(0.45)
		expect(peak).toBeLessThanOrEqual(0.51)
	})
})
