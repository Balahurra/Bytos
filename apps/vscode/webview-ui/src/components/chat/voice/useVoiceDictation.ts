import { StartCaptureRequest, TranscribeUtteranceRequest } from "@shared/proto/bytos/voice"
import { useCallback, useEffect, useRef, useState } from "react"
import { describeVoiceErrorCode } from "@/components/settings/voice/voiceStatus"
import { VoiceServiceClient } from "@/services/grpc-client"

/**
 * F4 — the composer half of Voice dictation.
 *
 * The mic button in the composer drives exactly this sequence, and nothing else
 * in the webview touches the recognition path:
 *
 *   idle ──click──► initializing ──started──► recording ──click──► transcribing
 *                       │                        │                     │
 *                       └─error──► error         └─cancel──► cancelled  └─ text ──► completed
 *
 * Guarantees this hook exists to provide:
 *  - **One run at a time.** Every entry point checks the phase before making a
 *    request, so a double click cannot open two microphones or start two
 *    recognitions. The host independently refuses a second capture
 *    (`CAPTURE_ALREADY_ACTIVE`) and a second transcription
 *    (`TRANSCRIBE_ALREADY_ACTIVE`); this is the UI half of the same rule.
 *  - **No audio here.** The webview only ever receives text and counters. The
 *    utterance stays in the extension host between `startCapture` and
 *    `transcribeUtterance`.
 *  - **No sending.** The transcript is handed to the caller as a draft. Nothing
 *    in this hook can submit a message.
 *  - **Nothing left running.** Unmount (composer closed, panel torn down) and
 *    an extension-host teardown both cancel the capture, so no helper process
 *    outlives the UI.
 */

/** Every state the mic button can present. */
export type VoiceDictationPhase = "idle" | "initializing" | "recording" | "transcribing" | "completed" | "error" | "cancelled"

export interface VoiceDictationState {
	phase: VoiceDictationPhase
	/** Elapsed recording time, for the live indicator. */
	elapsedMs: number
	/** Stable host error code, empty unless `phase === "error"`. */
	errorCode: string
	/** One sentence for the user. Never a stack trace or a local path. */
	errorMessage: string
}

export interface VoiceDictationOptions {
	/**
	 * Called with the finished transcript. The composer appends it to the draft
	 * and never sends it; empty text is never delivered.
	 */
	onTranscript: (text: string) => void
	/** `voiceLanguage` from the host ("auto" | "tr" | "en" | "de"). */
	language?: string
	/** `voiceModelId` from the host ("tiny" | "base"). */
	modelId?: string
	/**
	 * `voiceMicrophoneId` from the host. Empty means the system default.
	 *
	 * F4 regression: the composer used to send `""` unconditionally, so a
	 * microphone the user picked in Settings → Voice was never used and the wrong
	 * device recorded. The host already resolves the pin; the webview must at
	 * least forward it.
	 */
	microphoneId?: string
	/** False when the host reported Voice as unavailable for this composer. */
	enabled: boolean
}

export interface VoiceDictationController extends VoiceDictationState {
	/** Mic button click: start when idle, stop-and-transcribe when recording. */
	toggle: () => void
	/** Escape / explicit cancel: drop the audio and return to idle. */
	cancel: () => void
	/** Dismisses a completed/error state so the button returns to idle. */
	reset: () => void
	/**
	 * Starts a fresh recording after a failure, so the user does not have to
	 * dismiss the error first. A no-op unless the last run failed.
	 */
	retry: () => void
}

/** Elapsed-time tick while recording. */
const TICK_MS = 200

function messageForCode(code: string, fallback: string): string {
	return describeVoiceErrorCode(code) || fallback
}

/** Pulls the stable code out of a ProtoBus error the host threw. */
function codeFromError(error: unknown): string {
	const raw = error instanceof Error ? error.message : String(error)
	const match = /([A-Z][A-Z0-9_]{3,}):/.exec(raw)
	return match ? match[1] : "VOICE_INTERNAL_ERROR"
}

