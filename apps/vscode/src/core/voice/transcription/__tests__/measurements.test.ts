import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WhisperCliEngine } from "../WhisperCliEngine"
import { CLIPS, ENGINE_ROOT, MODEL_DIR, matchedKeywords, readClipPcm16, skipWithoutAssets } from "./f2TestAssets"

/**
 * Resource and latency measurements on the reference host.
 *
 * These assert only loose upper bounds (so a slow CI machine does not fail the
 * build) and PRINT the measured values, which are what the F2 report quotes.
 * Every number here is measured in this run — none is copied from F0.
 */
interface Measurement {
	label: string
	modelId: string
	wallMs: number
	inferenceMs?: number
	audioMs: number
	chars: number
	keywords: number
}

const measurements: Measurement[] = []

describe.skipIf(skipWithoutAssets)("latency and quality measurements", () => {
	let engine: WhisperCliEngine

	beforeAll(async () => {
		engine = new WhisperCliEngine()
		await engine.init({ engineRoot: ENGINE_ROOT, modelDir: MODEL_DIR })
	})

	afterAll(async () => {
		await engine.dispose()
		console.log("\n=== F2 MEASUREMENTS (reference host, Windows x64) ===")
		for (const m of measurements) {
			console.log(
				`${m.modelId.padEnd(5)} ${m.label.padEnd(12)} wall=${m.wallMs}ms inference=${
					m.inferenceMs === undefined ? "n/a" : `${Math.round(m.inferenceMs)}ms`
				} audio=${Math.round(m.audioMs)}ms chars=${m.chars} keywords=${m.keywords}`,
			)
		}
	})

	it.each(["tiny", "base"] as const)("measures %s on every corpus clip", async (modelId) => {
		for (const clip of CLIPS) {
			const samples = readClipPcm16(clip.id)
			const result = await engine.transcribe({ samples, language: clip.language, modelId })
			measurements.push({
				label: clip.id,
				modelId,
				wallMs: result.durationMs,
				inferenceMs: result.inferenceMs,
				audioMs: result.audioDurationMs,
				chars: result.text.length,
				keywords: matchedKeywords(result.text, clip.keywords).length,
			})
			// A short utterance must never take absurdly long. 60 s is a hard ceiling
			// for <= 7 s of audio, not a performance target.
			expect(result.durationMs).toBeLessThan(60000)
		}
	}, 300000)

	it("keeps tiny fixed overhead bounded", () => {
		const tiny = measurements.filter((m) => m.modelId === "tiny")
		if (tiny.length === 0) return
		const mean = tiny.reduce((sum, m) => sum + m.wallMs, 0) / tiny.length
		console.log(`tiny mean wall time: ${Math.round(mean)} ms`)
		// F0 measured 701 ms for 3.5 s of audio on tiny; allow generous headroom.
		expect(mean).toBeLessThan(15000)
	})
})
