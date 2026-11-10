import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { VoiceError } from "../../types"
import { sha256File } from "../models/integrity"
import {
	DEFAULT_MODEL_ID,
	formatBytes,
	getModelPin,
	isKnownModelId,
	isWhisperPlatformSupported,
	listModels,
	PINNED_CPU_BACKENDS,
	PINNED_MODELS,
	PINNED_WHISPER_BINARY,
} from "../models/modelCatalog"

/**
 * Asset locations. The real binary and models live under `test-assets/`, which is
 * excluded from any packaged build; `apps/vscode` is the vitest cwd.
 */
const ASSETS = path.resolve(process.cwd(), "test-assets", "voice-f2")
const MODEL_DIR = path.join(ASSETS, "models")
const ENGINE_DIR = path.join(ASSETS, "whisper", PINNED_WHISPER_BINARY.subdir)
const assetsPresent = fs.existsSync(MODEL_DIR) && fs.existsSync(ENGINE_DIR)

describe("model catalog", () => {
	it("pins tiny and base with real, distinct hashes", () => {
		expect(Object.keys(PINNED_MODELS).sort()).toEqual(["base", "tiny"])
		const hashes = Object.values(PINNED_MODELS).map((model) => model.sha256)
		expect(new Set(hashes).size).toBe(2)
		for (const hash of hashes) {
			expect(hash).toMatch(/^[0-9a-f]{64}$/)
		}
	})

	it("pins sizes that match the upstream model bytes", () => {
		// Measured: 77 691 713 B (74.1 MiB) and 147 951 465 B (141.1 MiB).
		expect(PINNED_MODELS.tiny.sizeBytes).toBe(77691713)
		expect(PINNED_MODELS.base.sizeBytes).toBe(147951465)
	})

	it("only offers multilingual models", () => {
		// `.en` variants cannot transcribe Turkish or German, so they must not be
		// offered at all.
		for (const model of listModels()) {
			expect(model.multilingual).toBe(true)
			expect(model.fileName).not.toMatch(/\.en\.bin$/)
		}
	})

	it("serves every model over HTTPS", () => {
		for (const model of listModels()) {
			expect(model.url.startsWith("https://")).toBe(true)
		}
	})

	it("defaults to base, the model that handled all three languages", () => {
		expect(DEFAULT_MODEL_ID).toBe("base")
		expect(getModelPin(DEFAULT_MODEL_ID).id).toBe("base")
	})

	it("lists models cheapest first", () => {
		const sizes = listModels().map((model) => model.sizeBytes)
		expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
	})

	it("rejects an unknown model id with a typed error", () => {
		expect(isKnownModelId("medium")).toBe(false)
		expect(isKnownModelId(undefined)).toBe(false)
		expect(() => getModelPin("large-v3")).toThrow(VoiceError)
		expect(() => getModelPin("large-v3")).toThrowError(expect.objectContaining({ code: "MODEL_UNKNOWN" }))
	})

	it("formats sizes for the consent prompt", () => {
		expect(formatBytes(PINNED_MODELS.base.sizeBytes)).toBe("141.1 MiB")
		expect(formatBytes(PINNED_MODELS.tiny.sizeBytes)).toBe("74.1 MiB")
		expect(formatBytes(Number.NaN)).toBe("unknown")
	})
})

describe("whisper platform support", () => {
	it("supports Windows x64 only", () => {
		expect(isWhisperPlatformSupported("win32", "x64")).toBe(true)
	})

	it.each([
		["win32", "arm64"],
		["darwin", "x64"],
		["darwin", "arm64"],
		["linux", "x64"],
	])("does not claim %s/%s", (platform, arch) => {
		expect(isWhisperPlatformSupported(platform, arch)).toBe(false)
	})
})

describe("pinned binary table", () => {
	it("pins an executable and its full DLL closure", () => {
		const names = PINNED_WHISPER_BINARY.files.map((file) => file.fileName)
		expect(names).toContain("whisper-cli.exe")
		expect(names).toContain("whisper.dll")
		expect(names).toContain("ggml.dll")
		expect(names).toContain("ggml-base.dll")
	})

	it("pins a CPU backend variant for every ggml build in the archive", () => {
		expect(PINNED_CPU_BACKENDS.length).toBe(9)
		expect(PINNED_CPU_BACKENDS.map((file) => file.fileName)).toContain("ggml-cpu-cascadelake.dll")
	})

	it("declares an upstream licence and project", () => {
		expect(PINNED_WHISPER_BINARY.license).toBe("MIT")
		expect(PINNED_WHISPER_BINARY.projectUrl).toContain("whisper.cpp")
	})
})

/**
 * These run only when the real assets are present. They are the tests that prove
 * the pins were computed from real bytes rather than invented.
 */
describe.skipIf(!assetsPresent)("pinned hashes match the real artifacts", () => {
	it.each(Object.values(PINNED_MODELS))("model $id matches its pinned size and hash", async (model) => {
		const file = path.join(MODEL_DIR, model.fileName)
		expect(fs.statSync(file).size).toBe(model.sizeBytes)
		expect(await sha256File(file)).toBe(model.sha256)
	})

	it.each([
		...PINNED_WHISPER_BINARY.files,
		...PINNED_CPU_BACKENDS,
	])("engine file $fileName matches its pinned size and hash", async (file) => {
		const full = path.join(ENGINE_DIR, file.fileName)
		expect(fs.statSync(full).size).toBe(file.sizeBytes)
		expect(await sha256File(full)).toBe(file.sha256)
	})
})