export function useVoiceDictation(options: VoiceDictationOptions): VoiceDictationController {
	const { onTranscript, language, modelId, microphoneId, enabled } = options
	const [state, setState] = useState<VoiceDictationState>({
		phase: "idle",
		elapsedMs: 0,
		errorCode: "",
		errorMessage: "",
	})

	// Refs, not state: the click handler must read the CURRENT phase and session
	// synchronously, or two clicks in the same tick would both see "idle".
	const phaseRef = useRef<VoiceDictationPhase>("idle")
	const sessionIdRef = useRef("")
	const startedAtRef = useRef(0)
	// Bumped by cancel/unmount so a late host response cannot apply its text.
	const runTokenRef = useRef(0)
	const mountedRef = useRef(true)
	// Kept in a ref so the stable callbacks below never capture a stale closure.
	const onTranscriptRef = useRef(onTranscript)
	onTranscriptRef.current = onTranscript

	const setPhase = useCallback((phase: VoiceDictationPhase, patch: Partial<VoiceDictationState> = {}) => {
		phaseRef.current = phase
		if (!mountedRef.current) return
		setState((current) => ({ ...current, errorCode: "", errorMessage: "", ...patch, phase }))
	}, [])

	const fail = useCallback(
		(code: string, message?: string) => {
			setPhase("error", { errorCode: code, errorMessage: message ?? messageForCode(code, "Voice failed.") })
		},
		[setPhase],
	)

	// Elapsed-time indicator while recording. Purely cosmetic: it reads the
	// clock, never the audio.
	useEffect(() => {
		if (state.phase !== "recording") return
		const timer = window.setInterval(() => {
			if (!mountedRef.current) return
			setState((current) =>
				current.phase === "recording" ? { ...current, elapsedMs: Date.now() - startedAtRef.current } : current,
			)
		}, TICK_MS)
		return () => window.clearInterval(timer)
	}, [state.phase])

	/** Host-side cancel; safe to call in any phase (a no-op when idle). */
	const cancelCaptureOnHost = useCallback(async () => {
		const sessionId = sessionIdRef.current
		sessionIdRef.current = ""
		if (!sessionId) return
		try {
			await VoiceServiceClient.cancelCapture({ sessionId })
		} catch {
			// Cancel must never surface as an error: the host treats an idle
			// session as a no-op and the runtime drops the audio either way.
		}
	}, [])

	const reset = useCallback(() => {
		if (phaseRef.current === "recording" || phaseRef.current === "initializing") return
		setPhase("idle", { elapsedMs: 0 })
	}, [setPhase])

	/** Escape / explicit cancel: drop the audio without producing text. */
	const cancel = useCallback(async () => {
		const phase = phaseRef.current
		if (phase === "idle" || phase === "cancelled") return
		// Invalidate any in-flight start/stop response before it can apply.
		runTokenRef.current += 1
		await cancelCaptureOnHost()
		if (!mountedRef.current) return
		setPhase("cancelled", { elapsedMs: 0 })
	}, [cancelCaptureOnHost, setPhase])

	/** Stops the capture, recognises it, and hands the TEXT to the composer. */
	const stopAndTranscribe = useCallback(async () => {
		const token = runTokenRef.current
		const sessionId = sessionIdRef.current
		setPhase("transcribing")
		try {
			// One RPC: the host stops the capture, runs whisper on the utterance
			// it already holds, and answers with text. No audio crosses ProtoBus.
			const response = await VoiceServiceClient.transcribeUtterance(
				TranscribeUtteranceRequest.create({
					sessionId,
					language: language ?? "",
					modelId: modelId ?? "",
				}),
			)
			sessionIdRef.current = ""
			if (token !== runTokenRef.current || !mountedRef.current) return
			if (!response.text) {
				// Empty or silent capture: nothing is added to the draft.
				setPhase("idle", { elapsedMs: 0 })
				return
			}
			onTranscriptRef.current(response.text)
			setPhase("completed", { elapsedMs: 0 })
		} catch (error) {
			sessionIdRef.current = ""
			if (token !== runTokenRef.current || !mountedRef.current) return
			fail(codeFromError(error))
		}
	}, [fail, language, modelId, setPhase])

	const startRecording = useCallback(async () => {
		const token = runTokenRef.current
		setPhase("initializing", { elapsedMs: 0 })
		try {
			const started = await VoiceServiceClient.startCapture(
				StartCaptureRequest.create({
					// Forward the microphone the user picked in Settings → Voice. An
					// empty string is the system default, which the host already
					// treats as "no pin".
					microphoneId: microphoneId ?? "",
					captureMethod: "auto",
					silenceTimeoutMs: 0,
					maxDurationMs: 0,
				}),
			)
			if (token !== runTokenRef.current || !mountedRef.current) {
				// Cancelled or unmounted while starting: do not leak the helper.
				await VoiceServiceClient.cancelCapture({ sessionId: started.sessionId }).catch(() => undefined)
				return
			}
			sessionIdRef.current = started.sessionId
			startedAtRef.current = Date.now()
			setPhase("recording", { elapsedMs: 0 })
		} catch (error) {
			if (token !== runTokenRef.current || !mountedRef.current) return
			fail(codeFromError(error))
		}
	}, [fail, setPhase, microphoneId])
	/**
	 * One button, six phases. Every branch re-reads the phase first, so repeated
	 * clicks can never start a second capture or a second transcription.
	 */
	const toggle = useCallback(() => {
		if (!enabled) return
		switch (phaseRef.current) {
			case "initializing":
			case "transcribing":
				// A request is in flight; ignore the click.
				return
			case "recording":
				void stopAndTranscribe()
				return
			case "cancelled":
			case "completed":
			case "error":
				// A finished run is dismissed before the next one starts, so a
				// stale result can never be mistaken for the new run.
				reset()
				// `reset` is a no-op only for a LIVE capture, which this branch
				// cannot be in; re-check through the ref so the guard stays honest
				// even if that ever changes.
				if ((phaseRef.current as VoiceDictationPhase) !== "idle") return
				void startRecording()
				return
			default:
				void startRecording()
		}
	}, [enabled, reset, startRecording, stopAndTranscribe])

	/**
	 * After a failure, "Try again" should start a new recording directly instead
	 * of making the user dismiss the error first. Any in-flight state is
	 * invalidated and the host is told to drop a half-open session before the
	 * new capture starts, so two helpers can never be alive at once.
	 */
	const retry = useCallback(() => {
		if (!enabled) return
		if (phaseRef.current !== "error") return
		runTokenRef.current += 1
		void cancelCaptureOnHost()
		void startRecording()
	}, [enabled, startRecording, cancelCaptureOnHost])

	// Teardown: composer closed, panel removed, extension host gone. Whatever is
	// running is cancelled so no capture helper and no whisper child survives.
	useEffect(() => {
		mountedRef.current = true
		return () => {
			mountedRef.current = false
			runTokenRef.current += 1
			phaseRef.current = "idle"
			void cancelCaptureOnHost()
		}
	}, [cancelCaptureOnHost])

	return { ...state, toggle, cancel, reset, retry }
}
