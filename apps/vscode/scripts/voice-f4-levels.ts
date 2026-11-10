/**
 * F4 diagnostic — measured microphone levels vs the detector thresholds.
 *
 * Developer tool, not shipped. Prints the RMS distribution of real speech, soft
 * speech, room tone and silence from the real microphone, next to the thresholds
 * `SilenceDetector` and `speechGuard` currently use. This is how the thresholds
 * were calibrated; it is not a test and asserts nothing.
 *
 * Usage (from `apps/vscode`): `bun scripts/voice-f4-levels.ts --seconds 8`
 */
import * as path from "node:path"
import { SILENCE_RMS_THRESHOLD_NORMALISED } from "../src/core/voice/audio/SilenceDetector"
import { resolveVoiceCapability } from "../src/core/voice/capability"
import { AudioCaptureCoordinator } from "../src/core/voice/capture/AudioCaptureCoordinator"
import { WasapiCaptureProvider } from "../src/core/voice/capture/WasapiCaptureProvider"
import { SPEECH_RMS_FLOOR } from "../src/core/voice/transcription/speechGuard"

const EXTENSION_ROOT = path.resolve(import.meta.dir, "..")
const FRAME = 1600

function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
	return sorted[index]
}

async function main(): Promise<void> {
	const index = process.argv.indexOf("--seconds")
	const seconds = index >= 0 ? Number(process.argv[index + 1]) : 8
	const capability = resolveVoiceCapability({
		extensionRoot: EXTENSION_ROOT,
		deviceCount: 1,
		permission: "granted",
		recorderIsolationVerified: true,
		voiceEnabled: true,
	})
	const provider = new WasapiCaptureProvider({ helperPath: path.resolve(capability.helperPath ?? "") })
	const coordinator = new AudioCaptureCoordinator({ providers: [provider], captureMethod: "auto" })
	const all: number[] = []
	let seen = 0
	const carry: number[] = []
	provider.onFrames((frame) => {
		seen += 1
		// Device packets are ~10 ms, so accumulate into exact 100 ms blocks.
		for (let i = 0; i < frame.samples.length; i++) carry.push(frame.samples[i])
		while (carry.length >= FRAME) {
			const block = carry.splice(0, FRAME)
			let sum = 0
			for (const sample of block) sum += sample * sample
			all.push(Math.sqrt(sum / block.length))
		}
	})
	console.log(`recording ${seconds}s — speak normally, then pause, then speak softly...`)
	await coordinator.start({})
	console.log(`started; provider frames so far = ${provider.counters.frames}`)
	await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1000))
	const stopped = await coordinator.stop()
	await new Promise((resolve) => setTimeout(resolve, 250))
	await coordinator.dispose()

	console.log("")
	console.log("--- 100 ms frame RMS in PCM16 units (0..32767) ---")
	console.log(`stop counters : frames=${stopped.framesReceived} bytes=${stopped.bytesReceived}`)
	console.log(`listener saw  : ${seen} frames`)
	console.log(`frames        : ${all.length}`)
	if (all.length > 0) {
		// Print the trajectory, so silence gaps and speech bursts are visible.
		const buckets = 30
		const step = Math.max(1, Math.ceil(all.length / buckets))
		const line: string[] = []
		for (let i = 0; i < all.length; i += step) {
			const chunk = all.slice(i, i + step)
			const level = Math.round(Math.max(...chunk))
			line.push(String(level).padStart(4))
		}
		console.log(`trajectory (max per ${step} frames): ${line.join("")}`)
		const gate = SILENCE_RMS_THRESHOLD_NORMALISED * 32768
		const above = all.filter((value) => value >= gate).length
		console.log(`gate=${Math.round(gate)} → ${above}/${all.length} frames above`)
		// Longest run below the gate: what the detector's silence timer sees.
		let longest = 0
		let run = 0
		for (const value of all) {
			if (value >= gate) run = 0
			else {
				run += 1
				longest = Math.max(longest, run)
			}
		}
		console.log(`longest below-gate run: ${longest} frames (${longest * 100} ms)`)
	}
	console.log(`min           : ${Math.round(percentile(all, 0))}`)
	console.log(`p10           : ${Math.round(percentile(all, 10))}`)
	console.log(`p25           : ${Math.round(percentile(all, 25))}`)
	console.log(`median        : ${Math.round(percentile(all, 50))}`)
	console.log(`p75           : ${Math.round(percentile(all, 75))}`)
	console.log(`p90           : ${Math.round(percentile(all, 90))}`)
	console.log(`p99           : ${Math.round(percentile(all, 99))}`)
	console.log(`max           : ${Math.round(percentile(all, 100))}`)
	console.log("")
	console.log("--- current thresholds ---")
	console.log(
		`SilenceDetector gate : ${SILENCE_RMS_THRESHOLD_NORMALISED} normalised = ${Math.round(SILENCE_RMS_THRESHOLD_NORMALISED * 32768)} PCM16`,
	)
	console.log(`speechGuard floor    : ${SPEECH_RMS_FLOOR} PCM16`)
	const aboveDetector = all.filter((value) => value >= SILENCE_RMS_THRESHOLD_NORMALISED * 32768).length
	const aboveGuard = all.filter((value) => value >= SPEECH_RMS_FLOOR).length
	console.log(
		`frames above detector gate: ${aboveDetector}/${all.length} (${((aboveDetector / Math.max(1, all.length)) * 100).toFixed(1)}%)`,
	)
	console.log(
		`frames above guard floor  : ${aboveGuard}/${all.length} (${((aboveGuard / Math.max(1, all.length)) * 100).toFixed(1)}%)`,
	)
}

void main().catch((error) => {
	console.error("levels failed:", error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
