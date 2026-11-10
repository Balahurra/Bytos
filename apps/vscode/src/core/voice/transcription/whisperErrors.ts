import { VoiceError, type VoiceErrorCode } from "../types"

/**
 * Exit-code and stderr → typed error mapping (F2-c).
 *
 * Measured exit codes from the pinned `b5454` build:
 *
 * | Code | Meaning | Observed trigger |
 * |---|---|---|
 * | 0 | success | normal run |
 * | 1 | bad arguments | argument parse failure |
 * | 2 | no usable input files | no input positional given |
 * | 3 | model problem | `-m` missing **and** a corrupt model (`bad magic`) — the same code for both |
 * | 0 with "unknown language" | **error reported as success** | `-l xx` → stderr `error: unknown language` then `exit(0)` |
 * | 11 | audio could not be decoded | garbage bytes or empty stdin |
 *
 * Two consequences drive this module's design:
 *  1. A bad language exits **0**, so the exit code alone is not enough.
 *  2. "Missing model" and "corrupt model" share code 3, so the exit code cannot
 *     distinguish them either.
 *
 * Therefore stderr signatures are matched **before** the exit-code table, and the
 * success path in the engine additionally rejects empty stdout for non-empty
 * audio.
 */

/** stderr fragments that indicate a specific, known failure. */
const STDERR_SIGNATURES: ReadonlyArray<{ pattern: RegExp; code: VoiceErrorCode; message: string }> = [
	{
		pattern: /failed to open audio data from stdin/i,
		code: "TRANSCRIBE_AUDIO_INVALID",
		message: "The recogniser could not decode the utterance.",
	},
	{
		pattern: /failed to read audio/i,
		code: "TRANSCRIBE_AUDIO_INVALID",
		message: "The recogniser could not read the utterance.",
	},
	{
		pattern: /error: unknown language/i,
		code: "TRANSCRIBE_LANGUAGE_UNSUPPORTED",
		message: "The recogniser does not support the requested language.",
	},
	{
		pattern: /error: model file not found/i,
		code: "MODEL_FILE_MISSING",
		message: "The installed model file is missing.",
	},
	{
		pattern: /failed to load model|error loading model|whisper_init_from_file.*failed/i,
		code: "MODEL_FILE_CORRUPT",
		message: "The installed model file could not be loaded.",
	},
	{
		pattern: /invalid model file|bad magic|unsupported model/i,
		code: "MODEL_FILE_CORRUPT",
		message: "The installed model file is not a valid whisper model.",
	},
	{
		pattern: /error: no input files specified/i,
		code: "TRANSCRIBE_AUDIO_INVALID",
		message: "No audio was supplied to the recogniser.",
	},
]

/** Exit-code → typed error, used when no stderr signature matched. */
export function mapExitCodeToError(exitCode: number | null, stderr: string): VoiceError {
	const signature = STDERR_SIGNATURES.find((entry) => entry.pattern.test(stderr))
	if (signature) {
		return new VoiceError(signature.code, signature.message)
	}
	switch (exitCode) {
		case 0:
			// Not an error by itself; the caller decides whether empty output is
			// acceptable.
			return new VoiceError("VOICE_INTERNAL_ERROR", "The recogniser reported success but produced no text.")
		case 1:
			return new VoiceError("TRANSCRIBE_PROCESS_FAILED", "The recogniser rejected its arguments.")
		case 2:
			return new VoiceError("TRANSCRIBE_AUDIO_INVALID", "The recogniser received no usable audio.")
		case 3:
			return new VoiceError("MODEL_FILE_MISSING", "The recogniser could not find the model file.")
		case 11:
			return new VoiceError("TRANSCRIBE_AUDIO_INVALID", "The recogniser failed to process the audio.")
		default:
			return new VoiceError("TRANSCRIBE_PROCESS_FAILED", `The recogniser exited with code ${String(exitCode)}.`)
	}
}

/**
 * Reduces engine stderr to a bounded, audio-free diagnostic string.
 *
 * Only the last few lines are kept: whisper is verbose, and an unbounded stderr
 * buffer for a 2-minute utterance is both a memory and a log-size hazard. No line
 * kept here can contain audio — whisper never writes samples to stderr, and the
 * engine never passes a path to it that could.
 */
export function summariseStderr(stderr: string, maxLines = 4, maxChars = 400): string {
	const lines = stderr
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
	const tail = lines.slice(-maxLines).join(" | ")
	return tail.length > maxChars ? `${tail.slice(0, maxChars)}…` : tail
}
