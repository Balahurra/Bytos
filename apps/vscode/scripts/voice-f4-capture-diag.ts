/**
 * F4 diagnostic — where does the captured audio go?
 *
 * Developer tool, not shipped. It drives the SAME provider the host uses and
 * reports what each layer observed, so a "recording produces no text" report can
 * be attributed to the provider, the coordinator, or the runtime instead of being
 * guessed at.
 *
 * Usage (from `apps/vscode`): `bun scripts/voice-f4-capture-diag.ts --seconds 4`
 */
import * as path from "node:path"
import { resolveVoiceCapability } from "../src/core/voice/capability"
import { AudioCaptureCoordinator, FrameNormaliser } from "../src/core/voice/capture/AudioCaptureCoordinator"
import { WasapiCaptureProvider } from "../src/core/voice/capture/WasapiCaptureProvider"
import { rms } from "../src/core/voice/transcription/speechGuard"

const EXTENSION_ROOT = path.resolve(import.meta.dir, "..")

function secondsArg(): number {
	const index = process.argv.indexOf("--seconds")
	const raw = index >= 0 ? Number(process.argv[index + 1]) : 4
	return Number.isFinite(raw) && raw > 0 ? raw : 4
}

async function main(): Promise<void> {
	const capability = resolveVoiceCapability({
		extensionRoot: EXTENSION_ROOT,
		deviceCount: 1,
		permission: "granted",
		recorderIsolationVerified: true,
		voiceEnabled: true,
	})
	if (!capability.helperPath) {
		console.error("helper missing")
		process.exitCode = 1
		return
	}

	const provider = new WasapiCaptureProvider({ helperPath: path.resolve(capability.helperPath) })
	const coordinator = new AudioCaptureCoordinator({ providers: [provider], captureMethod: "auto" })
	const normaliser = new FrameNormaliser()

	// Layer 1: raw provider frames.
	let providerFrames = 0
	let providerSamples = 0
	let providerRmsSum = 0
	let providerPeak = 0
	provider.onFrames((frame) => {
		providerFrames += 1
		providerSamples += frame.samples.length
		const level = rms(frame.samples)
		providerRmsSum += level
		for (const sample of frame.samples) providerPeak = Math.max(providerPeak, Math.abs(sample))
	})

	// Layer 2: coordinator subscription (what the runtime would receive).
	let coordinatorFrames = 0
	let coordinatorSamples = 0
	coordinator.onFrames((frame) => {
		coordinatorFrames += 1
		coordinatorSamples += normaliser.normalise(frame).samples.length
	})

	const started = await coordinator.start({ deviceId: undefined })
	console.log(`started: backend=${started.backend} rate=${started.sampleRate} channels=${started.channels}`)
	await new Promise((resolve) => setTimeout(resolve, secondsArg() * 1000))
	const stopped = await coordinator.stop()
	await new Promise((resolve) => setTimeout(resolve, 300))

	console.log("--- provider layer ---")
	console.log(`frames=${providerFrames} samples=${providerSamples} durationMs=${Math.round((providerSamples / 16000) * 1000)}`)
	console.log(`meanRms=${providerFrames > 0 ? Math.round(providerRmsSum / providerFrames) : 0} peak=${providerPeak}`)
	console.log("--- coordinator stop counters ---")
	console.log(`framesReceived=${stopped.framesReceived} bytesReceived=${stopped.bytesReceived}`)
	console.log("--- coordinator listener layer ---")
	console.log(`frames=${coordinatorFrames} samples=${coordinatorSamples}`)
	await coordinator.dispose()
}

void main().catch((error) => {
	console.error("diag failed:", error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
