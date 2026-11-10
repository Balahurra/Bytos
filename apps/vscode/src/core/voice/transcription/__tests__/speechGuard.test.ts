import { describe, expect, it } from "vitest"
import { containsSpeech, filterHallucinations, rms, SPEECH_RMS_FLOOR } from "../speechGuard"

/**
 * These guards exist because the real recogniser does NOT return empty text for
 * non-speech. Every case below is a transcript the pinned build actually produced
 * for silence or noise (see `speechGuard.ts` for the measurement table).
 */
describe("rms", () => {
	it("is zero for digital silence", () => {
		expect(rms(new Int16Array(1600))).toBe(0)
	})

	it("is the amplitude for a constant full-scale square wave", () => {
		expect(rms(Int16Array.from(Array(100).fill(1000)))).toBeCloseTo(1000, 5)
	})

	it("is zero for an empty buffer", () => {
		expect(rms(new Int16Array(0))).toBe(0)
	})
})

describe("containsSpeech", () => {
	it("rejects digital silence", () => {
		expect(containsSpeech(new Int16Array(16000))).toBe(false)
	})

	it("rejects an empty buffer", () => {
		expect(containsSpeech(new Int16Array(0))).toBe(false)
	})

	it("rejects a buffer shorter than one frame with no energy", () => {
		expect(containsSpeech(new Int16Array(800))).toBe(false)
	})

	it("accepts a loud short buffer", () => {
		expect(containsSpeech(new Int16Array(800).fill(4000))).toBe(true)
	})

	it("rejects steady low-level noise below the floor", () => {
		const quiet = Int16Array.from(Array(32000).fill(SPEECH_RMS_FLOOR / 4))
		expect(containsSpeech(quiet)).toBe(false)
	})

	it("accepts speech-like energy", () => {
		const loud = Int16Array.from(Array(32000).fill(2000))
		expect(containsSpeech(loud)).toBe(true)
	})

	it("ignores a short burst in otherwise silent audio", () => {
		// A single loud sample inside one 100 ms frame lifts that frame's RMS above
		// the floor, but a burst covering 1 of 20 frames (5 %) must not count as
		// speech-plausible: require a third of frames to be loud.
		const samples = new Int16Array(16000 * 2) // 20 frames of 100 ms
		samples.fill(9000, 0, 1600) // exactly one frame is loud
		expect(containsSpeech(samples)).toBe(false)

		// Eight of twenty frames loud IS speech-plausible.
		const sustained = new Int16Array(16000 * 2)
		sustained.fill(9000, 0, 1600 * 8)
		expect(containsSpeech(sustained)).toBe(true)
	})

	it("honours an injected floor", () => {
		const audio = Int16Array.from(Array(32000).fill(500))
		expect(containsSpeech(audio, { rmsFloor: 400 })).toBe(true)
		expect(containsSpeech(audio, { rmsFloor: 4000 })).toBe(false)
	})
})

