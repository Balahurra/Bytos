import { normaliseTranscript } from "./whisperArgs"

/**
 * Rejects transcripts that are not speech (F2-g).
 *
 * ## Why this exists — measured on the pinned build
 *
 * Whisper does not return empty text for non-speech. Measured on the pinned
 * `b5454` build with digital silence and with quiet noise, on both models:
 *
 * | Input | `tiny` | `base` |
 * |---|---|---|
 * | 1 s / 3 s digital silence | `"you"` | `"you"` |
 * | 3 s noise @ 200 | `[BIRDS CHIRPING]` | `[BLANK_AUDIO]` |
 * | 3 s noise @ 400 | `(birds chirping)` | `[BLANK_AUDIO]` |
 *
 * Returning `"you"` to the composer for a silent microphone would be a visible
 * product defect and, in a voice-driven editor, a correctness and safety one. So
 * two independent guards apply:
 *
 * 1. **Energy gate (before spawning).** If the utterance has no frame above a
 *    speech-plausible RMS floor, no recogniser runs at all. This is cheap, and it
 *    is the same class of check F1 already uses (`SilenceDetector`).
 * 2. **Annotation filter (after the run).** Whisper's stock annotations
 *    (`[BLANK_AUDIO]`, `[BIRDS CHIRPING]`, `(birds chirping)`, `[MUSIC]`, …) and
 *    its silence token (`you` alone) are removed.
 *
 * Neither guard touches real speech: the thresholds are deliberately generous,
 * and the annotation filter only fires on bracketed/parenthesised non-speech
 * markers or the single-word silence token.
 */

/**
 * RMS floor below which an utterance is treated as containing no speech.
 *
 * Measured on the reference laptop's built-in microphone array (WASAPI, 16 kHz
 * mono, normal speaking distance): real speech produces 100 ms frame RMS of
 * ≈ 20–165 PCM16, with a median of ≈ 24 and a 90th percentile of ≈ 64, while
 * room tone sits at ≈ 5–21. A floor of 100 therefore rejected genuine speech —
 * only 7.9 % of frames cleared it and `containsSpeech` returned false, so the
 * recogniser was never even started (F4 regression).
 *
 * The floor is now 60: comfortably above measured room tone (≈ 21) and well
 * below the median speech frame, so soft speech still passes while digital
 * silence and low-level noise do not. The original 100 was calibrated for a
 * studio-level fixture at amplitude 200/400, not for a real device.
 */
export const SPEECH_RMS_FLOOR = 60

/**
 * Ceiling for the adaptive floor (600 PCM16).
 *
 * A genuinely noisy recording can raise its own floor, but the gate must never
 * climb so high that a normal speaking voice is classified as silence. 600 is
 * still an order of magnitude below loud speech.
 */
export const SPEECH_RMS_MAX_FLOOR = 600

/**
 * Fraction of 100 ms frames that must clear the floor for the utterance to count
 * as speech.
 *
 * Speech is not continuous: the measured real captures had a median frame well
 * below their loudest frames because of natural pauses between words. An earlier
 * value of 0.34 rejected genuine speech (measured: 13.9 % of frames cleared an
 * absolute floor, yet the audio was clearly a spoken sentence), so the recogniser
 * was never started and the composer received no text (F4 regression).
 *
 * 0.10 still rejects a lone keyboard tap or a single click in an otherwise
 * silent recording (1 frame in 20 = 5 %), which is what this gate is for.
 */
export const MIN_SPEECH_FRAME_RATIO = 0.1

/** Frame size for the energy gate (~100 ms at 16 kHz). */
const FRAME_SAMPLES = 1600

/** Root-mean-square amplitude of a PCM16 block. */
export function rms(samples: Int16Array): number {
	if (samples.length === 0) return 0
	let sum = 0
	for (let i = 0; i < samples.length; i++) {
		const value = samples[i]
		sum += value * value
	}
	return Math.sqrt(sum / samples.length)
}

/**
 * How far above the utterance's own noise floor a frame must sit to count as
 * loud. 2.5× ⇒ ≈ +8 dB, the same margin `SilenceDetector` uses.
 */
export const SPEECH_FLOOR_MULTIPLIER = 2.5

/**
 * True when the audio plausibly contains speech.
 *
 * The floor is **adaptive**: when no explicit `rmsFloor` is supplied, the
 * utterance's own noise floor is estimated from its quietest frames and the gate
 * is placed {@link SPEECH_FLOOR_MULTIPLIER} above it, clamped to
 * [{@link SPEECH_RMS_FLOOR}, {@link SPEECH_RMS_MAX_FLOOR}].
 *
 * A single absolute floor cannot work across devices: measured on the reference
 * laptop, real speech had a median 100 ms frame RMS of 39 PCM16 with a 90th
 * percentile of 75, while a studio-level fixture would sit in the thousands. A
 * fixed floor of 100 classified that real sentence as "no speech" and the
 * recogniser was never started, so no text reached the composer (F4 regression).
 *
 * The ratio test still applies, so a lone click in silence is not speech: it is
 * cheap, and it runs before any recogniser process is spawned.
 */
