import { SilenceDetector } from "./audio/SilenceDetector"
import { UtteranceBuffer } from "./audio/UtteranceBuffer"
import { AudioCaptureCoordinator, type CaptureMethod, FrameNormaliser } from "./capture/AudioCaptureCoordinator"
import { rms } from "./transcription/speechGuard"
import type { ModelId, RecognitionEngine, TranscribeResult, VoiceLanguage } from "./transcription/types"
import {
	type CaptureState,
	type PcmFrame,
	type StopCaptureResult,
	VOICE_SAMPLE_RATE,
	type VoiceCapability,
	VoiceError,
	type VoiceErrorCode,
} from "./types"

/**
 * Lifetime owner for voice capture (TD-14, TD-15).
 *
 * It is constructed lazily (never imported at extension start), owns the
 * coordinator and the single in-memory utterance buffer, enforces the
 * idle → starting → capturing → stopping → closed state machine, and guarantees
 * that `dispose()` leaves no helper process and no retained audio behind.
 *
 * Audio never leaves this object except as the returned `Int16Array` of a
 * completed utterance. There is no file sink and no RPC sink anywhere.
 */

export interface VoiceRuntimeOptions {
	silenceTimeoutMs?: number
	maxDurationMs?: number
	/** Buffer byte cap; defaults to the UtteranceBuffer default. */
	maxBytes?: number
	/** Injected for tests. */
	now?: () => number
	/**
	 * F2 recognition engine. Optional: F1 capture works without one, and callers
	 * that never transcribe never construct it (TD-15 lazy-construction rule).
	 * `VoiceRuntime` owns its lifetime from the moment it is passed in.
	 */
	recognitionEngine?: RecognitionEngine
	/** Default model for `transcribeLastUtterance`. */
	defaultModelId?: ModelId
	/** Per-utterance recognition ceiling. */
	transcribeTimeoutMs?: number
}

export type VoiceEventName = "captureStatus" | "error" | "captureStopped"

export interface VoiceEventPayload {
	kind: VoiceEventName
	sessionId: string
	captureState: CaptureState
	durationMs: number
	bytesReceived: number
	code?: string
	message?: string
}

export interface CaptureSnapshot {
	state: CaptureState
	sessionId: string
	framesReceived: number
	bytesReceived: number
	droppedFrames: number
	durationMs: number
	lastErrorCode?: string
	lastErrorMessage?: string
	selectedMicrophoneId?: string
}

const ALLOWED: Record<CaptureState, CaptureState[]> = {
	idle: ["starting", "closed"],
	starting: ["capturing", "failed", "closed"],
	capturing: ["stopping", "failed", "closed"],
	stopping: ["idle", "failed", "closed"],
	failed: ["idle", "closed"],
	closed: [],
}

export class VoiceRuntime {
	private state: CaptureState = "idle"
	private sessionCounter = 0
	private sessionId = ""
	private buffer: UtteranceBuffer
	private silence: SilenceDetector
	private normaliser = new FrameNormaliser()
	private frames = 0
	private bytes = 0
	private dropped = 0
	private captureStartedAt = 0
	private lastErrorCode: string | undefined
	private lastErrorMessage: string | undefined
	private unsubscribeFrames: (() => void) | undefined
	private disposeStarted = false
	private readonly listeners = new Set<(event: VoiceEventPayload) => void>()
	private readonly now: () => number
	private readonly silenceTimeoutMs: number
	private readonly maxDurationMs: number
	private readonly maxBytes: number | undefined
	private readonly recognitionEngineOption: RecognitionEngine | undefined
	private readonly defaultModelIdOption: ModelId | undefined
	private readonly transcribeTimeoutMs: number | undefined
	/** Abort handle of the transcription currently running, if any. */
	private transcribeAbort: AbortController | undefined
	/** The capability this runtime was built with, replaced by `refreshCapability`. */
	private capabilityOption: VoiceCapability
	/**
	 * The last utterance the runtime stopped ON ITS OWN (silence seal or the
	 * duration cap), held until the caller asks for it or starts a new capture.
	 *
	 * Why this exists (F4 regression): the detector seals an utterance when the
	 * speaker pauses, and `stopCapture()` used to hand the samples to nobody. The
	 * composer's "Metne Çevir" click then ran against an `idle` runtime with an
	 * empty buffer and produced no text at all. Retaining the sealed utterance
	 * means the click still has audio to transcribe, whichever way the capture
	 * ended. It is cleared by `drain`, by the next `startCapture`, by
	 * `cancelCapture` and by `dispose`, so nothing accumulates.
	 */
	private retained: { samples: Int16Array; reason: StopCaptureResult["reason"]; sessionId: string } | undefined
	/**
	 * Quietest per-frame RMS observed in the current session (0..1 scale). It is
	 * the room-tone estimate the adaptive silence gate is derived from, and it is
	 * reset with the session so a new recording re-measures its own floor.
	 */
	private noiseFloorRms: number | undefined

