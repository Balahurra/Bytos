import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WhisperCliEngine } from "../WhisperCliEngine"
import { CLIPS, ENGINE_ROOT, MODEL_DIR, matchedKeywords, readClipPcm16, skipWithoutAssets } from "./f2TestAssets"

/**
 * REAL end-to-end transcription with the pinned whisper binary and models.
 *
 * These tests run the actual `whisper-cli.exe` over actual recorded speech in all
 * three supported languages. Nothing is stubbed: the audio goes through the same
 * in-memory WAV path the extension uses in production.
 *
 * They deliberately assert on *content words* with a tolerance, not on exact
 * strings, because ASR output legitimately varies with model size. Any claim of
 * "passed" here means the words were actually recovered.
 */
describe.skipIf(skipWithoutAssets)("WhisperCliEngine — real transcription", () => {
	let engine: WhisperCliEngine

	beforeAll(async () => {
		engine = new WhisperCliEngine()
		const status = await engine.init({ engineRoot: ENGINE_ROOT, modelDir: MODEL_DIR })
		expect(status.ready).toBe(true)
	})

	afterAll(async () => {
		await engine.dispose()
	})

	it("loads the verified base model", async () => {
		const status = await engine.loadModel("base")
		expect(status.state).toBe("ready")
		expect(status.totalBytes).toBe(147951465)
	})

	it("loads the verified tiny model", async () => {
		const status = await engine.loadModel("tiny")
		expect(status.state).toBe("ready")
		expect(status.totalBytes).toBe(77691713)
	})

	describe("explicit language (base model)", () => {
		it.each(CLIPS.filter((clip) => clip.language === "en"))("transcribes English clip $id", async (clip) => {
			const result = await engine.transcribe({
				samples: readClipPcm16(clip.id),
				language: clip.language,
				modelId: "base",
			})
			const matched = matchedKeywords(result.text, clip.keywords)
			// A real transcript must recover most content words. Report the actual
			// text in the assertion message so a regression is legible.
			expect(matched, `actual: ${JSON.stringify(result.text)}`).toEqual(expect.arrayContaining(clip.keywords.slice(0, 4)))
			expect(result.text.length).toBeGreaterThan(0)
			expect(result.engine).toBe("whisper-cli")
			expect(result.modelId).toBe("base")
			expect(result.audioDurationMs).toBeGreaterThan(clip.durationSeconds * 900)
		}, 60000)

		it.each(
			CLIPS.filter((clip) => clip.language === "tr"),
		)("transcribes Turkish clip $id with correct diacritics", async (clip) => {
			const result = await engine.transcribe({
				samples: readClipPcm16(clip.id),
				language: clip.language,
				modelId: "base",
			})
			const matched = matchedKeywords(result.text, clip.keywords)
			expect(matched, `actual: ${JSON.stringify(result.text)}`).toEqual(expect.arrayContaining(clip.keywords.slice(0, 3)))
			// Turkish diacritics must survive the pipe as UTF-8, not become '?'.
			expect(result.text).toMatch(/[çğıöşüÇĞİÖŞÜ]/)
		}, 60000)

		it.each(
			CLIPS.filter((clip) => clip.language === "de"),
		)("transcribes German clip $id with correct umlauts", async (clip) => {
			const result = await engine.transcribe({
				samples: readClipPcm16(clip.id),
				language: clip.language,
				modelId: "base",
			})
			const matched = matchedKeywords(result.text, clip.keywords)
			expect(matched, `actual: ${JSON.stringify(result.text)}`).toEqual(expect.arrayContaining(clip.keywords.slice(0, 3)))
			expect(result.text).toMatch(/[äöüßÄÖÜ]/)
		}, 60000)
	})

	describe("automatic language detection", () => {
		it.each(CLIPS)("detects $language for clip $id", async (clip) => {
			const result = await engine.transcribe({
				samples: readClipPcm16(clip.id),
				language: "auto",
				modelId: "base",
			})
			// Detection must name the right language and still produce text.
			expect(result.language, `actual text: ${JSON.stringify(result.text)}`).toBe(clip.language)
			expect(result.text.length).toBeGreaterThan(0)
		}, 60000)
	})
})
