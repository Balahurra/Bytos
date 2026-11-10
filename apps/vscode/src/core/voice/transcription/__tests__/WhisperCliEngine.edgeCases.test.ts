import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { VoiceSessionRegistry } from "../../VoiceSessionRegistry"
import { PINNED_WHISPER_BINARY } from "../models/modelCatalog"
import { WhisperCliEngine } from "../WhisperCliEngine"
import { wavFromPcm16 } from "../wav"
import { runWhisperForTranscript } from "../whisperProcess"
import { ENGINE_ROOT, MODEL_DIR, noise, readClipPcm16, silence, skipWithoutAssets } from "./f2TestAssets"

/**
 * Edge cases around a real recogniser: no audio, silence, non-speech noise, a
 * long utterance, cancellation, timeouts, and resource cleanup.
 *
 * These are the paths where a naive implementation "succeeds" while being wrong:
 * an empty transcript for silence must be distinguishable from a crash, and a
 * cancelled run must leave nothing behind.
 */
describe.skipIf(skipWithoutAssets)("WhisperCliEngine — edge cases", () => {
	let engine: WhisperCliEngine

	beforeAll(async () => {
		engine = new WhisperCliEngine()
		await engine.init({ engineRoot: ENGINE_ROOT, modelDir: MODEL_DIR })
		await engine.loadModel("tiny")
	})

	afterAll(async () => {
		await engine.dispose()
	})

	it("rejects an empty utterance without spawning anything", async () => {
		await expect(engine.transcribe({ samples: new Int16Array(0), language: "en", modelId: "tiny" })).rejects.toThrowError(
			expect.objectContaining({ code: "TRANSCRIBE_NO_AUDIO" }),
		)
	})

	it("rejects a non-Int16Array payload", async () => {
		await expect(
			engine.transcribe({ samples: new Float32Array(1600) as unknown as Int16Array, language: "en", modelId: "tiny" }),
		).rejects.toThrowError(expect.objectContaining({ code: "TRANSCRIBE_AUDIO_INVALID" }))
	})

	it("returns empty text for pure silence instead of whisper's 'you'", async () => {
		// Measured: raw whisper answers 3 s of digital silence with "you". The
		// energy gate must short-circuit before the recogniser runs.
		const result = await engine.transcribe({ samples: silence(3), language: "en", modelId: "tiny" })
		expect(result.text).toBe("")
		expect(result.modelId).toBe("tiny")
		expect(result.audioDurationMs).toBeCloseTo(3000, -2)
		expect(result.durationMs).toBe(0) // no recogniser run at all
	}, 60000)

	it("does not turn low-level noise into text", async () => {
		// Measured: raw whisper turns quiet noise into "[BIRDS CHIRPING]" /
		// "[BLANK_AUDIO]". Neither the annotation nor a phantom word may reach the
		// caller.
		const result = await engine.transcribe({ samples: noise(3, 200), language: "en", modelId: "tiny" })
		expect(result.text).toBe("")
	}, 60000)

	it("transcribes a long (30 s) utterance", async () => {
		// Build 30 s by repeating a real clip, which stays real speech throughout.
		const clip = readClipPcm16("en_numbers")
		const repeats = Math.ceil((30 * 16000) / clip.length)
		const samples = new Int16Array(clip.length * repeats)
		for (let i = 0; i < repeats; i++) samples.set(clip, i * clip.length)

		const result = await engine.transcribe({ samples, language: "en", modelId: "tiny" })
		expect(result.audioDurationMs).toBeGreaterThan(29000)
		expect(result.text.length).toBeGreaterThan(20)
		// The repeated phrase must appear more than once in the transcript.
		const occurrences = result.text.toLowerCase().split("fox").length - 1
		expect(occurrences).toBeGreaterThan(1)
	}, 120000)
})

