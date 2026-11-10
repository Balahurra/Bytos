import type { VoiceModelInfo, VoiceServiceStatus } from "@shared/proto/bytos/voice"

/**
 * F3 — presentation logic for the Settings → Voice section.
 *
 * Everything here is a pure function of host data. No state is invented: when
 * the host has not answered yet the section says "Initializing", and an
 * unavailable capability says exactly why it is unavailable.
 */

/** The runtime states the Voice section can display. */
export type VoiceRuntimeState =
	| "voice-disabled"
	| "microphone-available"
	| "microphone-unavailable"
	| "initializing"
	| "model-not-installed"
	| "model-downloading"
	| "model-verifying"
	| "model-ready"
	| "error"

export interface VoiceStatusView {
	state: VoiceRuntimeState
	/** Short label, e.g. "Microphone available". */
	label: string
	/** One sentence of host-owned detail. Never audio, never a raw stack. */
	detail: string
	/** Stable code used for colouring and tests. */
	code: string
}

const LABELS: Record<VoiceRuntimeState, string> = {
	"voice-disabled": "Voice disabled",
	"microphone-available": "Microphone available",
	"microphone-unavailable": "Microphone unavailable",
	initializing: "Initializing",
	"model-not-installed": "Model not installed",
	"model-downloading": "Model downloading",
	"model-verifying": "Model verifying",
	"model-ready": "Model ready",
	error: "Error",
}

/**
 * Human text for a stable host error code. Unknown codes fall back to the code
 * itself so nothing is silently swallowed.
 */
const ERROR_TEXT: Record<string, string> = {
	VOICE_DISABLED: "Voice is turned off. Enable it above to use the microphone.",
	PLATFORM_NOT_SUPPORTED_IN_F1: "Voice capture is available on Windows x64 only.",
	REMOTE_HOST_UNSUPPORTED:
		"Voice is unavailable in a remote session: the extension host runs on the remote machine and cannot reach your microphone.",
	WEB_UI_UNSUPPORTED: "Voice needs the desktop editor; a browser host has no microphone access.",
	CAPTURE_HELPER_MISSING: "The Windows audio capture helper is missing from this installation.",
	NO_CAPTURE_DEVICE: "No active microphone was found on this machine.",
	CAPTURE_DEVICE_NOT_FOUND: "The selected microphone is no longer connected. Pick another device.",
	MICROPHONE_ACCESS_DENIED:
		"Microphone access was denied. Allow Bytos to use the microphone in Windows Settings → Privacy & security → Microphone.",
	CAPTURE_ENUMERATION_FAILED: "The microphone list could not be read from Windows.",
	CAPTURE_METHOD_NOT_SUPPORTED: "The selected capture method is not available on this machine.",
	RECORDER_ISOLATION_UNVERIFIED: "Voice capture is held back until recorder isolation is verified.",
	WHISPER_BINARY_MISSING: "The speech recognition engine is not installed.",
	WHISPER_BINARY_INTEGRITY_FAILED: "The speech recognition engine failed its integrity check.",
	WHISPER_BINARY_UNSUPPORTED_PLATFORM: "Local speech recognition is available on Windows x64 only.",
	MODEL_NOT_INSTALLED: "The selected speech model is not installed yet.",
	MODEL_INTEGRITY_FAILED: "The model file did not match its expected checksum. Download it again.",
	MODEL_SIZE_MISMATCH: "The model file has the wrong size. Download it again.",
	MODEL_FILE_CORRUPT: "The model file is corrupt. Download it again.",
	MODEL_DOWNLOAD_FAILED: "The download failed. Check your connection and try again.",
	MODEL_CONSENT_REQUIRED: "The download needs your confirmation before it can start.",
	VOICE_INTERNAL_ERROR: "Something went wrong in the voice runtime.",
}

export function describeVoiceErrorCode(code: string): string {
	if (!code) return ""
	return ERROR_TEXT[code] ?? code
}

/**
 * The single state the runtime-status row shows, derived from real host data.
 *
 * Order matters: disabled voice is the user's own choice and is reported first;
 * then a capability that genuinely cannot capture; then microphone presence;
 * then the model lifecycle.
 */
