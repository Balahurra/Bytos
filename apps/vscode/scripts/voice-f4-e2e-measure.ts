/**
 * F4 — real end-to-end voice measurement (developer tool, not shipped).
 *
 * Runs the EXACT production classes the composer uses, with a REAL microphone
 * and the REAL pinned whisper engine:
 *
 *   WasapiCaptureProvider → AudioCaptureCoordinator → VoiceRuntime
 *     → UtteranceBuffer → WhisperCliEngine → TranscribeResult.text
 *
 * Why this exists: the F4 acceptance criteria require quality and latency
 * numbers measured on real speech, not on synthetic fixtures. This script is how
 * those numbers are produced. It deliberately does NOT go through ProtoBus or the
 * webview, so it isolates the audio/recognition half of the chain; the
 * webview/composer half is covered by the webview tests and the Developer Host
 * run described in the F4 report.
 *
 * Privacy: samples are held in memory and never written to disk. Only counters,
 * timings and the transcript (which the developer asked to produce) are printed.
 *
 * Usage (from `apps/vscode`):
 *   bun scripts/voice-f4-e2e-measure.ts --seconds 5 --language tr --model base
 *   bun scripts/voice-f4-e2e-measure.ts --seconds 5 --language auto --models tiny,base
 *   bun scripts/voice-f4-e2e-measure.ts --silence --seconds 3
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { resolveVoiceCapability } from "../src/core/voice/capability"
import { AudioCaptureCoordinator } from "../src/core/voice/capture/AudioCaptureCoordinator"
import { WasapiCaptureProvider } from "../src/core/voice/capture/WasapiCaptureProvider"
import { containsSpeech, rms } from "../src/core/voice/transcription/speechGuard"
import { WhisperCliEngine } from "../src/core/voice/transcription/WhisperCliEngine"
import { wavFromPcm16 } from "../src/core/voice/transcription/wav"
import { runWhisperForTranscript } from "../src/core/voice/transcription/whisperProcess"
import { VOICE_SAMPLE_RATE } from "../src/core/voice/types"
import { VoiceRuntime } from "../src/core/voice/VoiceRuntime"

const EXTENSION_ROOT = path.resolve(import.meta.dir, "..")
const ASSETS = path.join(EXTENSION_ROOT, "test-assets", "voice-f2")
const ENGINE_ROOT = path.join(ASSETS, "whisper")
const MODEL_DIR = path.join(ASSETS, "models")

type Language = "auto" | "tr" | "en" | "de"
type ModelId = "tiny" | "base"

interface Args {
	seconds: number
	language: Language
	models: ModelId[]
	device: string
	silence: boolean
	/** Also print the engine's un-filtered output, for calibration. */
	raw: boolean
}

function parseArgs(argv: string[]): Args {
	const value = (name: string, fallback: string): string => {
		const index = argv.indexOf(`--${name}`)
		return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback
	}
	const language = value("language", "auto")
	const models = value("models", value("model", "base"))
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry): entry is ModelId => entry === "tiny" || entry === "base")
	return {
		seconds: Number(value("seconds", "5")),
		language: (["auto", "tr", "en", "de"].includes(language) ? language : "auto") as Language,
		models: models.length > 0 ? models : ["base"],
		device: value("device", ""),
		silence: argv.includes("--silence"),
		raw: argv.includes("--raw"),
	}
}

/**
 * Runs the pinned CLI directly and returns its un-filtered stdout, so the
 * hallucination filter can be calibrated against what the engine really emits.
 */
async function rawTranscript(samples: Int16Array, language: Language, modelId: ModelId): Promise<string> {
	const modelPath = path.join(MODEL_DIR, `ggml-${modelId}.bin`)
	const base = path.join(os.tmpdir(), `bytos-f4-raw-${process.pid}-${Date.now()}`)
	try {
		const result = await runWhisperForTranscript({
			executablePath: path.join(ENGINE_ROOT, "b5454", "whisper-cli.exe"),
			modelPath,
			language,
			audio: wavFromPcm16(samples),
			timeoutMs: 120000,
		})
		return result.stdout.replace(/\s+/g, " ").trim()
	} finally {
		await fs.promises.rm(`${base}.txt`, { force: true }).catch(() => undefined)
	}
}

/** Captured-utterance facts, computed from the PCM the runtime handed back. */
function describeSamples(samples: Int16Array): { sampleCount: number; durationMs: number; rms: number; hasSpeech: boolean } {
	return {
		sampleCount: samples.length,
		durationMs: Math.round((samples.length / VOICE_SAMPLE_RATE) * 1000),
		rms: Math.round(rms(samples)),
		hasSpeech: containsSpeech(samples),
	}
}

