import { describe, expect, it } from "vitest"
import { VoiceError } from "../../types"
import {
	assertSupportedLanguage,
	isLanguageMismatch,
	isSupportedLanguage,
	normaliseDetectedLanguage,
	whisperLanguageArg,
} from "../language"
import { SUPPORTED_LANGUAGES } from "../types"

/**
 * Only the three verified languages may be offered. Anything else must be
 * rejected rather than forwarded, because whisper would happily accept an
 * arbitrary code and produce a confident wrong transcript.
 */
describe("supported languages", () => {
	it("offers exactly Turkish, English and German", () => {
		expect(SUPPORTED_LANGUAGES.map((entry) => entry.code)).toEqual(["tr", "en", "de"])
	})

	it.each(["auto", "tr", "en", "de"])("accepts %s", (language) => {
		expect(isSupportedLanguage(language)).toBe(true)
		expect(assertSupportedLanguage(language)).toBe(language)
		expect(whisperLanguageArg(language as never)).toBe(language)
	})

	it.each(["", "und", "es", "fr", "zh", "TR", "en-US", "auto ", null, undefined, 42, {}])("rejects %s", (value) => {
		expect(isSupportedLanguage(value)).toBe(false)
		expect(() => assertSupportedLanguage(value)).toThrow(VoiceError)
		expect(() => assertSupportedLanguage(value)).toThrowError(
			expect.objectContaining({ code: "TRANSCRIBE_LANGUAGE_UNSUPPORTED" }),
		)
	})

	it("carries native names for the UI phases", () => {
		const byCode = Object.fromEntries(SUPPORTED_LANGUAGES.map((entry) => [entry.code, entry.nativeName]))
		expect(byCode).toEqual({ tr: "Türkçe", en: "English", de: "Deutsch" })
	})
})

describe("detected language normalisation", () => {
	it("maps a supported detected code", () => {
		expect(normaliseDetectedLanguage("tr")).toBe("tr")
		expect(normaliseDetectedLanguage("DE")).toBe("de")
	})

	it("never reports auto as a detected language", () => {
		expect(normaliseDetectedLanguage("auto")).toBeUndefined()
	})

	it("drops a language Bytos does not offer", () => {
		expect(normaliseDetectedLanguage("es")).toBeUndefined()
		expect(normaliseDetectedLanguage(undefined)).toBeUndefined()
	})
})

describe("isLanguageMismatch", () => {
	it("is false when auto was requested", () => {
		expect(isLanguageMismatch("auto", "de")).toBe(false)
	})

	it("is true when the engine disagrees with an explicit request", () => {
		expect(isLanguageMismatch("tr", "de")).toBe(true)
	})

	it("is false when the engine agrees or nothing was detected", () => {
		expect(isLanguageMismatch("tr", "tr")).toBe(false)
		expect(isLanguageMismatch("tr", undefined)).toBe(false)
	})
})
