import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Shared access to the REAL F2 test assets: the pinned whisper engine, the two
 * pinned models, and a corpus of real speech in Turkish, English and German.
 *
 * The corpus was generated with Microsoft Edge neural TTS (`tr-TR-EmelNeural`,
 * `tr-TR-AhmetNeural`, `en-US-AriaNeural`, `en-US-GuyNeural`, `de-DE-KatjaNeural`,
 * `de-DE-ConradNeural`) and converted to 16 kHz mono PCM16 — the exact format the
 * F1 capture path produces. The generator lives in `apps/vscode/scripts/`.
 *
 * Everything here is SKIPPED when the assets are absent, so a checkout without
 * them still runs the rest of the suite instead of failing for the wrong reason.
 */
const ASSETS = path.resolve(process.cwd(), "test-assets", "voice-f2")

export const ENGINE_ROOT = path.join(ASSETS, "whisper")
export const MODEL_DIR = path.join(ASSETS, "models")
export const AUDIO_DIR = path.join(ASSETS, "audio")

export const assetsPresent = fs.existsSync(MODEL_DIR) && fs.existsSync(ENGINE_ROOT) && fs.existsSync(AUDIO_DIR)
/** `true` when a suite must be skipped because the real assets are absent. */
export const skipWithoutAssets = !assetsPresent

export interface Clip {
	id: string
	language: "tr" | "en" | "de"
	/** Transcript the engine is expected to recover (case/punctuation-flexible). */
	expected: string
	/** Words that must appear for the clip to count as correctly transcribed. */
	keywords: string[]
	durationSeconds: number
}

/**
 * The corpus. `keywords` are chosen to be language-discriminating content words
 * rather than function words, so a match is evidence of real recognition.
 */
export const CLIPS: Clip[] = [
	{
		id: "en_numbers",
		language: "en",
		expected: "The quick brown fox jumps over the lazy dog.",
		keywords: ["quick", "brown", "fox", "jumps", "lazy", "dog"],
		durationSeconds: 3.48,
	},
	{
		id: "en_hello",
		language: "en",
		expected: "Hello, this is a voice transcription test for the Bytos editor extension.",
		keywords: ["hello", "voice", "transcription", "test", "editor", "extension"],
		durationSeconds: 5.33,
	},
	{
		id: "tr_merhaba",
		language: "tr",
		expected: "Merhaba, bu bir ses tanıma testidir. Bytos kod düzenleyicisi için çalışıyor.",
		keywords: ["merhaba", "ses", "tanıma", "testidir"],
		durationSeconds: 6.65,
	},
	{
		id: "tr_komut",
		language: "tr",
		expected: "Lütfen dosyayı aç ve içindeki hataları düzelt.",
		keywords: ["lütfen", "dosyayı", "hataları", "düzelt"],
		durationSeconds: 4.25,
	},
	{
		id: "de_hallo",
		language: "de",
		expected: "Guten Tag, dies ist ein Test für die Spracherkennung.",
		keywords: ["guten", "tag", "test", "spracherkennung"],
		durationSeconds: 4.3,
	},
	{
		id: "de_satz",
		language: "de",
		expected: "Bitte öffne die Datei und behebe die Fehler im Code.",
		keywords: ["bitte", "öffne", "datei", "fehler"],
		durationSeconds: 3.82,
	},
]

/** Reads a corpus clip as 16 kHz mono PCM16 — exactly what F1 hands over. */
export function readClipPcm16(id: string): Int16Array {
	const buffer = fs.readFileSync(path.join(AUDIO_DIR, `${id}.wav`))
	// 44-byte canonical header; the fixtures are all plain PCM16.
	const data = buffer.subarray(44)
	const samples = new Int16Array(data.length / 2)
	for (let i = 0; i < samples.length; i++) {
		samples[i] = data.readInt16LE(i * 2)
	}
	return samples
}

/** Lower-cases and strips punctuation so comparisons are about words, not glyphs. */
export function normaliseForComparison(text: string): string {
	return text
		.toLocaleLowerCase("tr")
		.replace(/[.,!?;:"'()[\]{}…‑–—]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
}

/** How many of `keywords` appear in `text` (case/punctuation-insensitive). */
export function matchedKeywords(text: string, keywords: string[]): string[] {
	const haystack = normaliseForComparison(text)
	return keywords.filter((keyword) => haystack.includes(normaliseForComparison(keyword)))
}

/** Generates `seconds` of digital silence at 16 kHz. */
export function silence(seconds: number): Int16Array {
	return new Int16Array(Math.round(seconds * 16000))
}

/** Generates low-amplitude noise: "not silence, but not speech". */
export function noise(seconds: number, amplitude = 400): Int16Array {
	const samples = new Int16Array(Math.round(seconds * 16000))
	let seed = 12345
	for (let i = 0; i < samples.length; i++) {
		// Deterministic LCG so the fixture is reproducible.
		seed = (seed * 1103515245 + 12345) & 0x7fffffff
		samples[i] = Math.round(((seed / 0x7fffffff) * 2 - 1) * amplitude)
	}
	return samples
}
