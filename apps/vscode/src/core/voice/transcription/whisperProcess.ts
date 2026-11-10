import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { scrubHelperEnv } from "../capture/WasapiCaptureProvider"
import { VoiceError } from "../types"
import { VoiceSessionRegistry } from "../VoiceSessionRegistry"
import type { VoiceLanguage } from "./types"
import { buildWhisperArgs } from "./whisperArgs"

/**
 * Child-process plumbing for one transcription (F2-d).
 *
 * Split out from `WhisperCliEngine` so the parts that must be exact — stdin
 * streaming, timeout, abort and process reaping — can be exercised against a real
 * child process without dragging model verification in.
 *
 * ## Why stdin is written and awaited, not `end(buffer)`
 *
 * `stdin.end(buffer)` returned before the bytes reached the child on Windows and
 * the run produced an empty transcript with exit 0. The write is therefore
 * awaited explicitly and only then closed, so EOF always follows the whole
 * payload. The measured child output is `read_audio_data: read <exact> bytes from
 * stdin`, which the tests assert.
 */

export interface WhisperChildOptions {
	executablePath: string
	args: string[]
	/** Complete in-memory WAV bytes. Never a path. */
	audio: Buffer
	timeoutMs: number
	signal?: AbortSignal
	onSpawn?: (child: ChildProcess) => void
	/** Injectable for tests. */
	spawnImpl?: typeof spawn
}

export interface WhisperChildResult {
	stdout: string
	stderr: string
	exitCode: number | null
}

/**
 * Runs the recogniser with a temporary output base name and cleans it up.
 *
 * The base name exists only because `-of -` cannot reach a pipe on the pinned
 * build (see `whisperArgs.ts` note 2). `<base>.txt` holds transcript *text* for
 * the duration of the call and is deleted in a `finally`; no audio file is ever
 * created, so the "no audio on disk" guarantee is unaffected.
 */
export async function runWhisperForTranscript(options: {
	executablePath: string
	modelPath: string
	language: VoiceLanguage
	audio: Buffer
	timeoutMs: number
	signal?: AbortSignal
	onSpawn?: (child: ChildProcess) => void
	spawnImpl?: typeof spawn
	/** Test seam: observe every file name the CLI was asked to write. */
	onOutputBase?: (base: string) => void
}): Promise<WhisperChildResult> {
	const base = path.join(os.tmpdir(), `bytos-whisper-${process.pid}-${randomUUID()}`)
	options.onOutputBase?.(base)
	const args = buildWhisperArgs({
		modelPath: options.modelPath,
		language: options.language,
		outputBase: base,
	})
	try {
		return await spawnWhisperChild({
			executablePath: options.executablePath,
			args,
			audio: options.audio,
			timeoutMs: options.timeoutMs,
			signal: options.signal,
			onSpawn: options.onSpawn,
			spawnImpl: options.spawnImpl,
		})
	} finally {
		// Every output format the CLI could have produced, then the bare base.
		await Promise.all(
			[".txt", ".srt", ".vtt", ".json", ".csv", ".lrc"].map((ext) =>
				fs.promises.rm(`${base}${ext}`, { force: true }).catch(() => undefined),
			),
		)
		await fs.promises.rm(base, { force: true }).catch(() => undefined)
	}
}

/** Bound on captured stderr; whisper is verbose and a wedge must not fill RAM. */
const MAX_STDERR_CHARS = 64 * 1024
/** Bound on stdout; a real transcript is far smaller than this. */
const MAX_STDOUT_CHARS = 1024 * 1024
/** How long to wait before escalating a kill. */
const KILL_GRACE_MS = 2000

export type WhisperProcessFailure = "timeout" | "aborted" | "spawn"

export function processFailureError(kind: WhisperProcessFailure, message: string): VoiceError {
	const code =
		kind === "timeout" ? "TRANSCRIBE_TIMEOUT" : kind === "aborted" ? "TRANSCRIBE_ABORTED" : "TRANSCRIBE_PROCESS_FAILED"
	return new VoiceError(code, message)
}

/**
 * Runs the recogniser once and resolves with its output.
 *
 * Resolves on any exit; the caller decides what an exit code means. Rejects only
 * when the run could not happen (spawn failure) or was cut short (timeout/abort).
 * Every path kills the child and unregisters it.
 */
