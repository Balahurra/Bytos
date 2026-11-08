/**
 * Internal voice types (F1 — audio capture foundation).
 *
 * Nothing in this file is ever serialised onto ProtoBus. Audio lives only in
 * `PcmFrame`s inside the extension host; the ProtoBus contract (`proto/bytos/
 * voice.proto`) carries control, metadata, status and error text.
 */

/** Normalised audio contract for F1: 16 kHz, mono, PCM16. */
export const VOICE_SAMPLE_RATE = 16000
export const VOICE_CHANNELS = 1
const VOICE_BITS_PER_SAMPLE = 16
export const VOICE_BYTES_PER_SAMPLE = VOICE_BITS_PER_SAMPLE / 8

/** A normalised chunk of audio. Never written to disk, never sent over an RPC. */
export interface PcmFrame {
	/** PCM16 little-endian samples. */
	samples: Int16Array
	/** Friendly alias for `samples.byteLength`, used by counters and caps. */
	byteLength: number
	sampleRate: number
	channels: number
	/** Capture-session-relative timestamp in ms, for silence/timeout decisions. */
	timestampMs: number
}

export type CaptureState = "idle" | "starting" | "capturing" | "stopping" | "closed" | "failed"

export type CaptureBackend = "wasapi" | "none"

export type CapturePermission = "granted" | "denied" | "unknown"

/**
 * Stable reason codes for "voice cannot capture here". Every unsupported
 * environment must report one of these instead of pretending to work.
 */
export type VoiceUnavailableReason =
	| "PLATFORM_NOT_SUPPORTED_IN_F1"
	| "REMOTE_HOST_UNSUPPORTED"
	| "WEB_UI_UNSUPPORTED"
	| "CAPTURE_HELPER_MISSING"
	| "NO_CAPTURE_DEVICE"
	| "CAPTURE_METHOD_NOT_SUPPORTED"
	| "RECORDER_ISOLATION_UNVERIFIED"
	| "VOICE_DISABLED"

export interface VoiceCapability {
	/** The single object every consumer reads. */
	canCapture: boolean
	backend: CaptureBackend
	/** Empty when `canCapture` is true. */
	reason: VoiceUnavailableReason | ""
	/** Human-readable detail (never audio). */
	detail: string
	/** e.g. "Windows 11 x64 (local)" or "Linux x64 — not supported in F1". */
	osLabel: string
	platform: NodeJS.Platform | string
	arch: string
	remoteName: string | undefined
	helperPath: string | undefined
	deviceCount: number
	permission: CapturePermission
}

export interface StopCaptureResult {
	sessionId: string
	durationMs: number
	/** 16 kHz mono PCM16 audio, held in memory only. */
	samples: Int16Array
	counters: { frames: number; bytes: number; droppedFrames: number }
	/** True when the audio was cut by `voiceMaxDurationMs`. */
	truncated: boolean
	/** Why the capture ended: user stop, silence, duration cap, or error. */
	reason: "stopped" | "silence" | "maxDuration" | "error"
}

/**
 * Typed voice error. `code` is stable and safe to show; `message` never contains
 * audio, a transcript or a stack trace that could leak local paths to the UI.
 */
export class VoiceError extends Error {
	constructor(
		public readonly code: VoiceErrorCode,
		message?: string,
	) {
		super(message ?? code)
		this.name = "VoiceError"
	}
}

export type VoiceErrorCode =
	| VoiceUnavailableReason
	// ── F2: transcription ────────────────────────────────────────────────────
	/** The whisper binary could not be found or failed its integrity check. */
	| "WHISPER_BINARY_MISSING"
	| "WHISPER_BINARY_INTEGRITY_FAILED"
	| "WHISPER_BINARY_UNSUPPORTED_PLATFORM"
	/** The requested model has not been installed. */
	| "MODEL_NOT_INSTALLED"
	| "MODEL_UNKNOWN"
	| "MODEL_INTEGRITY_FAILED"
	| "MODEL_FILE_MISSING"
	| "MODEL_FILE_CORRUPT"
	| "MODEL_DOWNLOAD_FAILED"
	| "MODEL_DOWNLOAD_ABORTED"
	| "MODEL_SIZE_MISMATCH"
	| "MODEL_CONSENT_REQUIRED"
	/** Transcription lifecycle. */
	| "TRANSCRIBE_NOT_SUPPORTED"
	| "TRANSCRIBE_ALREADY_ACTIVE"
	| "TRANSCRIBE_NO_AUDIO"
	| "TRANSCRIBE_AUDIO_INVALID"
	| "TRANSCRIBE_TIMEOUT"
	| "TRANSCRIBE_ABORTED"
	| "TRANSCRIBE_RUNTIME_DISPOSED"
	| "TRANSCRIBE_PROCESS_FAILED"
	| "TRANSCRIBE_EMPTY_OUTPUT"
	| "TRANSCRIBE_OUTPUT_INVALID"
	| "TRANSCRIBE_LANGUAGE_UNSUPPORTED"
	// ── F1: capture ──────────────────────────────────────────────────────────
	| "CAPTURE_ALREADY_ACTIVE"
	| "CAPTURE_NOT_ACTIVE"
	| "CAPTURE_SESSION_MISMATCH"
	| "CAPTURE_ILLEGAL_TRANSITION"
	| "CAPTURE_DEVICE_NOT_FOUND"
	| "CAPTURE_DEVICE_INVALIDATED"
	| "CAPTURE_UNSUPPORTED_FORMAT"
	| "CAPTURE_FRAME_CORRUPT"
	| "CAPTURE_FRAME_TOO_LARGE"
	| "CAPTURE_HELPER_FAILED"
	| "CAPTURE_HELPER_EXITED"
	| "MICROPHONE_ACCESS_DENIED"
	| "CAPTURE_ENUMERATION_FAILED"
	| "VOICE_RUNTIME_DISPOSED"
	| "CAPTURE_COM_INIT_FAILED"
	| "HELPER_INVALID_ARGUMENT"
	| "CAPTURE_NOT_INITIALIZED"
	| "CAPTURE_NO_DEVICE"
	| "CAPTURE_HELPER_ERROR"
	| "VOICE_INTERNAL_ERROR"

function isVoiceErrorCode(code: string): code is VoiceErrorCode {
	return code.length > 0 && /^[A-Z][A-Z0-9_]*$/.test(code)
}