	constructor(
		capability: VoiceCapability,
		public readonly coordinator: AudioCaptureCoordinator,
		options: VoiceRuntimeOptions = {},
	) {
		this.capabilityOption = capability
		this.now = options.now ?? (() => Date.now())
		this.silenceTimeoutMs = options.silenceTimeoutMs ?? 1200
		this.maxDurationMs = options.maxDurationMs ?? 120000
		this.maxBytes = options.maxBytes
		this.recognitionEngineOption = options.recognitionEngine
		this.defaultModelIdOption = options.defaultModelId
		this.transcribeTimeoutMs = options.transcribeTimeoutMs
		this.silence = new SilenceDetector({ timeoutMs: this.silenceTimeoutMs })
		this.buffer = new UtteranceBuffer({ maxDurationMs: this.maxDurationMs, maxBytes: this.maxBytes })
	}

	// ── observation ──────────────────────────────────────────────────────────

	get captureState(): CaptureState {
		return this.state
	}

	/**
	 * The host-owned capability object.
	 *
	 * F3 made this a getter over a replaceable field: the singleton runtime is
	 * built on the first status read, and `voiceEnabled` is a persisted setting
	 * the user can flip afterwards. Freezing the first value would leave the UI
	 * reporting "Voice disabled" forever after the user enabled it.
	 */
	get capability(): VoiceCapability {
		return this.capabilityOption
	}

	/**
	 * Applies the current persisted settings to the capability.
	 *
	 * Only the settings-driven part changes (`voiceEnabled` → `canCapture` and
	 * `reason`); platform, helper and recorder-isolation facts are recomputed by
	 * the caller and passed in whole.
	 */
	refreshCapability(next: VoiceCapability): void {
		this.capabilityOption = next
	}

	get currentSessionId(): string {
		return this.sessionId
	}

	get recorderIsolationVerified(): boolean {
		return this.capability.reason !== "RECORDER_ISOLATION_UNVERIFIED"
	}

	snapshot(selectedMicrophoneId?: string): CaptureSnapshot {
		return {
			state: this.state,
			sessionId: this.sessionId,
			framesReceived: this.frames,
			bytesReceived: this.bytes,
			droppedFrames: this.dropped,
			durationMs:
				this.state === "capturing" || this.state === "stopping" ? Math.max(0, this.now() - this.captureStartedAt) : 0,
			lastErrorCode: this.lastErrorCode,
			lastErrorMessage: this.lastErrorMessage,
			selectedMicrophoneId,
		}
	}

