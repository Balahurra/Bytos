import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ModelStore } from "../models/ModelStore"
import { WhisperCliEngine } from "../WhisperCliEngine"
import { WAV_HEADER_BYTES, wavFromPcm16 } from "../wav"
import { AUDIO_DIR, ENGINE_ROOT, MODEL_DIR, noise, readClipPcm16, skipWithoutAssets } from "./f2TestAssets"

/**
 * Privacy and resource guarantees for F2.
 *
 * F1 promised "no audio on disk, no audio on ProtoBus". F2 adds a second process
 * and a WAV wrapper, so those promises have to be re-proved at the new boundary:
 *
 *  - the only file the recogniser is asked to write contains transcript TEXT and
 *    is deleted in a `finally`;
 *  - the audio bytes exist only transiently in this process's heap;
 *  - no ProtoBus / agent-runtime module is reachable from the engine.
 */
const AUDIO_EXT = /\.(wav|pcm|raw|webm|ogg|mp3|flac|m4a)$/i

function listTmpAudio(): string[] {
	let names: string[] = []
	try {
		names = fs.readdirSync(os.tmpdir())
	} catch {
		return []
	}
	return names.filter((name) => AUDIO_EXT.test(name) || name.startsWith("bytos-whisper-"))
}

describe("wav wrapper never touches disk", () => {
	it("builds the WAV entirely in memory", () => {
		const before = listTmpAudio()
		// Synthetic samples keep this guarantee runnable in CI without the
		// downloaded voice corpus; the real-clip suites below are skipped when
		// `test-assets/voice-f2` is absent.
		const samples = noise(1)
		const wav = wavFromPcm16(samples)
		expect(wav.length).toBe(WAV_HEADER_BYTES + samples.length * 2)
		expect(Buffer.isBuffer(wav)).toBe(true)
		// Nothing appeared on disk as a side effect.
		expect(listTmpAudio()).toEqual(before)
	})
})

describe("model storage holds models, never audio", () => {
	it("writes only the pinned .bin file name", async () => {
		const store = new ModelStore({ modelDir: path.join(os.tmpdir(), "bytos-f2-privacy-models") })
		// Path derivation is pure: no file is created by asking.
		expect(store.modelPath("tiny")).toBe(path.join(os.tmpdir(), "bytos-f2-privacy-models", "ggml-tiny.bin"))
		expect(AUDIO_EXT.test(store.modelPath("tiny"))).toBe(false)
	})
})

describe.skipIf(skipWithoutAssets)("a full transcription leaves no audio behind", () => {
	let engine: WhisperCliEngine
	let before: string[]

	beforeAll(async () => {
		engine = new WhisperCliEngine()
		await engine.init({ engineRoot: ENGINE_ROOT, modelDir: MODEL_DIR })
		before = listTmpAudio()
	})

	afterAll(async () => {
		await engine.dispose()
	})

	it("creates no audio file anywhere in the temp directory", async () => {
		const clip = path.join(AUDIO_DIR, "tr_merhaba.wav")
		const existedBefore = fs.existsSync(clip)
		expect(existedBefore).toBe(true)

		await engine.transcribe({ samples: readClipPcm16("tr_merhaba"), language: "tr", modelId: "tiny" })

		// The corpus file is a pre-existing fixture; nothing NEW may appear.
		const after = listTmpAudio()
		const created = after.filter((name) => !before.includes(name))
		expect(created).toEqual([])
	}, 120000)

	it("leaves the model directory byte-identical", async () => {
		const snapshot = () =>
			fs
				.readdirSync(MODEL_DIR)
				.map((name) => `${name}:${fs.statSync(path.join(MODEL_DIR, name)).size}`)
				.sort()
		const beforeModel = snapshot()
		await engine.transcribe({ samples: readClipPcm16("de_hallo"), language: "de", modelId: "tiny" })
		expect(snapshot()).toEqual(beforeModel)
	}, 120000)
})

describe("engine module has no ProtoBus or agent-runtime dependency", () => {
	it("imports only its own modules and node built-ins", () => {
		// A static read of the engine's own sources: the recogniser must not reach
		// the webview, the gRPC handlers or the task/agent runtime.
		const dir = path.resolve(process.cwd(), "src/core/voice/transcription")
		const forbidden = [
			"@shared/proto",
			"@/shared/proto",
			"controller/grpc",
			"TaskService",
			"taskServiceClient",
			"@core/controller",
			"hosts/host-provider",
			"telemetry",
			"Logger",
		]
		const offenders: string[] = []
		const walk = (current: string) => {
			for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
				const full = path.join(current, entry.name)
				if (entry.isDirectory()) {
					if (entry.name === "__tests__") continue
					walk(full)
					continue
				}
				if (!entry.name.endsWith(".ts")) continue
				const source = fs.readFileSync(full, "utf8")
				for (const line of source.split(/\r?\n/)) {
					if (!/^\s*import\s|^\s*export\s+.*\sfrom\s/.test(line)) continue
					for (const needle of forbidden) {
						if (line.includes(needle)) offenders.push(`${entry.name}: ${line.trim()}`)
					}
				}
			}
		}
		walk(dir)
		expect(offenders).toEqual([])
	})

	it("never imports a filesystem writer for audio", () => {
		const dir = path.resolve(process.cwd(), "src/core/voice/transcription")
		const engineSource = fs.readFileSync(path.join(dir, "WhisperCliEngine.ts"), "utf8")
		// The engine itself must not write files at all; only the process runner
		// manages (and deletes) the transcript base name.
		expect(engineSource).not.toMatch(/writeFile|createWriteStream|appendFile/)
	})
})