async function run(args: Args): Promise<void> {
	if (!fs.existsSync(ENGINE_ROOT) || !fs.existsSync(MODEL_DIR)) {
		console.error("Missing test-assets/voice-f2 (engine or models).")
		process.exitCode = 1
		return
	}

	const capability = resolveVoiceCapability({
		extensionRoot: EXTENSION_ROOT,
		deviceCount: 1,
		permission: "granted",
		recorderIsolationVerified: true,
		voiceEnabled: true,
	})
	if (!capability.canCapture || !capability.helperPath) {
		console.error(`Cannot capture: ${capability.reason} ${capability.detail}`)
		process.exitCode = 1
		return
	}

	// Real engine (same class the host uses), real helper, real runtime.
	const engine = new WhisperCliEngine()
	await engine.init({ engineRoot: ENGINE_ROOT, modelDir: MODEL_DIR })

	const provider = new WasapiCaptureProvider({ helperPath: path.resolve(capability.helperPath) })
	const coordinator = new AudioCaptureCoordinator({ providers: [provider], captureMethod: "auto" })
	const runtime = new VoiceRuntime(capability, coordinator, {
		silenceTimeoutMs: 1200,
		maxDurationMs: 120000,
		recognitionEngine: engine,
		defaultModelId: args.models[0],
	})

	const devices = await provider.enumerateDevices()
	const active = devices.filter((entry) => entry.state === "active")
	const device = args.device
		? active.find((entry) => entry.id === args.device)
		: (active.find((entry) => entry.isDefault) ?? active[0])

	console.log("=== F4 real end-to-end measurement ===")
	console.log(`active mics   : ${active.length === 0 ? "(none)" : active.map((entry) => entry.name).join(" | ")}`)
	console.log(`device        : ${device ? `${device.name}${device.isDefault ? " (default)" : ""}` : "(system default)"}`)
	console.log(
		`requested     : ${args.seconds}s of ${args.silence ? "NO speech (silence test)" : `speech in "${args.language}"`}`,
	)
	console.log(`models        : ${args.models.join(", ")}`)

	const started = await runtime.startCapture({ deviceId: args.device || undefined })
	console.log(
		`session       : ${started.sessionId} @ ${started.sampleRate} Hz, ${started.channels} ch, backend ${started.backend}`,
	)

	// Speak now; then stop and transcribe, exactly like the "Metne Çevir" click.
	await new Promise((resolve) => setTimeout(resolve, Math.max(500, args.seconds * 1000)))
	// The runtime stops itself when silence seals the utterance; a click at that
	// moment must still transcribe, so take the same branch the handler does.
	const stopStartedAt = Date.now()
	const state = runtime.captureState
	const stopped =
		state === "capturing" || state === "starting"
			? await runtime.stopCapture({ reason: "stopped" })
			: {
					samples: runtime.drain(),
					durationMs: 0,
					counters: { frames: 0, bytes: 0, droppedFrames: 0 },
					truncated: false,
					sessionId: runtime.currentSessionId,
					reason: "stopped",
				}
	const stopMs = Date.now() - stopStartedAt
	const info = describeSamples(stopped.samples)
	console.log(`stopped from  : ${state}`)
	console.log(
		`captured      : ${info.sampleCount} samples, ${info.durationMs} ms, rms=${info.rms}, containsSpeech=${info.hasSpeech}`,
	)
	console.log(
		`frames/bytes  : ${stopped.counters.frames} frames, ${stopped.counters.bytes} bytes, truncated=${stopped.truncated}`,
	)
	console.log(`stop took     : ${stopMs} ms`)

	for (const modelId of args.models) {
		const transcribeStartedAt = Date.now()
		const result = await runtime.transcribeUtterance({
			samples: stopped.samples,
			language: args.language,
			modelId,
		})
		const wallMs = Date.now() - transcribeStartedAt
		const rtf = result.audioDurationMs > 0 ? wallMs / result.audioDurationMs : Number.POSITIVE_INFINITY
		console.log("")
		console.log(`--- model ${modelId} ---`)
		console.log(`wall          : ${wallMs} ms (engine inference ${Math.round(result.inferenceMs ?? 0)} ms)`)
		console.log(`audio         : ${Math.round(result.audioDurationMs)} ms  RTF=${rtf.toFixed(2)}x`)
		console.log(`language      : requested=${args.language} reported=${result.language}`)
		console.log(`warnings      : ${result.warnings.length === 0 ? "(none)" : result.warnings.join(" | ")}`)
		console.log(`transcript    : ${JSON.stringify(result.text)}`)
		if (args.raw)
			console.log(`raw engine out: ${JSON.stringify(await rawTranscript(stopped.samples, args.language, modelId))}`)
	}

	// Release everything: no audio survives this process.
	stopped.samples = new Int16Array(0)
	await runtime.dispose()
	await engine.dispose()
}

function main(): Promise<void> {
	return run(parseArgs(process.argv.slice(2)))
}

void main().catch((error) => {
	console.error("measurement failed:", error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
