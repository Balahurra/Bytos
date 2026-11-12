import { VoiceError } from "@core/voice"
import { isSupportedLanguage } from "@core/voice/transcription/language"
import { DEFAULT_MODEL_ID, isKnownModelId } from "@core/voice/transcription/models/modelCatalog"
import type { ModelId, VoiceLanguage } from "@core/voice/transcription/types"
import { VOICE_SAMPLE_RATE } from "@core/voice/types"
import { TranscribeUtteranceRequest, TranscribeUtteranceResponse, VoiceEvent } from "@shared/proto/bytos/voice"
import type { Controller } from ".."
import { extensionRoot, runtimeFor, toVoiceErrorCode, toVoiceErrorText } from "./shared"
import { publishVoiceEvent } from "./subscribeToVoiceEvents"
import { getVoiceModelService, resolveVoiceEngine } from "./VoiceModelService"

/**
 * `transcribeUtterance` — F4: turns the captured utterance into composer text.
 *
 * The one bridge between the two halves of Voice:
 *
 *   stopped capture ─► runtime.stopCapture() ─► Int16Array (host memory)
 *                                             ─► whisper engine
 *                                             ─► TEXT in this response
 *
 * Rules enforced here, in order:
 *  1. **Readiness first.** Capture capability, the engine and the selected model
 *     are checked before anything is stopped or spawned, so an unready host gets
 *     a typed error instead of a half-run capture.
 *  2. **The audio never leaves the host.** Samples are read from the runtime
 *     buffer, handed to the engine, and dropped when this call returns. Nothing
 *     is written to disk, nothing is logged, and the response carries text only.
 *  3. **No speech ⇒ no text.** An empty buffer is reported as `emptyAudio`, and
 *     the F2 engine's own silence guards turn silent audio into `text: ""`.
 *     Neither case can put text in the composer.
 *  4. **No send path.** This handler cannot reach the agent runtime, the task
 *     service or the chat state: it returns a string for the draft and stops.
 *  5. **One transcription at a time.** A second run while one is in flight is
 *     refused by the runtime (`TRANSCRIBE_ALREADY_ACTIVE`).
 */
export async function transcribeUtterance(
	controller: Controller,
	request: TranscribeUtteranceRequest,
): Promise<TranscribeUtteranceResponse> {
	const runtime = await runtimeFor(controller)

	const capability = runtime.capability
	if (!capability.canCapture) {
		throw new VoiceError((capability.reason || "VOICE_DISABLED") as never, capability.detail)
	}

	const language = resolveLanguage(controller, request.language)
	const modelId = resolveModelId(controller, request.modelId)

	// Readiness of the recognition half, checked BEFORE the capture is stopped so
	// the utterance is still available once the user installs what is missing.
	const engine = await resolveVoiceEngine({ extensionRoot: extensionRoot() })
	if (engine.state !== "ready") {
		throw new VoiceError((engine.errorCode || "WHISPER_BINARY_MISSING") as never)
	}
	const modelService = getVoiceModelService()
	if (!modelService.isModelReady(modelId)) {
		// A model installed in an earlier session (including a custom one) has not
		// been hashed in this process yet. Verify it now rather than refusing a
		// dictation the Settings panel can already see on disk. An absent model
		// still fails here, before the capture is stopped.
		const view = await modelService.verify(modelId)
		if (view.state !== "ready") {
			throw new VoiceError("MODEL_NOT_INSTALLED")
		}
	}
	if (!runtime.canTranscribe) {
		throw new VoiceError("WHISPER_BINARY_MISSING", "The recognition engine is not available in this host.")
	}

	return await runRecognition(runtime, request, { language, modelId })
}

type VoiceRuntimeHandle = Awaited<ReturnType<typeof runtimeFor>>

/**
 * Stops the capture (or drains the last stopped one) and runs the recogniser.
 * Split out so the readiness gate above stays readable.
 */
async function runRecognition(
	runtime: VoiceRuntimeHandle,
	request: TranscribeUtteranceRequest,
	options: { language: VoiceLanguage; modelId: ModelId },
): Promise<TranscribeUtteranceResponse> {
	const { language, modelId } = options
	await publishVoiceEvent(
		VoiceEvent.create({
			kind: "captureStatus",
			captureState: runtime.captureState,
			code: "transcribing",
		}),
	)

	let audioDurationMs = 0
	let samples: Int16Array | undefined
	const state = runtime.captureState
	if (state === "capturing" || state === "starting") {
		const stopped = await runtime.stopCapture({ reason: "stopped" })
		if (request.sessionId && stopped.sessionId && request.sessionId !== stopped.sessionId) {
			// The stop already happened; report the mismatch rather than
			// transcribing a session the caller did not ask for.
			throw new VoiceError("CAPTURE_SESSION_MISMATCH")
		}
		samples = stopped.samples
		audioDurationMs = Math.round(stopped.durationMs)
	} else {
		// Nothing was running: transcribe whatever the last stopped utterance
		// left in the runtime buffer.
		samples = runtime.drain()
		audioDurationMs = Math.round((samples.length / VOICE_SAMPLE_RATE) * 1000)
	}

	if (!samples || samples.length === 0) {
		return TranscribeUtteranceResponse.create({
			text: "",
			emptyAudio: true,
			language,
			modelId,
			audioDurationMs: 0,
			warnings: [],
		})
	}

	const startedAt = Date.now()
	let result: Awaited<ReturnType<VoiceRuntimeHandle["transcribeUtterance"]>>
	try {
		result = await runtime.transcribeUtterance({ samples, language, modelId })
	} catch (error) {
		await publishVoiceEvent(
			VoiceEvent.create({
				kind: "error",
				captureState: runtime.captureState,
				code: toVoiceErrorCode(error),
				message: toVoiceErrorText(error),
			}),
		)
		throw error
	} finally {
		// Drop the host copy as soon as the engine is done with it.
		samples = undefined
	}

	await publishVoiceEvent(
		VoiceEvent.create({
			kind: "captureStatus",
			captureState: runtime.captureState,
			durationMs: Math.round(result.durationMs),
			code: result.text ? "transcribed" : "no-speech",
		}),
	)

	return TranscribeUtteranceResponse.create({
		text: result.text,
		emptyAudio: false,
		language: result.language,
		modelId: result.modelId,
		audioDurationMs: Math.round(audioDurationMs || result.audioDurationMs),
		durationMs: Math.round(result.durationMs || Date.now() - startedAt),
		warnings: result.warnings,
	})
}

/** Language: the request wins, then the persisted setting, then detection. */
function resolveLanguage(controller: Controller, requested: string): VoiceLanguage {
	if (isSupportedLanguage(requested)) return requested
	const stored = controller.stateManager.getGlobalSettingsKey("voiceLanguage")
	return isSupportedLanguage(stored) ? (stored as VoiceLanguage) : "auto"
}

/** Model: the request wins, then the persisted setting, then the default. */
function resolveModelId(controller: Controller, requested: string): ModelId {
	if (isKnownModelId(requested)) return requested
	const stored = controller.stateManager.getGlobalSettingsKey("voiceModelId")
	return isKnownModelId(stored) ? stored : DEFAULT_MODEL_ID
}