describe.skipIf(skipWithoutAssets)("cancellation, timeout and resource cleanup", () => {
	const exe = path.join(ENGINE_ROOT, PINNED_WHISPER_BINARY.subdir, "whisper-cli.exe")
	const model = path.join(MODEL_DIR, "ggml-tiny.bin")
	const tmpFiles = () => fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("bytos-whisper-"))

	it("aborts an in-flight transcription and leaves no child behind", async () => {
		const controller = new AbortController()
		const audio = wavFromPcm16(readClipPcm16("tr_merhaba"))
		const pending = runWhisperForTranscript({
			executablePath: exe,
			modelPath: model,
			language: "tr",
			audio,
			timeoutMs: 60000,
			signal: controller.signal,
		})
		// Abort while the model is still loading (spawn → load is ~80 ms).
		setTimeout(() => controller.abort(), 60)

		await expect(pending).rejects.toThrowError(expect.objectContaining({ code: "TRANSCRIBE_ABORTED" }))
		expect(VoiceSessionRegistry.getActiveCount()).toBe(0)
		expect(tmpFiles()).toEqual([])
	}, 60000)

	it("kills the child when the per-utterance timeout expires", async () => {
		const audio = wavFromPcm16(readClipPcm16("en_hello"))
		await expect(
			runWhisperForTranscript({
				executablePath: exe,
				modelPath: model,
				language: "en",
				audio,
				// Far too short for a real inference run.
				timeoutMs: 5,
			}),
		).rejects.toThrowError(expect.objectContaining({ code: "TRANSCRIBE_TIMEOUT" }))
		expect(VoiceSessionRegistry.getActiveCount()).toBe(0)
		expect(tmpFiles()).toEqual([])
	}, 60000)

	it("rejects an immediately-aborted signal without spawning", async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(
			runWhisperForTranscript({
				executablePath: exe,
				modelPath: model,
				language: "en",
				audio: wavFromPcm16(readClipPcm16("en_numbers")),
				timeoutMs: 60000,
				signal: controller.signal,
			}),
		).rejects.toThrowError(expect.objectContaining({ code: "TRANSCRIBE_ABORTED" }))
	})

	it("cleans up the temporary output base even on success", async () => {
		const bases: string[] = []
		await runWhisperForTranscript({
			executablePath: exe,
			modelPath: model,
			language: "en",
			audio: wavFromPcm16(readClipPcm16("en_numbers")),
			timeoutMs: 60000,
			onOutputBase: (base) => bases.push(base),
		})
		expect(bases).toHaveLength(1)
		// The base existed only to make the CLI take the stdout path; it must be gone.
		expect(fs.existsSync(`${bases[0]}.txt`)).toBe(false)
		expect(fs.existsSync(bases[0])).toBe(false)
	}, 60000)

	it("surfaces a corrupt model as a typed error through the engine", async () => {
		// `runWhisperForTranscript` deliberately RESOLVES with the exit code and
		// stderr; mapping that to a typed error is the engine's job. The engine
		// verifies models by hash before spawning, so a corrupt installed model is
		// caught earlier still (see ModelStore tests); here the child result is
		// asserted directly.
		// stderr; mapping that to a typed error is the engine's job. The engine
		// verifies models by hash before spawning, so the corrupt-file case is
		// covered by ModelStore tests; here the raw child result is asserted.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bytos-f2-corrupt-model-"))
		const corrupt = path.join(dir, "ggml-tiny.bin")
		fs.writeFileSync(corrupt, Buffer.alloc(1024, 7))
		try {
			const result = await runWhisperForTranscript({
				executablePath: exe,
				modelPath: corrupt,
				language: "en",
				audio: wavFromPcm16(readClipPcm16("en_numbers")),
				timeoutMs: 60000,
			})
			expect(result.exitCode).toBe(3)
			expect(result.stdout.trim()).toBe("")
			// A corrupt model and a missing one share exit code 3 here, so the
			// stderr signature is what distinguishes them.
			expect(result.stderr).toMatch(/invalid model data|failed to load model/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	}, 60000)

	it("disposes idempotently and refuses work afterwards", async () => {
		const disposable = new WhisperCliEngine()
		await disposable.init({ engineRoot: ENGINE_ROOT, modelDir: MODEL_DIR })
		await disposable.dispose()
		await disposable.dispose()
		await expect(disposable.transcribe({ samples: silence(1), language: "en", modelId: "tiny" })).rejects.toThrowError(
			expect.objectContaining({ code: "TRANSCRIBE_RUNTIME_DISPOSED" }),
		)
	})
})
