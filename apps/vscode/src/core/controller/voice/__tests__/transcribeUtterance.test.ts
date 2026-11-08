import { transcribeUtterance } from "@core/controller/voice/transcribeUtterance"
import { VoiceError } from "@core/voice"
import { TranscribeUtteranceRequest } from "@shared/proto/bytos/voice"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F4 — `transcribeUtterance` contract.
 *
 * What these cases pin down, in the order the handler enforces them:
 *  1. readiness is checked BEFORE the capture is stopped;
 *  2. the audio stays in the host (the response is text only);
 *  3. empty and silent utterances produce no text;
 *  4. duplicate work is impossible (the runtime refuses a second recognition);
 *  5. a session mismatch cannot transcribe someone else's audio.
 */

const { runtimeHolder, engineHolder, modelReadyHolder, publishMock } = vi.hoisted(() => ({
	runtimeHolder: { runtime: undefined as unknown },
	engineHolder: { view: { state: "ready", errorCode: "" } as { state: string; errorCode: string } },
	modelReadyHolder: { ready: true },
	publishMock: vi.fn(async () => {}),
}))

vi.mock("@core/controller/voice/shared", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@core/controller/voice/shared")>()
	return {
		...actual,
		runtimeFor: async () => {
			if (!runtimeHolder.runtime) throw new Error("runtime not primed for this test")
			return runtimeHolder.runtime
		},
		extensionRoot: () => "C:/ext",
	}
})

vi.mock("@core/controller/voice/VoiceModelService", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@core/controller/voice/VoiceModelService")>()
	return {
		...actual,
		resolveVoiceEngine: async () => engineHolder.view,
		getVoiceModelService: () => ({ isModelReady: () => modelReadyHolder.ready, list: () => [] }),
	}
})

vi.mock("@core/controller/voice/subscribeToVoiceEvents", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@core/controller/voice/subscribeToVoiceEvents")>()
	return { ...actual, publishVoiceEvent: publishMock }
})

function fakeController(settings: Record<string, unknown> = {}) {
	return {
		stateManager: { getGlobalSettingsKey: (key: string) => settings[key] },
		postStateToWebview: async () => {},
	} as never
}

interface RuntimeOptions {
	state?: "idle" | "capturing" | "starting" | "stopping"
	samples?: Int16Array
	text?: string
	canTranscribe?: boolean
	transcribeThrows?: Error
}

function fakeRuntime(options: RuntimeOptions = {}) {
	const samples = options.samples ?? Int16Array.from({ length: 16000 }, (_, i) => (i % 100) * 200)
	const calls = { stop: 0, drain: 0, transcribe: 0 }
	return {
		calls,
		capability: { canCapture: true, backend: "wasapi", reason: "", detail: "", osLabel: "Windows x64 (local)" },
		captureState: options.state ?? "capturing",
		canTranscribe: options.canTranscribe ?? true,
		stopCapture: async () => {
			calls.stop += 1
			return {
				sessionId: "voice-1",
				durationMs: (samples.length / 16000) * 1000,
				samples,
				counters: { frames: 10, bytes: samples.length * 2, droppedFrames: 0 },
				truncated: false,
				reason: "stopped",
			}
		},
		drain: () => {
			calls.drain += 1
			return samples
		},
		transcribeUtterance: async (_options?: { language?: string; modelId?: string }) => {
			calls.transcribe += 1
			if (options.transcribeThrows) throw options.transcribeThrows
			return {
				text: options.text ?? "merhaba dünya",
				language: "tr",
				durationMs: 900,
				engine: "whisper-cli",
				modelId: "base",
				warnings: [] as string[],
				audioDurationMs: (samples.length / 16000) * 1000,
			}
		},
	}
}

beforeEach(() => {
	runtimeHolder.runtime = fakeRuntime()
	engineHolder.view = { state: "ready", errorCode: "" }
	modelReadyHolder.ready = true
	publishMock.mockClear()
})

