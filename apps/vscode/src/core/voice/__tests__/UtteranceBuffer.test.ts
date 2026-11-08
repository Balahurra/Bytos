import { UtteranceBuffer } from "@core/voice/audio/UtteranceBuffer"
import { describe, expect, it } from "vitest"

function chunk(samples: number): Int16Array {
	return new Int16Array(samples).fill(1000)
}

describe("UtteranceBuffer", () => {
	it("accumulates and returns the concatenated audio", () => {
		const buffer = new UtteranceBuffer({ maxDurationMs: 1000 })
		buffer.append(chunk(100))
		buffer.append(chunk(200))
		const all = buffer.toInt16Array()
		expect(all.length).toBe(300)
		expect(buffer.bytes).toBe(600)
		expect(buffer.durationMs).toBeCloseTo((300 / 16000) * 1000, 5)
	})

	it("enforces the duration cap by truncating, not by growing", () => {
		// 100 ms cap = 1600 samples.
		const buffer = new UtteranceBuffer({ maxDurationMs: 100 })
		const result = buffer.append(chunk(1600))
		expect(result.accepted).toBe(true)
		expect(result.sealed).toBe(true)
		expect(buffer.samples).toBe(1600)

		const overflow = buffer.append(chunk(1600))
		expect(overflow.accepted).toBe(false)
		expect(buffer.samples).toBe(1600)
	})

	it("reports truncation when a chunk only partly fits", () => {
		const buffer = new UtteranceBuffer({ maxDurationMs: 100 })
		buffer.append(chunk(1000))
		const result = buffer.append(chunk(1000))
		expect(result.accepted).toBe(true)
		expect(result.truncated).toBe(true)
		expect(buffer.samples).toBe(1600)
		expect(buffer.isTruncated).toBe(true)
	})

	it("enforces the byte cap", () => {
		const buffer = new UtteranceBuffer({ maxDurationMs: 60000, maxBytes: 400 })
		buffer.append(chunk(100)) // 200 bytes
		const result = buffer.append(chunk(200)) // would be 600 bytes → 400 max → 100 more samples
		expect(result.truncated).toBe(true)
		expect(buffer.bytes).toBe(400)
	})

	it("never grows without bound across many appends", () => {
		const buffer = new UtteranceBuffer({ maxDurationMs: 50 })
		for (let i = 0; i < 500; i++) {
			buffer.append(chunk(320))
		}
		expect(buffer.samples).toBeLessThanOrEqual(Math.floor((50 / 1000) * 16000))
	})

	it("drops everything on clear()", () => {
		const buffer = new UtteranceBuffer({ maxDurationMs: 1000 })
		buffer.append(chunk(500))
		buffer.clear()
		expect(buffer.samples).toBe(0)
		expect(buffer.bytes).toBe(0)
		expect(buffer.isTruncated).toBe(false)
		expect(buffer.isSealed).toBe(false)
		expect(buffer.toInt16Array().length).toBe(0)
	})
})
