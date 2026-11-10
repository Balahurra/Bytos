import { describe, expect, it } from "vitest"
import { appendTranscript, normaliseTranscript } from "./composerDraft"

/**
 * F4 — the composer's merge rule: a transcript is APPENDED to the draft and the
 * user's own text is never touched.
 */
describe("appendTranscript", () => {
	it("puts the transcript in an empty draft", () => {
		expect(appendTranscript("", "merhaba dünya")).toEqual({ value: "merhaba dünya", changed: true, cursor: 13 })
	})

	it("keeps the existing text and separates it with exactly one space", () => {
		expect(appendTranscript("Fix the bug", "in the parser").value).toBe("Fix the bug in the parser")
	})

	it("does not double a separator the draft already ends with", () => {
		expect(appendTranscript("Fix the bug ", "in the parser").value).toBe("Fix the bug in the parser")
		expect(appendTranscript("Line one\n", "line two").value).toBe("Line one\nline two")
		expect(appendTranscript("tab\t", "after").value).toBe("tab\tafter")
	})

	it.each(["", "   ", "\n\n", "\t"])("never rewrites the draft for blank transcript %j", (transcript) => {
		const draft = "existing text  "
		expect(appendTranscript(draft, transcript)).toEqual({ value: draft, changed: false, cursor: draft.length })
	})

	it("puts the caret at the end of the inserted text", () => {
		const result = appendTranscript("hello", "world")
		expect(result.cursor).toBe(result.value.length)
		expect(result.cursor).toBe("hello world".length)
	})

	it("never replaces the draft, even when it already ends with the same words", () => {
		expect(appendTranscript("do it", "do it").value).toBe("do it do it")
	})
})

describe("normaliseTranscript", () => {
	it("collapses newlines and runs of whitespace from the recogniser", () => {
		expect(normaliseTranscript("  birinci satır\nikinci   satır \n")).toBe("birinci satır ikinci satır")
	})

	it("preserves Turkish, English and German characters", () => {
		expect(normaliseTranscript("Güneşli bir gün")).toBe("Güneşli bir gün")
		expect(normaliseTranscript("Grüße aus München")).toBe("Grüße aus München")
		expect(normaliseTranscript("It's a test")).toBe("It's a test")
	})
})