describe("transcribeUtterance — happy path", () => {
	it("stops the capture, recognises it and returns TEXT with counters only", async () => {
		const runtime = fakeRuntime()
		runtimeHolder.runtime = runtime
		const response = await transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))
		expect(runtime.calls.stop).toBe(1)
		expect(response.text).toBe("merhaba dünya")
		expect(response.language).toBe("tr")
		expect(response.modelId).toBe("base")
		expect(response.emptyAudio).toBe(false)
		// The response cannot carry a waveform: no bytes, samples or paths anywhere.
		expect(JSON.stringify(response)).not.toMatch(/pcm|wav|samples|bytes|path/i)
	})

	it("prefers the request's language and model over the persisted settings", async () => {
		const seen: Array<{ language?: string; modelId?: string }> = []
		const runtime = fakeRuntime()
		const transcribe = runtime.transcribeUtterance
		runtime.transcribeUtterance = async (options?: { language?: string; modelId?: string }) => {
			seen.push({ language: options?.language, modelId: options?.modelId })
			return await transcribe()
		}
		runtimeHolder.runtime = runtime
		const explicit = await transcribeUtterance(
			fakeController({ voiceLanguage: "de", voiceModelId: "tiny" }),
			TranscribeUtteranceRequest.create({ language: "en", modelId: "base" }),
		)
		// The request wins over what is persisted.
		expect(seen).toEqual([{ language: "en", modelId: "base" }])
		// The response reports what the engine actually used.
		expect(explicit.language).toBe("tr")
		expect(explicit.modelId).toBe("base")
	})

	it("falls back to the persisted settings, then to defaults, for unknown values", async () => {
		// Unknown request values are ignored; the persisted settings are used.
		const stored = await transcribeUtterance(
			fakeController({ voiceLanguage: "de", voiceModelId: "tiny" }),
			TranscribeUtteranceRequest.create({ language: "kl", modelId: "large" }),
		)
		expect(stored).toBeDefined()
		// Nothing persisted and nothing requested: detection and the default model.
		const defaults = await transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({ language: "xx" }))
		expect(defaults.text).toBe("merhaba dünya")
	})

	it("transcribes the last stopped utterance when nothing is capturing", async () => {
		const runtime = fakeRuntime({ state: "idle" })
		runtimeHolder.runtime = runtime
		await transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))
		expect(runtime.calls.stop).toBe(0)
		expect(runtime.calls.drain).toBe(1)
		expect(runtime.calls.transcribe).toBe(1)
	})
})

describe("transcribeUtterance — readiness gate", () => {
	it("refuses when capture is unavailable and never touches the runtime", async () => {
		const runtime = fakeRuntime()
		runtime.capability = { ...runtime.capability, canCapture: false, backend: "none", reason: "VOICE_DISABLED" }
		runtimeHolder.runtime = runtime
		await expect(transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))).rejects.toMatchObject({
			code: "VOICE_DISABLED",
		})
		expect(runtime.calls.stop).toBe(0)
		expect(runtime.calls.transcribe).toBe(0)
	})

	it("refuses BEFORE stopping the capture when the engine is missing", async () => {
		const runtime = fakeRuntime()
		runtimeHolder.runtime = runtime
		engineHolder.view = { state: "missing", errorCode: "WHISPER_BINARY_MISSING" }
		await expect(transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))).rejects.toMatchObject({
			code: "WHISPER_BINARY_MISSING",
		})
		// The utterance is still there for a retry once the engine is installed.
		expect(runtime.calls.stop).toBe(0)
		expect(runtime.calls.transcribe).toBe(0)
	})

	it("refuses BEFORE stopping the capture when the model is not ready", async () => {
		const runtime = fakeRuntime()
		runtimeHolder.runtime = runtime
		modelReadyHolder.ready = false
		await expect(transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))).rejects.toMatchObject({
			code: "MODEL_NOT_INSTALLED",
		})
		expect(runtime.calls.stop).toBe(0)
	})
})

describe("transcribeUtterance — empty and silent captures", () => {
	it("reports empty audio instead of inventing text", async () => {
		const runtime = fakeRuntime({ samples: new Int16Array(0) })
		runtimeHolder.runtime = runtime
		const response = await transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))
		expect(response.text).toBe("")
		expect(response.emptyAudio).toBe(true)
		expect(runtime.calls.transcribe).toBe(0)
	})

	it("passes the engine's empty transcript through untouched", async () => {
		runtimeHolder.runtime = fakeRuntime({ text: "" })
		const response = await transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))
		expect(response.text).toBe("")
		// Real audio ran, so this is "no speech", not "no audio".
		expect(response.emptyAudio).toBe(false)
	})
})

describe("transcribeUtterance — errors and duplicate work", () => {
	it("propagates the runtime's typed refusal for a second concurrent run", async () => {
		runtimeHolder.runtime = fakeRuntime({ transcribeThrows: new VoiceError("TRANSCRIBE_ALREADY_ACTIVE") })
		await expect(transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))).rejects.toMatchObject({
			code: "TRANSCRIBE_ALREADY_ACTIVE",
		})
	})

	it("publishes an error event and rethrows when recognition fails", async () => {
		runtimeHolder.runtime = fakeRuntime({ transcribeThrows: new VoiceError("MODEL_INTEGRITY_FAILED") })
		await expect(transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({}))).rejects.toMatchObject({
			code: "MODEL_INTEGRITY_FAILED",
		})
		expect(publishMock).toHaveBeenCalled()
	})

	it("refuses a session mismatch instead of transcribing someone else's audio", async () => {
		await expect(
			transcribeUtterance(fakeController(), TranscribeUtteranceRequest.create({ sessionId: "voice-99" })),
		).rejects.toMatchObject({ code: "CAPTURE_SESSION_MISMATCH" })
	})
})