describe("containsSpeech — adaptive floor (F4)", () => {
	/**
	 * The regression: a real 5.7 s English sentence captured from the built-in
	 * microphone array had a median 100 ms frame RMS of 39 PCM16 with a 90th
	 * percentile of 75. The old absolute floor of 100 rejected it, so the
	 * recogniser never ran and the composer received no text.
	 */
	function realCaptureLike(): Int16Array {
		// 57 frames of 100 ms: quiet room tone with a quiet speech envelope on top.
		const samples = new Int16Array(1600 * 57)
		let seed = 987654321
		for (let frame = 0; frame < 57; frame++) {
			// Level per frame mimics the measured distribution (p10≈36, p90≈75).
			const level = frame < 10 ? 20 : frame < 45 ? 40 : 70
			for (let i = 0; i < 1600; i++) {
				seed = (seed * 1103515245 + 12345) & 0x7fffffff
				const noise = (seed / 0x7fffffff) * 2 - 1
				samples[frame * 1600 + i] = Math.round(noise * level * 1.732)
			}
		}
		return samples
	}

	it("accepts a quiet real-device capture that the old absolute floor rejected", () => {
		const audio = realCaptureLike()
		// A fixed floor of 100 (the old default) still rejects it...
		expect(containsSpeech(audio, { rmsFloor: 100 })).toBe(false)
		// ...but the adaptive gate accepts it, which is the F4 fix.
		expect(containsSpeech(audio)).toBe(true)
	})

	it("still rejects digital silence and steady low noise", () => {
		expect(containsSpeech(new Int16Array(16000 * 3))).toBe(false)
		// Noise with no internal dynamic range has no loud frames above its own
		// floor, so the ratio test fails: nothing separates it from room tone.
		const steady = Int16Array.from(Array(16000 * 3).fill(12))
		expect(containsSpeech(steady, { rmsFloor: 100 })).toBe(false)
	})

	it("still rejects a single click in an otherwise silent recording", () => {
		const samples = new Int16Array(16000 * 2)
		samples.fill(9000, 0, 160) // 10 ms click = one tenth of one 100 ms frame
		expect(containsSpeech(samples)).toBe(false)
	})

	it("clamps the adaptive floor to the documented band", () => {
		// A fully silent buffer must not produce a floor of 0 and accept noise.
		expect(containsSpeech(new Int16Array(16000 * 3))).toBe(false)
		// A very loud buffer is still speech.
		const loud = Int16Array.from(Array(16000 * 3).fill(8000))
		expect(containsSpeech(loud)).toBe(true)
	})

	it("lets a caller pin the floor explicitly", () => {
		const audio = realCaptureLike()
		expect(containsSpeech(audio, { rmsFloor: 10 })).toBe(true)
		expect(containsSpeech(audio, { rmsFloor: 8000 })).toBe(false)
	})
})

describe("filterHallucinations", () => {
	it.each([
		["[BLANK_AUDIO]", "measured on base for 3 s noise"],
		["[BIRDS CHIRPING]", "measured on tiny for 3 s noise"],
		["(birds chirping)", "measured on tiny for 3 s noise"],
		["[MUSIC]", "stock annotation"],
		["[ Silence ]", "stock annotation with spaces"],
		["(applause)", "stock annotation"],
		["*music*", "asterisk form"],
		["[NO SPEECH]", "stock annotation"],
		["  [blank_audio]  ", "lowercase with padding"],
		// F4: whisper annotates in the REQUESTED language. These reached the
		// composer as if the user had said them before the filter learned them.
		["[Applaus]", "observed on a real German capture"],
		["[Musik]", "German music marker"],
		["[MÜZİK ÇALIYOR]", "observed on a real Turkish capture"],
		["[müzik]", "Turkish music marker"],
		["[Alkış]", "Turkish applause marker"],
		["[Gelächter]", "German laughter marker"],
		["[Sessizlik]", "Turkish silence marker"],
	])("removes the non-speech annotation %s", (annotation) => {
		const result = filterHallucinations(annotation)
		expect(result.text).toBe("")
		expect(result.removed.length).toBeGreaterThan(0)
	})

	it("removes the measured silence token 'you'", () => {
		expect(filterHallucinations("you").text).toBe("")
		expect(filterHallucinations(" You ").text).toBe("")
	})

	it("keeps a real sentence that merely contains 'you'", () => {
		const result = filterHallucinations("Thank you for opening the file.")
		expect(result.text).toBe("Thank you for opening the file.")
	})

	it("keeps real speech untouched", () => {
		const turkish = "Lütfen dosyayı aç ve içindeki hataları düzelt."
		expect(filterHallucinations(turkish).text).toBe(turkish)
	})

	it("does not strip a real sentence that merely mentions music or applause", () => {
		// The filter matches WHOLE-LINE annotations only, so ordinary speech about
		// music must survive a filter that also knows the word "Musik".
		const sentences = [
			"Die Musik ist zu laut, bitte leiser machen.",
			"Bu şarkıda güzel bir müzik var.",
			"Add an applause sound effect to the intro.",
			"Lachen ist gesund und macht Freude.",
		]
		for (const sentence of sentences) {
			expect(filterHallucinations(sentence).text).toBe(sentence)
		}
	})

	it("removes an annotation line but keeps the real speech around it", () => {
		const mixed = "[BLANK_AUDIO]\nMerhaba bu bir testtir."
		const result = filterHallucinations(mixed)
		expect(result.text).toBe("Merhaba bu bir testtir.")
		expect(result.removed).toEqual(["[BLANK_AUDIO]"])
	})

	it("returns an empty string for a blank transcript", () => {
		expect(filterHallucinations("   \r\n  ").text).toBe("")
	})
})