export function deriveVoiceStatus(status: VoiceServiceStatus | undefined, options: { loading?: boolean } = {}): VoiceStatusView {
	if (!status) {
		if (options.loading) {
			return {
				state: "initializing",
				label: LABELS.initializing,
				detail: "Reading the voice engine, microphones and models…",
				code: "INITIALIZING",
			}
		}
		return {
			state: "error",
			label: LABELS.error,
			detail: "The voice service did not respond.",
			code: "VOICE_INTERNAL_ERROR",
		}
	}

	const capability = status.capability
	const reason = capability?.unavailableReason ?? ""

	if (!capability?.enabled) {
		return {
			state: "voice-disabled",
			label: LABELS["voice-disabled"],
			detail: "Voice input is turned off. Nothing is recorded while it is off.",
			code: "VOICE_DISABLED",
		}
	}

	// A capability that cannot capture for a reason other than "disabled" is a
	// real limitation of this machine, reported as such.
	if (!capability.canCapture && reason && reason !== "VOICE_DISABLED") {
		return {
			state: "microphone-unavailable",
			label: LABELS["microphone-unavailable"],
			detail: describeVoiceErrorCode(reason),
			code: reason,
		}
	}

	if (!status.microphoneAvailable) {
		const code = status.microphoneErrorCode || "NO_CAPTURE_DEVICE"
		return {
			state: "microphone-unavailable",
			label: LABELS["microphone-unavailable"],
			detail: describeVoiceErrorCode(code),
			code,
		}
	}

	if (status.engineState !== "ready") {
		const code = status.engineErrorCode || "WHISPER_BINARY_MISSING"
		return { state: "error", label: LABELS.error, detail: describeVoiceErrorCode(code), code }
	}

	const model = status.models.find((entry) => entry.id === status.modelId)
	if (!model) {
		return {
			state: "model-not-installed",
			label: LABELS["model-not-installed"],
			detail: "Choose a speech model below.",
			code: "MODEL_NOT_INSTALLED",
		}
	}
	if (model.state === "downloading") {
		return {
			state: "model-downloading",
			label: LABELS["model-downloading"],
			detail: `Downloading ${model.displayName}: ${model.progressPercent}%.`,
			code: "MODEL_DOWNLOADING",
		}
	}
	if (model.state === "verifying") {
		return {
			state: "model-verifying",
			label: LABELS["model-verifying"],
			detail: `Checking the ${model.displayName} model's checksum…`,
			code: "MODEL_VERIFYING",
		}
	}
	if (model.state === "failed") {
		const code = model.errorCode || "MODEL_INTEGRITY_FAILED"
		// "MODEL_UNVERIFIED" means the file is present but its checksum has not
		// been checked yet — the panel must ask for that check, not report a
		// corrupted download.
		if (code === "MODEL_UNVERIFIED") {
			return {
				state: "model-not-installed",
				label: LABELS["model-not-installed"],
				detail: `The ${model.displayName} model is on disk but has not been verified. Press Verify to check it.`,
				code,
			}
		}
		return { state: "error", label: LABELS.error, detail: describeVoiceErrorCode(code), code }
	}
	if (model.state !== "ready" || !status.transcribeReady) {
		return {
			state: "model-not-installed",
			label: LABELS["model-not-installed"],
			detail: `The ${model.displayName} model is not installed yet.`,
			code: "MODEL_NOT_INSTALLED",
		}
	}

	return {
		state: "model-ready",
		label: LABELS["model-ready"],
		detail: `Microphone ready and the ${model.displayName} model is verified.`,
		code: "MODEL_READY",
	}
}

/** Presentation for one model row. */
export function modelRowState(model: VoiceModelInfo): {
	label: string
	/** 0…100, or `undefined` when the row is not a progress row. */
	progress?: number
	tone: "ready" | "busy" | "idle" | "error"
} {
	switch (model.state) {
		case "ready":
			return { label: "Installed", tone: "ready" }
		case "downloading":
			return { label: `Downloading ${model.progressPercent}%`, progress: model.progressPercent, tone: "busy" }
		case "verifying":
			return { label: "Verifying…", tone: "busy" }
		case "failed":
			return {
				label: model.errorCode === "MODEL_UNVERIFIED" ? "Not verified yet" : "Failed",
				tone: model.errorCode === "MODEL_UNVERIFIED" ? "idle" : "error",
			}
		default:
			return { label: model.installed ? "Installed (unverified)" : "Not installed", tone: "idle" }
	}
}

/** Download size, matching the host's own `formatBytes` rounding. */
export function formatModelSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "unknown"
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** Language choices the recogniser actually supports. `auto` is first. */
export const VOICE_LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "auto", label: "Automatic detection" },
	{ value: "tr", label: "Türkçe" },
	{ value: "en", label: "English" },
	{ value: "de", label: "Deutsch" },
] as const