export function containsSpeech(
	samples: Int16Array,
	options: { rmsFloor?: number; minFrameRatio?: number; noiseFloorMultiplier?: number } = {},
): boolean {
	if (!(samples instanceof Int16Array) || samples.length === 0) return false
	const ratio = options.minFrameRatio ?? MIN_SPEECH_FRAME_RATIO

	if (samples.length <= FRAME_SAMPLES) {
		const floor = options.rmsFloor ?? SPEECH_RMS_FLOOR
		return rms(samples) >= floor
	}

	const frameLevels: number[] = []
	for (let offset = 0; offset + FRAME_SAMPLES <= samples.length; offset += FRAME_SAMPLES) {
		frameLevels.push(rms(samples.subarray(offset, offset + FRAME_SAMPLES)))
	}
	if (frameLevels.length === 0) return false

	const floor = options.rmsFloor ?? adaptiveFloor(frameLevels, options.noiseFloorMultiplier)
	const loud = frameLevels.filter((level) => level >= floor).length
	return loud / frameLevels.length >= ratio
}

/**
 * Gate derived from the utterance itself: the quiet end of its frame
 * distribution (10th percentile) times a margin, clamped to a sane band.
 *
 * The 10th percentile — not the minimum — is used so one perfectly silent packet
 * cannot drive the floor to zero and turn room tone into "speech".
 */
function adaptiveFloor(frameLevels: number[], multiplier = SPEECH_FLOOR_MULTIPLIER): number {
	const sorted = [...frameLevels].sort((a, b) => a - b)
	const quiet = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.1))]
	const target = quiet * multiplier
	return Math.min(SPEECH_RMS_MAX_FLOOR, Math.max(SPEECH_RMS_FLOOR, target))
}

/**
 * Stock annotations whisper emits for non-speech, matched case-insensitively and
 * with or without brackets, e.g. `[BLANK_AUDIO]`, `(birds chirping)`,
 * `*music*`, `[MUSIC]`, `[ Silence ]`.
 *
 * F4: whisper annotates in the REQUESTED language, so a Turkish or German
 * utterance produces `[MÜZİK ÇALIYOR]`, `[Applaus]` or `[Musik]` rather than the
 * English marker. Every term is therefore listed in all three languages Bytos
 * supports — otherwise the annotation reached the composer as if the user had
 * said it (observed on a real German capture: the draft received "[Applaus]").
 */
const ANNOTATION_PATTERN = new RegExp(
	"^[\\s*[({[]*(" +
		[
			// English
			"blank[_\\s-]?audio",
			"silence",
			"silent",
			"music",
			"applause",
			"applaus",
			"laughs?",
			"laughter",
			"birds?[_\\s-]?chirping",
			"no[_\\s-]?speech",
			"inaudible",
			"noise",
			"static",
			"beep(ing)?",
			"typing",
			"clicking",
			// Turkish. The dotted capital `İ` is handled in `isAnnotationLine`,
			// which strips its combining dot before matching.
			"m[uü]z[ıi]k(\\s+[cç]al[ıi]yor)?",
			"alk[ıi][sş]",
			"g[uü]lme",
			"g[uü]l[uü][sş]",
			"ku[sş]\\s+ses(leri|i)",
			"konu[sş]ma\\s+yok",
			"sessizlik",
			"ses\\s+yok",
			"anla[şs][ıi]lm[ıi]yor",
			// German
			"musik",
			"applaus",
			"gel[äa]chter",
			"lachen",
			"vogel(ge)?zwitscher(n)?",
			"keine\\s+sprache",
			"stille",
			"unverst[äa]ndlich",
			"ger[äa]usch(e)?",
			"tippen",
		].join("|") +
		")[\\s*)\\]}:.!]*$",
	"i",
)

/** Whole-line annotations, e.g. a transcript that is only `[MUSIC]`. */
function isAnnotationLine(line: string): boolean {
	// Turkish `İ` (U+0130) does not fold to a plain `i` under a case-insensitive
	// regex — JS maps it to "i" + U+0307 COMBINING DOT ABOVE, which no ASCII
	// character class matches. Folding the dotted/dotless I to `i` up front makes
	// `MÜZİK`, `Müzik` and `müzik` all match the same pattern.
	const folded = line.trim().replace(/[\u0130\u0131]/g, "i")
	return ANNOTATION_PATTERN.test(folded)
}

/**
 * The single-word tokens whisper emits when it finds nothing to transcribe.
 * `you` is the measured silence token on this build; the others are its
 * well-known siblings. They are only rejected when they are the ENTIRE
 * transcript, so a real "you" inside a sentence is untouched.
 */
const SILENCE_TOKENS = new Set(["you", "thank you.", "thanks for watching!", "thank you for watching."])

/**
 * Removes non-speech annotations and silence tokens from a transcript.
 *
 * Real sentences are returned unchanged apart from whitespace normalisation.
 */
export function filterHallucinations(text: string): { text: string; removed: string[] } {
	const removed: string[] = []
	const lines = text.split(/\r?\n/)
	const kept: string[] = []
	for (const line of lines) {
		const trimmed = line.trim()
		if (trimmed.length === 0) continue
		if (isAnnotationLine(trimmed)) {
			removed.push(trimmed)
			continue
		}
		kept.push(trimmed)
	}
	const joined = normaliseTranscript(kept.join(" "))
	if (joined.length === 0) {
		return { text: "", removed }
	}
	// Only when the WHOLE transcript is a silence token does it get removed.
	const lower = joined.toLowerCase()
	if (SILENCE_TOKENS.has(lower)) {
		removed.push(joined)
		return { text: "", removed }
	}
	return { text: joined, removed }
}
