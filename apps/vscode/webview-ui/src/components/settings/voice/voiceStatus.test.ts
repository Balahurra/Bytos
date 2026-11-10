import type { VoiceModelInfo, VoiceServiceStatus } from "@shared/proto/bytos/voice"
import { describe, expect, it } from "vitest"
import {
	deriveVoiceStatus,
	describeVoiceErrorCode,
	formatModelSize,
	modelRowState,
	VOICE_LANGUAGES,
} from "@/components/settings/voice/voiceStatus"

/**
 * F3 — the Voice section's state derivation.
 *
 * Every case is a pure function of a host payload. These tests pin the rule that
 * the panel never invents a state: a missing payload is "Initializing" (or an
 * error), never "ready".
 */

function model(overrides: Partial<VoiceModelInfo> = {}): VoiceModelInfo {
	return {
		id: "base",
		displayName: "Base",
		sizeBytes: 147951465,
		fileName: "ggml-base.bin",
		multilingual: true,
		progressPercent: 0,
		installed: false,
		verified: false,
		state: "not-installed",
		errorCode: "",
		isDefault: true,
		approxMemoryMb: 297,
		...overrides,
	}
}

const baseCapability = {
	enabled: true,
	canCapture: true,
	backend: "wasapi",
	unavailableReason: "",
	permissionGranted: true,
	deviceCount: 2,
	selectedMicrophoneId: "",
	captureState: "idle",
	framesReceived: 0,
	bytesReceived: 0,
	lastErrorCode: "",
	lastErrorMessage: "",
	activeSessionDurationMs: 0,
	osLabel: "Windows x64 (local)",
}

function status(overrides: Partial<VoiceServiceStatus> = {}): VoiceServiceStatus {
	return {
		capability: { ...baseCapability },
		language: "auto",
		modelId: "base",
		models: [model()],
		engineState: "ready",
		engineErrorCode: "",
		transcribeReady: false,
		microphoneAvailable: true,
		microphoneErrorCode: "",
		devices: [{ id: "dev-a", name: "Microphone Array", state: "active", isDefault: true }],
		...overrides,
	}
}

describe("deriveVoiceStatus — the nine runtime states", () => {
	it("says Initializing while the host has not answered", () => {
		expect(deriveVoiceStatus(undefined, { loading: true }).state).toBe("initializing")
	})

	it("says Error when the host never answered at all", () => {
		const view = deriveVoiceStatus(undefined, { loading: false })
		expect(view.state).toBe("error")
		expect(view.code).toBe("VOICE_INTERNAL_ERROR")
	})

	it("reports Voice Disabled first, even if a microphone exists", () => {
		const view = deriveVoiceStatus(
			status({
				capability: { ...baseCapability, enabled: false, canCapture: false, unavailableReason: "VOICE_DISABLED" },
			}),
		)
		expect(view.state).toBe("voice-disabled")
		expect(view.label).toBe("Voice disabled")
	})

	it("reports Microphone Unavailable with the real reason", () => {
		const view = deriveVoiceStatus(
			status({
				capability: { ...baseCapability, canCapture: false, unavailableReason: "REMOTE_HOST_UNSUPPORTED" },
				microphoneAvailable: false,
				microphoneErrorCode: "REMOTE_HOST_UNSUPPORTED",
			}),
		)
		expect(view.state).toBe("microphone-unavailable")
		expect(view.detail).toContain("remote session")
	})

	it("reports Microphone Unavailable when enumeration found no device", () => {
		const view = deriveVoiceStatus(
			status({ microphoneAvailable: false, microphoneErrorCode: "NO_CAPTURE_DEVICE", devices: [] }),
		)
		expect(view.state).toBe("microphone-unavailable")
		expect(view.detail).toBe("No active microphone was found on this machine.")
	})

	it("reports Model Not Installed when the selected model is absent", () => {
		expect(deriveVoiceStatus(status()).state).toBe("model-not-installed")
	})

	it("reports Model Downloading with the live percentage", () => {
		const view = deriveVoiceStatus(status({ models: [model({ state: "downloading", progressPercent: 42 })] }))
		expect(view.state).toBe("model-downloading")
		expect(view.detail).toContain("42%")
	})

	it("reports Model Verifying", () => {
		expect(deriveVoiceStatus(status({ models: [model({ state: "verifying" })] })).state).toBe("model-verifying")
	})

	it("reports Model Ready only when the host says transcribe is ready", () => {
		const ready = deriveVoiceStatus(
			status({ models: [model({ state: "ready", installed: true, verified: true })], transcribeReady: true }),
		)
		expect(ready.state).toBe("model-ready")

		// A ready model with an engine that cannot run is NOT ready.
		const engineBroken = deriveVoiceStatus(
			status({ models: [model({ state: "ready", installed: true, verified: true })], transcribeReady: false }),
		)
		expect(engineBroken.state).toBe("model-not-installed")
	})

	it("reports Error for a failed verification, with the host's code", () => {
		const view = deriveVoiceStatus(
			status({ models: [model({ state: "failed", installed: true, errorCode: "MODEL_INTEGRITY_FAILED" })] }),
		)
		expect(view.state).toBe("error")
		expect(view.code).toBe("MODEL_INTEGRITY_FAILED")
		expect(view.detail).toContain("checksum")
	})

	it("reports Error when the engine is missing", () => {
		const view = deriveVoiceStatus(status({ engineState: "missing", engineErrorCode: "WHISPER_BINARY_MISSING" }))
		expect(view.state).toBe("error")
		expect(view.detail).toBe("The speech recognition engine is not installed.")
	})
})

describe("modelRowState", () => {
	it("describes each model state, with progress only while downloading", () => {
		expect(modelRowState(model({ state: "ready" }))).toEqual({ label: "Installed", tone: "ready" })
		expect(modelRowState(model({ state: "downloading", progressPercent: 17 }))).toEqual({
			label: "Downloading 17%",
			progress: 17,
			tone: "busy",
		})
		expect(modelRowState(model({ state: "verifying" }))).toEqual({ label: "Verifying…", tone: "busy" })
		expect(modelRowState(model({ state: "failed" }))).toEqual({ label: "Failed", tone: "error" })
		expect(modelRowState(model({ state: "not-installed", installed: false }))).toEqual({
			label: "Not installed",
			tone: "idle",
		})
		// A file exists but was never verified: never plain "Installed".
		expect(modelRowState(model({ state: "not-installed", installed: true })).label).toBe("Installed (unverified)")
	})
})

describe("describeVoiceErrorCode", () => {
	it("maps known codes to human text and passes unknown ones through", () => {
		expect(describeVoiceErrorCode("MICROPHONE_ACCESS_DENIED")).toContain("Microphone access was denied")
		expect(describeVoiceErrorCode("SOME_NEW_CODE")).toBe("SOME_NEW_CODE")
		expect(describeVoiceErrorCode("")).toBe("")
	})
})

describe("formatModelSize", () => {
	it("matches the host's MiB rounding", () => {
		expect(formatModelSize(147951465)).toBe("141.1 MiB")
		expect(formatModelSize(77691713)).toBe("74.1 MiB")
		expect(formatModelSize(0)).toBe("unknown")
	})
})

describe("VOICE_LANGUAGES", () => {
	it("offers exactly the languages the recogniser supports", () => {
		expect(VOICE_LANGUAGES.map((entry) => entry.value)).toEqual(["auto", "tr", "en", "de"])
	})
})
