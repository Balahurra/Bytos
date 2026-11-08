import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { AudioCaptureCoordinator } from "../../capture/AudioCaptureCoordinator"
import type { AudioCaptureProvider } from "../../capture/AudioCaptureProvider"
import { VoiceError } from "../../types"
import { VoiceRuntime } from "../../VoiceRuntime"
import type { RecognitionEngine } from "../types"
import { WhisperCliEngine } from "../WhisperCliEngine"
import { ENGINE_ROOT, MODEL_DIR, readClipPcm16, silence, skipWithoutAssets } from "./f2TestAssets"

/**
 * The F1 → F2 seam: `VoiceRuntime` hands a completed utterance's `Int16Array`
 * straight to the recognition engine, with no file and no ProtoBus hop.
 */
const capability = {
	canCapture: true,
	backend: "wasapi" as const,
	reason: "" as const,
	detail: "",
	osLabel: "Windows x64 (local)",
	platform: "win32",
	arch: "x64",
	remoteName: undefined,
	helperPath: "C:\\fake\\helper.exe",
	deviceCount: 1,
	permission: "granted" as const,
}

/** Minimal coordinator stub: these tests never capture. */
function noCoordinator(): AudioCaptureCoordinator {
	return new AudioCaptureCoordinator({ providers: [] as AudioCaptureProvider[] })
}

/** Engine double: only the interface, no whisper, no files. */
function stubEngine(overrides: Partial<RecognitionEngine> = {}): RecognitionEngine {
	return {
		id: "whisper-cli",
		async init() {
			return { ready: true, supportedPlatform: true }
		},
		async loadModel(modelId) {
			return { modelId, state: "ready", totalBytes: 1 }
		},
		async transcribe(request) {
			return {
				text: "ok",
				language: request.language,
				durationMs: 1,
				engine: "whisper-cli",
				modelId: request.modelId,
				warnings: [],
				audioDurationMs: 1,
			}
		},
		async dispose() {},
		...overrides,
	}
}

describe("VoiceRuntime — recognition seam", () => {
	it("reports canTranscribe=false when no engine was supplied", async () => {
		const runtime = new VoiceRuntime(capability, noCoordinator())
		expect(runtime.canTranscribe).toBe(false)
		await expect(runtime.transcribeUtterance({ samples: silence(1) })).rejects.toThrowError(
			expect.objectContaining({ code: "TRANSCRIBE_NOT_SUPPORTED" }),
		)
		await runtime.dispose()
	})

	it("annotates the error with a typed code and keeps going", async () => {
		const runtime = new VoiceRuntime(capability, noCoordinator(), {
			defaultModelId: "base",
			recognitionEngine: stubEngine({
				async transcribe() {
					throw new VoiceError("MODEL_NOT_INSTALLED", "no model")
				},
			}),
		})
		await expect(runtime.transcribeUtterance({ samples: Int16Array.from([1, 2, 3]) })).rejects.toThrowError(
			expect.objectContaining({ code: "MODEL_NOT_INSTALLED" }),
		)
		expect(runtime.snapshot().lastErrorCode).toBe("MODEL_NOT_INSTALLED")
		// The runtime must remain usable and must not stay "transcribing".
		expect(runtime.isTranscribing).toBe(false)
		await runtime.dispose()
	})

	it("forwards samples, language and model untouched", async () => {
		const seen: Array<{ length: number; language: string; modelId: string }> = []
		const runtime = new VoiceRuntime(capability, noCoordinator(), {
			defaultModelId: "tiny",
			recognitionEngine: stubEngine({
				async transcribe(request) {
					seen.push({ length: request.samples.length, language: request.language, modelId: request.modelId })
					return {
						text: "ok",
						language: request.language,
						durationMs: 1,
						engine: "whisper-cli",
						modelId: request.modelId,
						warnings: [],
						audioDurationMs: 1,
					}
				},
			}),
		})
		await runtime.transcribeUtterance({ samples: Int16Array.from([5, 6, 7, 8]), language: "de" })
		expect(seen).toEqual([{ length: 4, language: "de", modelId: "tiny" }])
		await runtime.dispose()
	})

	it("rejects empty audio before reaching the engine", async () => {
		const runtime = new VoiceRuntime(capability, noCoordinator(), {
			defaultModelId: "base",
			recognitionEngine: stubEngine({
				async transcribe() {
					throw new Error("the engine must not be called")
				},
			}),
		})
		await expect(runtime.transcribeUtterance({ samples: new Int16Array(0) })).rejects.toThrowError(
			expect.objectContaining({ code: "TRANSCRIBE_NO_AUDIO" }),
		)
		await runtime.dispose()
	})

	it("disposes the engine exactly once and refuses work afterwards", async () => {
		let disposals = 0
		const runtime = new VoiceRuntime(capability, noCoordinator(), {
			defaultModelId: "base",
			recognitionEngine: stubEngine({
				async dispose() {
					disposals += 1
				},
			}),
		})
		await runtime.dispose()
		await runtime.dispose()
		expect(disposals).toBe(1)
		await expect(runtime.transcribeUtterance({ samples: Int16Array.from([1]) })).rejects.toThrowError(
			expect.objectContaining({ code: "TRANSCRIBE_RUNTIME_DISPOSED" }),
		)
	})

	it("refuses a second concurrent transcription", async () => {
		let release: (() => void) | undefined
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const runtime = new VoiceRuntime(capability, noCoordinator(), {
			defaultModelId: "base",
			recognitionEngine: stubEngine({
				async transcribe(request) {
					await gate
					return {
						text: "",
						language: request.language,
						durationMs: 1,
						engine: "whisper-cli",
						modelId: request.modelId,
						warnings: [],
						audioDurationMs: 1,
					}
				},
			}),
		})
		const first = runtime.transcribeUtterance({ samples: Int16Array.from([1, 2]) })
		await expect(runtime.transcribeUtterance({ samples: Int16Array.from([3, 4]) })).rejects.toThrowError(
			expect.objectContaining({ code: "TRANSCRIBE_ALREADY_ACTIVE" }),
		)
		expect(runtime.isTranscribing).toBe(true)
		release?.()
		await first
		expect(runtime.isTranscribing).toBe(false)
		await runtime.dispose()
	})
})

describe.skipIf(skipWithoutAssets)("VoiceRuntime — real engine over a real clip", () => {
	let engine: WhisperCliEngine

	beforeAll(async () => {
		engine = new WhisperCliEngine()
		await engine.init({ engineRoot: ENGINE_ROOT, modelDir: MODEL_DIR })
	})

	afterAll(async () => {
		// The runtime owns the engine and disposes it; nothing to do here.
	})

	it("transcribes a completed utterance through the runtime seam", async () => {
		const runtime = new VoiceRuntime(capability, noCoordinator(), {
			recognitionEngine: engine,
			defaultModelId: "tiny",
		})
		// Exactly the hand-off F1 makes: the samples of a finished utterance.
		const samples = readClipPcm16("en_numbers")
		const result = await runtime.transcribeUtterance({ samples, language: "en" })
		expect(result.text.toLowerCase()).toContain("fox")
		expect(result.modelId).toBe("tiny")
		await runtime.dispose()
	}, 120000)
})