	onEvent(listener: (event: VoiceEventPayload) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private emit(kind: VoiceEventName, extra: Partial<VoiceEventPayload> = {}): void {
		const payload: VoiceEventPayload = {
			kind,
			sessionId: this.sessionId,
			captureState: this.state,
			durationMs: this.captureStartedAt > 0 ? Math.max(0, this.now() - this.captureStartedAt) : 0,
			bytesReceived: this.bytes,
			...extra,
		}
		for (const listener of this.listeners) {
			try {
				listener(payload)
			} catch {
				this.listeners.delete(listener)
			}
		}
	}

	private transition(to: CaptureState): void {
		if (this.state === to) return
		if (!ALLOWED[this.state].includes(to)) {
			throw new VoiceError("CAPTURE_ILLEGAL_TRANSITION", `${this.state} → ${to}`)
		}
		this.state = to
	}

	async startCapture(options: {
		deviceId?: string
		captureMethod?: CaptureMethod | string
		silenceTimeoutMs?: number
		maxDurationMs?: number
		signal?: AbortSignal
	}): Promise<{ sessionId: string; sampleRate: number; channels: number; backend: string }> {
		if (this.disposeStarted) {
			throw new VoiceError("VOICE_RUNTIME_DISPOSED")
		}
		if (this.state === "capturing" || this.state === "starting") {
			throw new VoiceError("CAPTURE_ALREADY_ACTIVE")
		}
		if (!this.recorderIsolationVerified) {
			// Hard gate: no audio-carrying path may run before T1 is verified.
			throw new VoiceError("RECORDER_ISOLATION_UNVERIFIED")
		}
		if (!this.capability.canCapture) {
			throw new VoiceError((this.capability.reason || "VOICE_DISABLED") as VoiceErrorCode, this.capability.detail)
		}
		if (this.state === "failed" || this.state === "stopping") {
			this.transition("idle")
		}

		this.transition("starting")
		// A new capture supersedes any utterance retained from the previous one;
		// keeping both would let a stale transcript land in a fresh recording.
		this.retained = undefined
		this.resetSessionState()
		this.sessionCounter += 1
		this.sessionId = `voice-${this.sessionCounter}`
		this.captureStartedAt = this.now()
		this.emit("captureStatus")

		try {
			const started = await this.coordinator.start({ deviceId: options.deviceId, signal: options.signal })
			this.attachFrameListener()
			this.transition("capturing")
			this.emit("captureStatus")
			return { sessionId: this.sessionId, ...started }
		} catch (error) {
			const code = error instanceof VoiceError ? error.code : "VOICE_INTERNAL_ERROR"
			this.lastErrorCode = code
			this.lastErrorMessage = error instanceof Error ? error.message : String(error)
			this.state = "failed"
			this.emit("error", { code, message: this.lastErrorMessage })
			this.buffer.clear()
			this.unsubscribeFrames?.()
			this.unsubscribeFrames = undefined
			await this.coordinator.cancel().catch(() => undefined)
			throw error instanceof VoiceError ? error : new VoiceError("VOICE_INTERNAL_ERROR", this.lastErrorMessage)
		}
	}

	private attachFrameListener(): void {
		this.unsubscribeFrames?.()
		this.unsubscribeFrames = this.coordinator.onFrames((frame) => this.handleFrame(frame))
	}

	private handleFrame(rawFrame: PcmFrame): void {
		if (this.state !== "capturing") return
		const frame = this.normaliser.normalise(rawFrame)
		const durationMs = (frame.samples.length / frame.sampleRate) * 1000
		const appended = this.buffer.append(frame.samples)
		if (appended.accepted) {
			this.frames += 1
			this.bytes += frame.samples.length * 2
		}
		if (appended.truncated) {
			this.dropped += 1
		}

		// Adaptive silence gate: track the quietest frames seen so far as the
		// room-tone floor. A device whose floor is loud raises the gate; a quiet
		// one lowers it, so a normal speaking voice is never mistaken for silence
		// (F4 regression: a fixed gate sealed the utterance mid-sentence).
		const frameRms = rms(frame.samples) / 32768
		if (frameRms > 0) {
			this.noiseFloorRms = this.noiseFloorRms === undefined ? frameRms : Math.min(this.noiseFloorRms, frameRms)
			this.silence.observeNoiseFloor(this.noiseFloorRms)
		}

		const silence = this.silence.update(frame.samples, durationMs)
		if (silence.sealed) {
			// Silence seals the utterance; stop the stream and keep what we have.
			// `stopCapture` retains the sealed audio so the composer's
			// "Metne Çevir" click can still transcribe it.
			void this.stopCapture({ reason: "silence" }).catch(() => undefined)
			return
		}
		if (this.buffer.isSealed) {
			// Bounded buffer: stop instead of dropping audio without telling anyone.
			void this.stopCapture({ reason: "maxDuration" }).catch(() => undefined)
		}
	}

	/** Stop capture and hand back the in-memory utterance. */
	async stopCapture(options: { reason?: StopCaptureResult["reason"] } = {}): Promise<StopCaptureResult> {
		if (this.state !== "capturing" && this.state !== "starting") {
			throw new VoiceError("CAPTURE_NOT_ACTIVE")
		}
		this.transition("stopping")
		this.emit("captureStatus")
		this.unsubscribeFrames?.()
		this.unsubscribeFrames = undefined
		try {
			await this.coordinator.stop()
		} catch {
			// The helper may already be gone; the buffer is what matters.
		}
		const samples = this.buffer.toInt16Array()
		const reason = options.reason ?? "stopped"
		const result: StopCaptureResult = {
			sessionId: this.sessionId,
			durationMs: (samples.length / VOICE_SAMPLE_RATE) * 1000,
			samples,
			counters: { frames: this.frames, bytes: this.bytes, droppedFrames: this.dropped },
			truncated: this.buffer.isTruncated,
			reason,
		}
		// Audio is handed to the caller (F2 feeds it to whisper); the runtime
		// keeps no second copy in the buffer, so cancel/dispose cannot leak it.
		this.buffer.clear()
		// An AUTOMATIC stop (silence seal / duration cap) has no caller waiting
		// for the return value — the composer is still showing "recording".
		// Retain the utterance so the next "Metne Çevir" click can transcribe
		// it instead of finding an empty buffer and producing no text.
		if (reason !== "stopped") {
			this.retained = { samples, reason, sessionId: this.sessionId }
		}
		this.transition("idle")
		this.emit("captureStopped", { code: reason })
		return result
	}

	/** Stop, discard the audio, and leave nothing behind. */
	async cancelCapture(): Promise<void> {
		if (this.state === "closed") return
		this.unsubscribeFrames?.()
		this.unsubscribeFrames = undefined
		this.buffer.clear()
		// Cancel means "do not transcribe this": drop any sealed utterance too.
		this.retained = undefined
		const wasActive = this.state === "capturing" || this.state === "starting" || this.state === "stopping"
		if (wasActive) {
			this.state = "stopping"
		}
		await this.coordinator.cancel().catch(() => undefined)
		if (this.state === "stopping") {
			this.state = "idle"
		}
		this.emit("captureStatus")
	}

	/**
	 * Drains the utterance WITHOUT stopping an active capture and without
	 * reaching the webview. This is the F2 hand-off boundary: the composer's
	 * "Metne Çevir" click calls this when the capture already ended by itself
	 * (silence seal or the duration cap), so the sealed audio is still available.
	 *
	 * Returns an empty array when there is neither a live buffer nor a retained
	 * utterance. A successful drain releases the retained copy.
	 */
	drain(): Int16Array {
		if (this.retained) {
			const samples = this.retained.samples
			this.retained = undefined
			return samples
		}
		return this.buffer.toInt16Array()
	}

	/** True when a stopped utterance is still waiting to be transcribed. */
	get hasPendingUtterance(): boolean {
		return this.retained !== undefined
	}

	/** Why the retained utterance was sealed (`silence` / `maxDuration`). */
	get pendingUtteranceReason(): StopCaptureResult["reason"] | undefined {
		return this.retained?.reason
	}

	// ── F2: recognition ──────────────────────────────────────────────────────

	/** True when a recognition engine was supplied and has not been disposed. */
	get canTranscribe(): boolean {
		return this.recognitionEngineOption !== undefined
	}

	/** True while a transcription is in flight. */
	get isTranscribing(): boolean {
		return this.transcribeAbort !== undefined
	}

	/**
	 * Transcribes a completed utterance held in host memory.
	 *
	 * This is the F1 → F2 seam: the samples come straight out of `stopCapture()`
	 * or `drain()` and go into the engine's stdin as a WAV, with no file and no
	 * ProtoBus hop. The runtime keeps **no copy** — audio is released as soon as
	 * the engine has it, so cancelling after this point cannot leak it.
	 *
	 * `audio.samples` is not optional and not a path: there is deliberately no
	 * overload that accepts a file, so no caller can introduce an on-disk audio
	 * path through this API.
	 */
	async transcribeUtterance(options: {
		samples: Int16Array
		/** Defaults to "auto". */
		language?: VoiceLanguage
		modelId?: ModelId
		signal?: AbortSignal
		timeoutMs?: number
	}): Promise<TranscribeResult> {
		const engine = this.recognitionEngineOption
		if (!engine) {
			throw new VoiceError("TRANSCRIBE_NOT_SUPPORTED", "No speech recognition engine is configured.")
		}
		if (this.disposeStarted) {
			throw new VoiceError("TRANSCRIBE_RUNTIME_DISPOSED")
		}
		if (this.transcribeAbort) {
			throw new VoiceError("TRANSCRIBE_ALREADY_ACTIVE")
		}
		if (!(options.samples instanceof Int16Array) || options.samples.length === 0) {
			throw new VoiceError("TRANSCRIBE_NO_AUDIO", "There was no audio to transcribe.")
		}
		const modelId = options.modelId ?? this.defaultModelIdOption
		if (!modelId) {
			throw new VoiceError("MODEL_NOT_INSTALLED", "No speech recognition model is selected.")
		}

		const abort = new AbortController()
		this.transcribeAbort = abort
		const onExternalAbort = () => abort.abort()
		options.signal?.addEventListener("abort", onExternalAbort, { once: true })
		try {
			return await engine.transcribe({
				samples: options.samples,
				language: options.language ?? "auto",
				modelId,
				signal: abort.signal,
				timeoutMs: options.timeoutMs ?? this.transcribeTimeoutMs,
			})
		} catch (error) {
			const code = error instanceof VoiceError ? error.code : "VOICE_INTERNAL_ERROR"
			this.lastErrorCode = code
			this.lastErrorMessage = error instanceof Error ? error.message : String(error)
			throw error instanceof VoiceError ? error : new VoiceError("VOICE_INTERNAL_ERROR", this.lastErrorMessage)
		} finally {
			options.signal?.removeEventListener("abort", onExternalAbort)
			if (this.transcribeAbort === abort) this.transcribeAbort = undefined
		}
	}

	/**
	 * Transcribes whatever the buffer currently holds, without stopping capture.
	 * The audio is copied out and the buffer is left untouched so capture keeps
	 * working; the copy is released when the call returns.
	 */
	async transcribeBuffered(
		options: { language?: VoiceLanguage; modelId?: ModelId; signal?: AbortSignal } = {},
	): Promise<TranscribeResult> {
		return this.transcribeUtterance({ ...options, samples: this.buffer.toInt16Array() })
	}

	/** Cancels an in-flight transcription. Safe to call when idle. */
	cancelTranscription(): void {
		this.transcribeAbort?.abort()
	}

	private resetSessionState(): void {
		this.frames = 0
		this.bytes = 0
		this.dropped = 0
		this.lastErrorCode = undefined
		this.lastErrorMessage = undefined
		this.buffer.clear()
		this.noiseFloorRms = undefined
		this.silence = new SilenceDetector({ timeoutMs: this.silenceTimeoutMs })
	}

	/**
	 * Tears everything down: frames, buffer, helper process, recognition engine.
	 * Idempotent, so a second `dispose()` during teardown is a no-op.
	 */
	async dispose(): Promise<void> {
		if (this.disposeStarted) return
		this.disposeStarted = true
		this.transcribeAbort?.abort()
		this.transcribeAbort = undefined
		this.unsubscribeFrames?.()
		this.unsubscribeFrames = undefined
		this.buffer.clear()
		this.retained = undefined
		this.silence.reset()
		await this.coordinator.dispose().catch(() => undefined)
		// The engine is owned from construction, so it is disposed here — this is
		// what guarantees no whisper child process outlives the extension host.
		if (this.recognitionEngineOption) {
			await this.recognitionEngineOption.dispose().catch(() => undefined)
		}
		if (this.state !== "closed") {
			this.state = "closed"
		}
		this.listeners.clear()
	}
}
