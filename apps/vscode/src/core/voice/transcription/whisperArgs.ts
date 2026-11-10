import * as os from "node:os"
import * as path from "node:path"
import { VoiceError } from "../types"
import { assertSupportedLanguage } from "./language"
import type { VoiceLanguage } from "./types"

const { availableParallelism } = os

/**
 * Pure `whisper-cli` argument builder (F2-b).
 *
 * ## The non-obvious constraints, all measured on the pinned `b5454` build
 *
 * 1. **Input must be stdin, as a bare `-` positional.** `-f -` reads the audio
 *    but the CLI then derives its output names from the input file name and the
 *    transcript never reaches the caller.
 * 2. **`-of -` does NOT reach a pipe.** Measured: with stdout bound to a pipe
 *    *or even to a file descriptor*, `-of -` still prints the transcript to the
 *    console device and leaves the pipe empty (`exit 0`, empty stdout). The
 *    process writes through the CRT's console path, which a redirected handle
 *    does not capture.
 * 3. **`-of <path> -otxt` DOES reach the pipe.** With a real path as the output
 *    base name, the transcript is written to `<path>.txt` *and* echoed to
 *    stdout, which is captured reliably. Measured on all three languages.
 *
 * The engine therefore passes a short-lived output base name inside the OS temp
 * directory (see `whisperProcess.ts`) and deletes `<path>.txt` in a `finally`.
 * The transcript channel is stdout — the file is only the flag that makes the
 * CLI take that code path, and it contains transcript text, never audio.
 *
 * `-np` is deliberately NOT passed. It calls `whisper_log_set(cb_log_disable)`,
 * which silences the very stderr lines Bytos needs: the
 * `auto-detected language: <code> (p = …)` report and the timing summary. Noise
 * is controlled instead by keeping only a bounded stderr tail in memory.
 */

/** Flags Bytos owns; a caller must never inject them. */
const FORBIDDEN_FLAGS = new Set([
	"-f",
	"--file",
	"-of",
	"--output-file",
	"-otxt",
	"--output-txt",
	"-ovtt",
	"--output-vtt",
	"-osrt",
	"--output-srt",
	"-olrc",
	"--output-lrc",
	"-owts",
	"--output-words",
	"-ocsv",
	"--output-csv",
	"-oj",
	"--output-json",
	"-ojf",
	"--output-json-full",
	"-t",
	"--threads",
	"-p",
	"--processors",
	"-m",
	"--model",
	"-l",
	"--language",
	"-tr",
	"--translate",
	"-di",
	"--diarize",
	"-tdrz",
	"--tinydiarize",
	"-debug",
	"--debug-mode",
	"-dl",
	"--detect-language",
])

export interface BuildArgsOptions {
	modelPath: string
	language: VoiceLanguage
	/**
	 * Output base name (no extension). The CLI writes `<outputBase>.txt` and
	 * echoes the transcript to stdout; the caller deletes the file.
	 */
	outputBase: string
	/** Worker threads. Defaults to a conservative fixed value. */
	threads?: number
	/** Extra flags, validated against the forbidden set. */
	extraArgs?: string[]
}

/**
 * Worker threads for one transcription.
 *
 * Measured on the reference host (AMD Ryzen 7 260, 8 cores / 16 threads, `base`,
 * 4.25 s of Turkish speech), running one transcription at a time:
 *
 * | threads | wall time |
 * |---|---|
 * | 4 (whisper.cpp default) | 1499 ms |
 * | 8 | 1366 ms |
 * | 12 | 1234 ms |
 * | 16 | 1322 ms |
 *
 * So a fixed 4 gave away ≈ 18 %. Going past `cores - 1` loses again (16 was
 * slower than 12) because the extension host and the OS compete for the same
 * logical CPUs.
 *
 * ## Why the cap is 6, not 8 (measured)
 *
 * The gain above 6 threads is within measurement noise of a loaded machine, and
 * the cost is not: this repo's own test suite runs many real-whisper suites in
 * parallel, and at 8 threads each the combined demand (8 × ~15 workers) exceeds
 * the 16 logical CPUs. Every transcription then runs slower than it would alone
 * and the real-engine tests time out. 6 keeps the measured speed-up while leaving
 * headroom for the editor, other extensions and a busy build.
 *
 * The Bytos voice path is interactive: one utterance at a time, from a user who
 * is waiting. Saturating the machine to shave 100 ms off a 1.3 s transcription is
 * the wrong trade.
 */
