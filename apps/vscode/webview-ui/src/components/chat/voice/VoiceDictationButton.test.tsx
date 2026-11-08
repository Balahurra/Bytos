import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { VoiceDictationController, VoiceDictationPhase } from "./useVoiceDictation"
import { formatElapsed, VoiceDictationButton, voiceStatusText } from "./VoiceDictationButton"

/**
 * F4 — the composer control's presentation, per the acceptance criteria.
 *
 * The reported defect was that the recording state showed a "Stop" glyph with no
 * text, so the user could not tell that pressing it would turn the audio into
 * text. These tests pin the labels and the phase→control mapping.
 */

function controller(phase: VoiceDictationPhase, patch: Partial<VoiceDictationController> = {}): VoiceDictationController {
	return {
		phase,
		elapsedMs: 0,
		errorCode: "",
		errorMessage: "",
		toggle: vi.fn(),
		cancel: vi.fn(),
		reset: vi.fn(),
		retry: vi.fn(),
		...patch,
	}
}

function renderButton(phase: VoiceDictationPhase, language: "tr" | "en" | "de" = "en", patch = {}) {
	return render(<VoiceDictationButton dictation={controller(phase, patch)} enabled language={language} />)
}

describe("VoiceDictationButton", () => {
	it("shows a microphone glyph when idle", () => {
		renderButton("idle")
		const button = screen.getByTestId("voice-button")
		expect(button).toHaveAttribute("data-dictation-phase", "idle")
		expect(button).toHaveAttribute("aria-label", "Voice input")
		expect(screen.queryByTestId("voice-button-label")).toBeNull()
	})

	it.each([
		["tr", "Metne Çevir"],
		["en", "Transcribe"],
		["de", "In Text umwandeln"],
	] as const)("shows the %s recording button as %s", (language, label) => {
		renderButton("recording", language)
		expect(screen.getByTestId("voice-button-label")).toHaveTextContent(label)
	})

	it("exposes the recording state to assistive tech", () => {
		renderButton("recording")
		const button = screen.getByTestId("voice-button")
		expect(button).toHaveAttribute("aria-pressed", "true")
		expect(button).toHaveAttribute("aria-label", "Stop recording and transcribe to text")
	})

	it("keeps the transcribing state labelled instead of offering a second click", () => {
		renderButton("transcribing")
		const button = screen.getByTestId("voice-button")
		expect(button).toHaveAttribute("data-dictation-phase", "transcribing")
		// A second click must not be possible while whisper runs.
		expect(button).toBeDisabled()
	})

	it("disables the button while the microphone is starting", () => {
		renderButton("initializing")
		expect(screen.getByTestId("voice-button")).toBeDisabled()
	})

	it("never renders the recording label outside the recording phase", () => {
		for (const phase of ["idle", "initializing", "transcribing", "completed", "cancelled"] as const) {
			const { unmount } = renderButton(phase, "tr")
			expect(screen.queryByTestId("voice-button-label")).toBeNull()
			unmount()
		}
	})

	it("shows the host error sentence as the title when a run fails", () => {
		renderButton("error", "tr", { errorMessage: "Mikrofon bulunamadı." })
		expect(screen.getByTestId("voice-button")).toHaveAttribute("title", "Mikrofon bulunamadı.")
	})

	it("is inert when the host reports voice unavailable", () => {
		render(<VoiceDictationButton dictation={controller("idle")} disabledReason="Sesli giriş kapalı." enabled={false} />)
		const button = screen.getByTestId("voice-button")
		expect(button).toBeDisabled()
		expect(button).toHaveAttribute("title", "Sesli giriş kapalı.")
	})
})

describe("voiceStatusText", () => {
	it("reports the elapsed recording time", () => {
		expect(voiceStatusText({ phase: "recording", elapsedMs: 72_000 }, "tr")).toBe("Kayıt 1:12")
		expect(voiceStatusText({ phase: "recording", elapsedMs: 5_000 }, "en")).toBe("Recording 0:05")
	})

	it("uses the localized transcribing and failure wording", () => {
		expect(voiceStatusText({ phase: "transcribing", elapsedMs: 0 }, "tr")).toBe("Metne çevriliyor…")
		expect(voiceStatusText({ phase: "error", elapsedMs: 0 }, "de")).toBe("Spracheingabe fehlgeschlagen")
	})

	it("says nothing when idle", () => {
		expect(voiceStatusText({ phase: "idle", elapsedMs: 0 }, "tr")).toBe("")
	})
})

describe("formatElapsed", () => {
	it("formats m:ss and never goes negative", () => {
		expect(formatElapsed(0)).toBe("0:00")
		expect(formatElapsed(9_400)).toBe("0:09")
		expect(formatElapsed(61_000)).toBe("1:01")
		expect(formatElapsed(-5)).toBe("0:00")
	})
})
