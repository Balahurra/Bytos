/**
 * F4 diagnostic — runtime layer tracing.
 *
 * Developer tool, not shipped. Wraps the real `VoiceRuntime` and prints what it
 * observes at each step, so the "captured but never transcribed" failure can be
 * attributed to a specific stage rather than guessed at.
 *
 * Usage (from `apps/vscode`):
 *   bun scripts/voice-f4-runtime-diag.ts --seconds 4 --language tr
 */
import * as path from "node:path"
import { resolveVoiceCapability } from "../src/core/voice/capability"
import { AudioCaptureCoordinator } from "../src/core/voice/capture/AudioCaptureCoordinator"
import { WasapiCaptureProvider } from "../src/core/voice/capture/WasapiCaptureProvider"
import { containsSpeech, rms } from "../src/core/voice/transcription/speechGuard"
import { VoiceRuntime } from "../src/core/voice/VoiceRuntime"

const EXTENSION_ROOT = path.resolve(import.meta.dir, "..")

function intArg(name: string, fallback: number): number {
	const index = process.argv.indexOf(`--${name}`)
	const raw = index >= 0 ? Number(process.argv[index + 1]) : fallback
	return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

async function main(): Promise<void> {
	const capability = resolveVoiceCapability({
		extensionRoot: EXTENSION_ROOT,
		deviceCount: 1,
		permission: "granted",
		recorderIsolationVerified: true,
		voiceEnabled: true,
	})
	const provider = new WasapiCaptureProvider({ helperPath: path.resolve(capability.helperPath ?? "") })
	const coordinator = new AudioCaptureCoordinator({ providers: [provider], captureMethod: "auto" })
	const runtime = new VoiceRuntime(capability, coordinator, { silenceTimeoutMs: 1200, maxDurationMs: 120000 })

	const events: string[] = []
	runtime.onEvent((event) => {
		events.push(
			`${event.kind} state=${event.captureState} frames=${event.bytesReceived} durationMs=${Math.round(event.durationMs)} code=${event.code ?? ""}`,
		)
	})

	await runtime.startCapture({})
	console.log(`after start   : state=${runtime.captureState}`)
	const seconds = intArg("seconds", 4)
	const ticks = Math.max(2, seconds * 2)
	for (let i = 0; i < ticks; i++) {
		await new Promise((resolve) => setTimeout(resolve, 500))
		const snapshot = runtime.snapshot()
		console.log(
			`t=${((i + 1) * 0.5).toFixed(1)}s state=${runtime.captureState} frames=${snapshot.framesReceived} bytes=${snapshot.bytesReceived} pending=${runtime.hasPendingUtterance}`,
		)
	}
	// `drain()` RELEASES the utterance, so it is called exactly once — the same
	// way `transcribeUtterance` calls it.
	const drained = runtime.drain()
	console.log(
		`drain         : samples=${drained.length} durationMs=${Math.round((drained.length / 16000) * 1000)} rms=${Math.round(rms(drained))} containsSpeech=${containsSpeech(drained)}`,
	)
	console.log("--- events ---")
	for (const line of events) console.log(`  ${line}`)
	await runtime.dispose()
}

void main().catch((error) => {
	console.error("diag failed:", error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
