import { describe, expect, it } from "vitest"
import { resolveVoiceUiLanguage, VOICE_UI_LANGUAGES, voiceDictationStrings } from "./dictationStrings"

/**
 * F4 — the dictation UI has to speak the user's language. These assertions pin
 * the exact button texts the acceptance criteria name, in all three languages.
 */
describe("voiceDictationStrings", () => {
	it("labels the recording action 'Metne Çevir' in Turkish", () => {
		expect(voiceDictationStrings("tr").transcribeButton).toBe("Metne Çevir")
		expect(voiceDictationStrings("tr").transcribing).toBe("Metne çevriliyor…")
		expect(voiceDictationStrings("tr").tryAgain).toBe("Yeniden dene")
	})

	it("labels the recording action 'Transcribe' in English", () => {
		expect(voiceDictationStrings("en").transcribeButton).toBe("Transcribe")
		expect(voiceDictationStrings("en").transcribing).toBe("Transcribing…")
	})

	it("labels the recording action 'In Text umwandeln' in German", () => {
		expect(voiceDictationStrings("de").transcribeButton).toBe("In Text umwandeln")
		expect(voiceDictationStrings("de").tryAgain).toBe("Erneut versuchen")
	})

	it("never says 'Stop' or 'Durdur' for the recording action", () => {
		// The whole point of F4: the button describes the outcome (text), not the
		// mechanism (stop). A "Stop" label was the reported defect.
		for (const language of VOICE_UI_LANGUAGES) {
			const label = voiceDictationStrings(language).transcribeButton
			expect(label.toLowerCase()).not.toContain("stop")
			expect(label.toLowerCase()).not.toContain("durdur")
		}
	})

	it("has every string populated in every language", () => {
		const textKeys = ["idle", "starting", "transcribeButton", "transcribeAria", "transcribing"] as const
		for (const language of VOICE_UI_LANGUAGES) {
			const strings = voiceDictationStrings(language)
			for (const key of textKeys) {
				expect(strings[key].length).toBeGreaterThan(0)
			}
			expect(strings.recording("0:05")).toContain("0:05")
		}
	})

	it("falls back to English for an unknown language", () => {
		expect(voiceDictationStrings(undefined).transcribeButton).toBe("Transcribe")
		expect(voiceDictationStrings("xx" as never).transcribeButton).toBe("Transcribe")
	})
})

describe("resolveVoiceUiLanguage", () => {
	it("prefers a pinned recognition language", () => {
		expect(resolveVoiceUiLanguage({ recognitionLanguage: "tr", editorLocale: "de-DE" })).toBe("tr")
		expect(resolveVoiceUiLanguage({ recognitionLanguage: "de", editorLocale: "en-US" })).toBe("de")
	})

	it("falls back to the editor locale when recognition is automatic", () => {
		expect(resolveVoiceUiLanguage({ recognitionLanguage: "auto", editorLocale: "tr" })).toBe("tr")
		expect(resolveVoiceUiLanguage({ recognitionLanguage: "auto", editorLocale: "tr-TR" })).toBe("tr")
		expect(resolveVoiceUiLanguage({ recognitionLanguage: "auto", editorLocale: "de-AT" })).toBe("de")
	})

	it("defaults to English when nothing is known", () => {
		expect(resolveVoiceUiLanguage({})).toBe("en")
		expect(resolveVoiceUiLanguage({ recognitionLanguage: "auto", editorLocale: "fr-FR" })).toBe("en")
	})
})