export async function spawnWhisperChild(options: WhisperChildOptions): Promise<WhisperChildResult> {
	const spawnImpl = options.spawnImpl ?? spawn
	if (options.signal?.aborted) {
		throw processFailureError("aborted", "The transcription was cancelled.")
	}

	let child: ChildProcess
	try {
		child = spawnImpl(options.executablePath, options.args, {
			stdio: ["pipe", "pipe", "pipe"],
			// argv array with no shell: paths containing spaces or non-ASCII stay
			// intact, and nothing is interpreted by a command processor.
			shell: false,
			windowsHide: true,
			// Run in the OS temp dir so a hypothetical relative output file could
			// never land in the user's workspace. The engine never asks for one.
			cwd: os.tmpdir(),
			// No provider credentials may be visible to the recogniser.
			env: scrubHelperEnv(process.env),
		})
	} catch (error) {
		throw processFailureError("spawn", error instanceof Error ? error.message : "The recogniser could not be started.")
	}
	VoiceSessionRegistry.register(child)
	options.onSpawn?.(child)

	let stdout = ""
	let stderr = ""
	let timedOut = false
	let aborted = false

	child.stdout?.setEncoding("utf8")
	child.stderr?.setEncoding("utf8")
	child.stdout?.on("data", (chunk: string) => {
		if (stdout.length < MAX_STDOUT_CHARS) stdout += chunk
	})
	child.stderr?.on("data", (chunk: string) => {
		// Keep a bounded TAIL: the useful diagnostics are at the end.
		stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS)
	})
	// A child that dies mid-write must not raise an unhandled EPIPE.
	child.stdin?.on("error", () => undefined)

	const timer = setTimeout(
		() => {
			timedOut = true
			killChild(child)
		},
		Math.max(1, options.timeoutMs),
	)
	timer.unref?.()

	const onAbort = () => {
		aborted = true
		killChild(child)
	}
	options.signal?.addEventListener("abort", onAbort, { once: true })

	try {
		await writeAndClose(child, options.audio)
		const exitCode = await waitForClose(child)
		if (aborted) throw processFailureError("aborted", "The transcription was cancelled.")
		if (timedOut) throw processFailureError("timeout", "The transcription took too long and was stopped.")
		return { stdout, stderr, exitCode }
	} finally {
		clearTimeout(timer)
		options.signal?.removeEventListener("abort", onAbort)
		VoiceSessionRegistry.unregister(child)
		if (child.exitCode === null && child.signalCode === null) killChild(child)
	}
}

/**
 * Writes the whole payload, waits for it to be flushed, then sends EOF.
 *
 * The write is awaited because an un-awaited write followed by `end()` produced
 * truncated input on Windows: the child then read fewer bytes than were sent and
 * still exited 0.
 */
async function writeAndClose(child: ChildProcess, audio: Buffer): Promise<void> {
	const stdin = child.stdin
	if (!stdin) throw processFailureError("spawn", "The recogniser has no stdin.")
	if (stdin.destroyed || !stdin.writable) return
	try {
		await new Promise<void>((resolve, reject) => {
			stdin.write(audio, (error) => {
				if (error) reject(error)
				else resolve()
			})
		})
	} catch (error) {
		// A child that exited early closes the pipe. That is reported through the
		// exit code, which is more accurate than a write error.
		if (!isBrokenPipe(error)) throw error
	}
	try {
		stdin.end()
	} catch {
		// pipe already closed by the child
	}
}

function isBrokenPipe(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code
	return code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "EOF"
}

/** Resolves with the exit code once the process is really gone. */
function waitForClose(child: ChildProcess): Promise<number | null> {
	if (child.exitCode !== null) return Promise.resolve(child.exitCode)
	return new Promise<number | null>((resolve) => {
		child.once("close", (code) => resolve(code))
		child.once("error", () => resolve(child.exitCode ?? null))
	})
}

/** SIGTERM first, then SIGKILL after a grace period, so callers never hang. */
function killChild(child: ChildProcess): void {
	if (child.exitCode !== null || child.signalCode !== null) return
	try {
		child.kill()
	} catch {
		return
	}
	const timer = setTimeout(() => {
		try {
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
		} catch {
			// already gone
		}
	}, KILL_GRACE_MS)
	timer.unref?.()
}