export function defaultWhisperThreads(cores: number = availableParallelism()): number {
	if (!Number.isFinite(cores) || cores < 2) return 1
	const safeCores = Math.floor(cores)
	// `cores - 1` leaves one CPU for the host; hard cap at 6 for the reasons above.
	return Math.max(1, Math.min(6, safeCores - 1))
}

/**
 * Legacy constant, kept so existing call sites and assertions keep a name.
 * Prefer {@link defaultWhisperThreads}, which adapts to the host.
 */
export const DEFAULT_WHISPER_THREADS = 4

/**
 * Builds the exact argv for one utterance.
 *
 * The input position is always the last element and is always `-`, so the parser
 * cannot mistake a flag value for the input file.
 */
export function buildWhisperArgs(options: BuildArgsOptions): string[] {
	if (typeof options.modelPath !== "string" || options.modelPath.length === 0) {
		throw new VoiceError("TRANSCRIBE_PROCESS_FAILED", "A model path is required")
	}
	if (typeof options.outputBase !== "string" || options.outputBase.length === 0) {
		throw new VoiceError("TRANSCRIBE_PROCESS_FAILED", "An output base name is required")
	}
	const language = assertSupportedLanguage(options.language)
	const threads = options.threads ?? defaultWhisperThreads()
	if (!Number.isInteger(threads) || threads < 1 || threads > 64) {
		throw new VoiceError("TRANSCRIBE_PROCESS_FAILED", `Invalid thread count: ${options.threads}`)
	}
	for (const arg of options.extraArgs ?? []) {
		if (FORBIDDEN_FLAGS.has(arg)) {
			throw new VoiceError("TRANSCRIBE_PROCESS_FAILED", `Argument ${arg} is owned by the engine`)
		}
		if (arg === "-" || arg.startsWith("@")) {
			throw new VoiceError("TRANSCRIBE_PROCESS_FAILED", `Argument ${arg} would change the audio source`)
		}
	}

	return [
		"-m",
		path.resolve(options.modelPath),
		"-l",
		language,
		"-t",
		String(threads),
		"-nt", // no timestamps in the transcript text
		"-of",
		path.resolve(options.outputBase), // a real path, never "-": see note 2
		"-otxt",
		...(options.extraArgs ?? []),
		"-", // stdin
	]
}

/**
 * Parses the transcript out of whisper's stdout.
 *
 * With `-nt`, each segment is printed without timestamps, so the text is the
 * stdout content itself. Leading blank lines and per-line indentation are
 * artefacts of whisper's `printf("\\n")` before the first segment.
 */
export function parseTranscriptStdout(stdout: string): string {
	if (typeof stdout !== "string") {
		throw new VoiceError("TRANSCRIBE_OUTPUT_INVALID", "Engine stdout was not text")
	}
	return normaliseTranscript(stdout)
}

/**
 * Normalises a transcript for insertion into a draft: strips whisper's leading
 * newline/indent artefacts, collapses runs of whitespace, and trims. Sentence
 * case and punctuation are left exactly as the engine produced them — rewriting
 * them would be inventing text the user did not say.
 */
export function normaliseTranscript(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
}

/** Parses whisper's `whisper_print_timings: total time =  N ms` line. */
export function parseInferenceMs(stderr: string): number | undefined {
	const match = /total time\s*=\s*([0-9.]+)\s*ms/.exec(stderr)
	if (!match) return undefined
	const value = Number.parseFloat(match[1])
	return Number.isFinite(value) ? value : undefined
}

/**
 * Parses whisper's auto-detected language.
 *
 * Measured output on the pinned build:
 *   `whisper_full_with_state: auto-detected language: tr (p = 0.989703)`
 *
 * The earlier `lang = …` field in the same stream is the *requested* language
 * (it reads `lang = auto`), so it must not be used here — matching it would
 * report "auto" as the detected language.
 */
export function parseDetectedLanguage(stderr: string): string | undefined {
	const match = /auto-detected language:\s*([a-z]{2,3})\b/i.exec(stderr)
	return match ? match[1].toLowerCase() : undefined
}

/** Confidence whisper attached to the auto-detected language, when present. */
export function parseDetectedLanguageProbability(stderr: string): number | undefined {
	const match = /auto-detected language:\s*[a-z]{2,3}\s*\(p\s*=\s*([0-9.]+)\)/i.exec(stderr)
	if (!match) return undefined
	const value = Number.parseFloat(match[1])
	return Number.isFinite(value) ? value : undefined
}
