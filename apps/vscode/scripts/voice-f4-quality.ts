/**
 * F4 diagnostic — end-to-end pipeline check with a KNOWN signal.
 *
 * Developer tool, not shipped. Plays a corpus clip through the default speaker
 * and captures it with the real microphone, then transcribes. The point is to
 * validate the *pipeline* (capture → buffer → stop/drain → whisper → text), not
 * the acoustic path: a speaker→air→mic loop is inherently lossy, so a poor WER
 * here says nothing about microphone-only dictation.
 *
 * A second mode (`--file`) skips the microphone entirely and pushes a corpus clip
 * straight through the runtime's transcription entry point, which isolates
 * recognition quality from every device and acoustic variable.
 *
 * Usage (from `apps/vscode`):
 *   bun scripts/voice-f4-quality.ts --file tr_merhaba --models base,tiny
 */
import * as path from "node:path"
import { CLIPS, readClipPcm16 } from "../src/core/voice/transcription/__tests__/f2TestAssets"
import { WhisperCliEngine } from "../src/core/voice/transcription/WhisperCliEngine"

const EXTENSION_ROOT = path.resolve(import.meta.dir, "..")
const ASSETS = path.join(EXTENSION_ROOT, "test-assets", "voice-f2")

/** Levenshtein distance over word tokens. */
function wordDistance(reference: string[], hypothesis: string[]): number {
	const rows = reference.length + 1
	const cols = hypothesis.length + 1
	const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
	for (let i = 0; i < rows; i++) dp[i][0] = i
	for (let j = 0; j < cols; j++) dp[0][j] = j
	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
			dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
		}
	}
	return dp[rows - 1][cols - 1]
}

/** Character-level Levenshtein distance. */
function charDistance(reference: string, hypothesis: string): number {
	const rows = reference.length + 1
	const cols = hypothesis.length + 1
	const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
	for (let i = 0; i < rows; i++) dp[i][0] = i
	for (let j = 0; j < cols; j++) dp[0][j] = j
	for (let i = 1; i < rows; i++) {
		for (let j = 1; j < cols; j++) {
			const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1
			dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
		}
	}
	return dp[rows - 1][cols - 1]
}

function tokens(text: string): string[] {
	return text
		.toLocaleLowerCase("tr")
		.replace(/[.,!?;:"'()[\]{}…\-–—]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ")
		.filter((entry) => entry.length > 0)
}

function normalise(text: string): string {
	return text
		.toLocaleLowerCase("tr")
		.replace(/[.,!?;:"'()[\]{}…\-–—]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

async function main(): Promise<void> {
	const clipArg = process.argv.indexOf("--file")
	const clipId = clipArg >= 0 ? process.argv[clipArg + 1] : "tr_merhaba"
	const modelArg = process.argv.indexOf("--models")
	const models = (modelArg >= 0 ? process.argv[modelArg + 1] : "base").split(",") as Array<"tiny" | "base">
	const clip = CLIPS.find((entry) => entry.id === clipId)
	if (!clip) {
		console.error(`unknown clip: ${clipId}`)
		process.exitCode = 1
		return
	}

	const engine = new WhisperCliEngine()
	await engine.init({ engineRoot: path.join(ASSETS, "whisper"), modelDir: path.join(ASSETS, "models") })
	const samples = readClipPcm16(clip.id)

	console.log(`clip      : ${clip.id} (${clip.language}, ${samples.length} samples)`)
	console.log(`reference : ${clip.expected}`)
	console.log("")
	for (const modelId of models) {
		const startedAt = Date.now()
		const result = await engine.transcribe({ samples, language: clip.language, modelId })
		const wallMs = Date.now() - startedAt
		const refWords = tokens(clip.expected)
		const hypWords = tokens(result.text)
		const substitutions = wordDistance(refWords, hypWords)
		const wer = substitutions / Math.max(1, refWords.length)
		const refChars = normalise(clip.expected).replace(/ /g, "")
		const hypChars = normalise(result.text).replace(/ /g, "")
		const cer = charDistance(refChars, hypChars) / Math.max(1, refChars.length)
		const rtf = result.audioDurationMs > 0 ? wallMs / result.audioDurationMs : Number.POSITIVE_INFINITY
		console.log(`--- ${modelId} ---`)
		console.log(`hypothesis: ${result.text}`)
		console.log(`WER=${(wer * 100).toFixed(1)}%  CER=${(cer * 100).toFixed(1)}%`)
		console.log(`wall=${wallMs}ms inference=${Math.round(result.inferenceMs ?? 0)}ms RTF=${rtf.toFixed(2)}x`)
		console.log("")
	}
	await engine.dispose()
}

void main().catch((error) => {
	console.error("quality failed:", error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
