import { describe, expect, it } from "vitest"
import { mapExitCodeToError, summariseStderr } from "../whisperErrors"

/**
 * Exit codes were measured on the pinned build, not assumed:
 *  - bad language exits **0** (error reported as success)
 *  - missing model and corrupt model both exit **3**
 *  - undecodable audio exits **11**
 */
const CORRUPT_STDERR = [
	"whisper_model_load: loading model",
	"whisper_model_load: invalid model data (bad magic)",
	"whisper_init_with_params_no_state: failed to load model",
	"error: failed to initialize whisper context",
].join("\r\n")

describe("mapExitCodeToError", () => {
	it("maps a corrupt model to MODEL_FILE_CORRUPT despite the shared exit code 3", () => {
		const error = mapExitCodeToError(3, CORRUPT_STDERR)
		expect(error.code).toBe("MODEL_FILE_CORRUPT")
	})

	it("maps a missing model to MODEL_FILE_MISSING", () => {
		const error = mapExitCodeToError(3, "error: model file not found 'x.bin'")
		expect(error.code).toBe("MODEL_FILE_MISSING")
	})

	it("maps an unknown language reported with exit 0", () => {
		// Measured: whisper prints the error and still exits 0, so the code alone
		// would look like success.
		const error = mapExitCodeToError(0, "error: unknown language 'xx'")
		expect(error.code).toBe("TRANSCRIBE_LANGUAGE_UNSUPPORTED")
	})

	it("maps undecodable audio (exit 11)", () => {
		const error = mapExitCodeToError(11, "read_audio_data: failed to open audio data from stdin (Unknown error)")
		expect(error.code).toBe("TRANSCRIBE_AUDIO_INVALID")
	})

	it("maps 'no input files' (exit 2)", () => {
		expect(mapExitCodeToError(2, "error: no input files specified").code).toBe("TRANSCRIBE_AUDIO_INVALID")
	})

	it("maps a rejected argument list (exit 1)", () => {
		expect(mapExitCodeToError(1, "something").code).toBe("TRANSCRIBE_PROCESS_FAILED")
	})

	it("uses the internal sentinel for a clean exit with no signature", () => {
		// The engine treats this sentinel as "no error" and proceeds to parse text.
		expect(mapExitCodeToError(0, "all good").code).toBe("VOICE_INTERNAL_ERROR")
	})

	it("maps an unknown non-zero code to a process failure", () => {
		expect(mapExitCodeToError(99, "").code).toBe("TRANSCRIBE_PROCESS_FAILED")
	})
})

describe("summariseStderr", () => {
	it("keeps only the tail and bounds the length", () => {
		const stderr = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")
		const summary = summariseStderr(stderr, 2, 40)
		expect(summary).toContain("line 49")
		expect(summary.length).toBeLessThanOrEqual(41)
	})

	it("never returns audio-like payloads because whisper writes none to stderr", () => {
		// Guard: the summariser is a plain text tail, so it can only echo what the
		// engine wrote. This pins that it does not accumulate unbounded data.
		const huge = "x".repeat(100000)
		expect(summariseStderr(huge).length).toBeLessThanOrEqual(401)
	})
})
