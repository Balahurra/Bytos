import { VoiceError } from "../types"
import { SUPPORTED_LANGUAGES, type VoiceLanguage } from "./types"

/**
 * Language support for F2 (TD-5 `-l` parameter).
 *
 * Only the three languages that were actually verified with real speech are
 * offered. Anything else — including "und", "es", "" or a made-up code — is
 * rejected with a typed error rather than being forwarded to whisper, because
 * forwarding an unsupported code would produce a confident wrong transcript.
 *
 * `auto` maps to whisper's `auto`, which makes the engine run its own language
 * detection; the detected language is read back from the engine's output.
 */

const SUPPORTED = new Set<string>(["auto", ...SUPPORTED_LANGUAGES.map((entry) => entry.code)])

export function isSupportedLanguage(value: unknown): value is VoiceLanguage {
	return typeof value === "string" && SUPPORTED.has(value)
}

/** Validates and normalises a requested language code. */
export function assertSupportedLanguage(value: unknown): VoiceLanguage {
	if (isSupportedLanguage(value)) return value
	throw new VoiceError("TRANSCRIBE_LANGUAGE_UNSUPPORTED", `Unsupported voice language: ${String(value)}`)
}

/** The `-l` argument value whisper.cpp expects. */
export function whisperLanguageArg(language: VoiceLanguage): string {
	return assertSupportedLanguage(language)
}

/**
 * Maps a language code reported by whisper back onto the supported set.
 * Returns `undefined` when the engine reported something Bytos does not offer.
 */
export function normaliseDetectedLanguage(reported: string | undefined): VoiceLanguage | undefined {
	if (!reported) return undefined
	const code = reported.trim().toLowerCase()
	return SUPPORTED.has(code) && code !== "auto" ? (code as VoiceLanguage) : undefined
}

/** True when `detected` disagrees with what the user explicitly asked for. */
export function isLanguageMismatch(requested: VoiceLanguage, detected: VoiceLanguage | undefined): boolean {
	if (requested === "auto" || !detected) return false
	return requested !== detected
}
