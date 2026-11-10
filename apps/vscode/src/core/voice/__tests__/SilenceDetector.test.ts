import { SilenceDetector } from "@core/voice/audio/SilenceDetector"
import { describe, expect, it } from "vitest"

/** 20 ms of 16 kHz mono PCM16. */
const CHUNK_MS = 20
const CHUNK_SAMPLES = (16000 * CHUNK_MS) / 1000

function speechChunk(): Int16Array {
	const chunk = new Int16Array(CHUNK_SAMPLES)
	for (let i = 0; i < chunk.length; i++) {
		chunk[i] = Math.round(Math.sin((2 * Math.PI * 300 * i) / 16000) * 8000)
	}
	return chunk
}

function silentChunk(): Int16Array {
	return new Int16Array(CHUNK_SAMPLES)
}

describe("SilenceDetector", () => {
	it("emits exactly one seal per speech burst", () => {
		const detector = new SilenceDetector({ timeoutMs: 200 })
		let seals = 0
		// 0.5 s speech → 0.5 s silence → 0.5 s speech → 0.5 s silence
		for (let i = 0; i < 25; i++) seals += detector.update(speechChunk(), CHUNK_MS).sealed ? 1 : 0
		for (let i = 0; i < 25; i++) seals += detector.update(silentChunk(), CHUNK_MS).sealed ? 1 : 0
		for (let i = 0; i < 25; i++) seals += detector.update(speechChunk(), CHUNK_MS).sealed ? 1 : 0
		for (let i = 0; i < 25; i++) seals += detector.update(silentChunk(), CHUNK_MS).sealed ? 1 : 0
		expect(seals).toBe(2)
	})

	it("never seals pure silence", () => {
		const detector = new SilenceDetector({ timeoutMs: 100 })
		let seals = 0
		for (let i = 0; i < 200; i++) seals += detector.update(silentChunk(), CHUNK_MS).sealed ? 1 : 0
		expect(seals).toBe(0)
	})

	it("honours the configured timeout", () => {
		const detector = new SilenceDetector({ timeoutMs: 500 })
		const seals: number[] = []
		for (let i = 0; i < 5; i++) detector.update(speechChunk(), CHUNK_MS)
		for (let i = 0; i < 40; i++) {
			const update = detector.update(silentChunk(), CHUNK_MS)
			if (update.sealed) seals.push(i * CHUNK_MS)
		}
		expect(seals).toHaveLength(1)
		expect(seals[0]).toBeGreaterThanOrEqual(500 - CHUNK_MS)
		expect(seals[0]).toBeLessThanOrEqual(500 + CHUNK_MS)
	})

	it("does not seal mid-burst when speech resumes before the timeout", () => {
		const detector = new SilenceDetector({ timeoutMs: 400 })
		for (let i = 0; i < 10; i++) detector.update(speechChunk(), CHUNK_MS)
		// 200 ms of silence (under the timeout) then speech again.
		for (let i = 0; i < 10; i++) expect(detector.update(silentChunk(), CHUNK_MS).sealed).toBe(false)
		for (let i = 0; i < 10; i++) expect(detector.update(speechChunk(), CHUNK_MS).sealed).toBe(false)
	})

	it("derives the duration from the sample count when none is given", () => {
		const detector = new SilenceDetector({ timeoutMs: 100 })
		for (let i = 0; i < 3; i++) detector.update(speechChunk())
		let sealed = false
		for (let i = 0; i < 10 && !sealed; i++) {
			sealed = detector.update(silentChunk()).sealed
		}
		expect(sealed).toBe(true)
	})
})
