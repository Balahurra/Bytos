import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { PINNED_CPU_BACKENDS, PINNED_WHISPER_BINARY, WHISPER_ENGINE_DIR_ENV } from "../models/modelCatalog"
import {
	engineDirCandidates,
	locateVerifiedWhisperBinary,
	requiredBinaryFiles,
	requireVerifiedWhisperBinary,
	whisperEngineRoots,
} from "../models/whisperBinaryLocator"

/**
 * Locator behaviour for the pinned engine.
 *
 * The real engine assets are copied into a scratch directory per test so the
 * success path verifies real bytes, and so a test can then corrupt exactly one
 * file and observe the refusal.
 */
const ASSETS = path.resolve(process.cwd(), "test-assets", "voice-f2")
const REAL_ENGINE = path.join(ASSETS, "whisper", PINNED_WHISPER_BINARY.subdir)
const realEnginePresent = fs.existsSync(path.join(REAL_ENGINE, PINNED_WHISPER_BINARY.executable))
const BUNDLED_ENGINE = path.resolve(process.cwd(), "assets", "voice", "whisper", PINNED_WHISPER_BINARY.subdir)
const bundledEnginePresent = fs.existsSync(path.join(BUNDLED_ENGINE, PINNED_WHISPER_BINARY.executable))

let scratch: string

beforeAll(() => {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), "bytos-f2-engine-"))
})

afterAll(() => {
	fs.rmSync(scratch, { recursive: true, force: true })
})

/** Copies the real engine into a fresh root, using the flat `<root>/b5454/` layout. */
function stageEngine(rootName: string): string {
	const root = path.join(scratch, rootName)
	const dir = path.join(root, PINNED_WHISPER_BINARY.subdir)
	fs.mkdirSync(dir, { recursive: true })
	for (const file of requiredBinaryFiles()) {
		fs.copyFileSync(path.join(REAL_ENGINE, file.fileName), path.join(dir, file.fileName))
	}
	return root
}

/** Search options that point ONLY at this root, ignoring the host's env override. */
function onlyRoot(root: string) {
	return { platform: "win32", arch: "x64", storageRoot: root, env: {} as NodeJS.ProcessEnv }
}

describe("engine directory resolution", () => {
	it("orders roots: env override, then the given root, its voice/whisper child, then bundled", () => {
		const roots = whisperEngineRoots({
			env: { [WHISPER_ENGINE_DIR_ENV]: "C:\\override" },
			storageRoot: "C:\\storage",
			extensionRoot: "C:\\ext",
		})
		expect(roots).toEqual([
			"C:\\override",
			path.resolve("C:\\storage"),
			path.join("C:\\storage", "voice", "whisper"),
			path.join("C:\\ext", "assets", "voice", "whisper"),
			// F3: the development tree's F2 download location, tried last so an
			// installed build (which has no `test-assets/`) is unaffected.
			path.join("C:\\ext", "test-assets", "voice-f2", "whisper"),
		])
	})

	it("ignores an empty env override", () => {
		const roots = whisperEngineRoots({ env: { [WHISPER_ENGINE_DIR_ENV]: "  " }, storageRoot: "C:\\storage" })
		expect(roots).toEqual([path.resolve("C:\\storage"), path.join("C:\\storage", "voice", "whisper")])
	})

	it("accepts both the Release/ and flat unpacked layouts", () => {
		const candidates = engineDirCandidates("C:\\root")
		expect(candidates[0]).toBe(path.join("C:\\root", "b5454", "Release"))
		expect(candidates[1]).toBe(path.join("C:\\root", "b5454"))
	})

	it("requires the executable plus every DLL in the pin table", () => {
		const names = requiredBinaryFiles().map((file) => file.fileName)
		expect(names).toContain("whisper-cli.exe")
		expect(names).toContain("ggml-cpu-cascadelake.dll")
		expect(names.length).toBe(PINNED_WHISPER_BINARY.files.length + PINNED_CPU_BACKENDS.length)
	})
})

describe("unsupported platforms", () => {
	it.each([
		["darwin", "arm64"],
		["linux", "x64"],
		["win32", "arm64"],
	])("refuses %s/%s", async (platform, arch) => {
		const result = await locateVerifiedWhisperBinary({ platform, arch, storageRoot: scratch })
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("only")

		await expect(requireVerifiedWhisperBinary({ platform, arch, storageRoot: scratch })).rejects.toThrowError(
			expect.objectContaining({ code: "WHISPER_BINARY_UNSUPPORTED_PLATFORM" }),
		)
	})
})

describe("missing engine", () => {
	it("reports a missing binary with a typed error", async () => {
		const empty = path.join(scratch, "empty-root")
		fs.mkdirSync(empty, { recursive: true })
		const result = await locateVerifiedWhisperBinary(onlyRoot(empty))
		expect(result.ok).toBe(false)
		expect(result.failures).toHaveLength(0)

		await expect(requireVerifiedWhisperBinary(onlyRoot(empty))).rejects.toThrowError(
			expect.objectContaining({ code: "WHISPER_BINARY_MISSING" }),
		)
	})
})

describe.skipIf(!bundledEnginePresent)("bundled engine", () => {
	it("finds the engine shipped under <extensionRoot>/assets/voice/whisper", async () => {
		// This is the path an installed VSIX uses. The engine root passed by the
		// runtime is the extension root, not global storage.
		const result = await locateVerifiedWhisperBinary({
			platform: "win32",
			arch: "x64",
			extensionRoot: process.cwd(),
			env: {} as NodeJS.ProcessEnv,
		})
		expect(result.ok).toBe(true)
		expect(result.executablePath).toBe(path.join(BUNDLED_ENGINE, PINNED_WHISPER_BINARY.executable))
	})
})

describe.skipIf(!realEnginePresent)("integrity of the real engine", () => {
	it("accepts an untampered engine", async () => {
		const root = stageEngine("good")
		const result = await locateVerifiedWhisperBinary(onlyRoot(root))
		expect(result.ok).toBe(true)
		expect(result.executablePath).toBe(path.join(root, "b5454", "whisper-cli.exe"))
	})

	it("refuses when the executable is tampered with", async () => {
		const root = stageEngine("tampered-exe")
		const exe = path.join(root, "b5454", "whisper-cli.exe")
		const bytes = fs.readFileSync(exe)
		// Flip the last byte: same size, different hash.
		bytes[bytes.length - 1] ^= 0xff
		fs.writeFileSync(exe, bytes)

		const result = await locateVerifiedWhisperBinary(onlyRoot(root))
		expect(result.ok).toBe(false)
		expect(result.failures.length).toBeGreaterThan(0)

		await expect(requireVerifiedWhisperBinary(onlyRoot(root))).rejects.toThrowError(
			expect.objectContaining({ code: "WHISPER_BINARY_INTEGRITY_FAILED" }),
		)
	})

	it("refuses when a supporting DLL is replaced", async () => {
		// The point of hashing the DLL closure: a swapped whisper.dll must
		// disqualify an otherwise-untouched whisper-cli.exe.
		const root = stageEngine("tampered-dll")
		const dll = path.join(root, "b5454", "whisper.dll")
		const bytes = fs.readFileSync(dll)
		bytes[64] ^= 0xff
		fs.writeFileSync(dll, bytes)

		const result = await locateVerifiedWhisperBinary(onlyRoot(root))
		expect(result.ok).toBe(false)
		expect(result.failures.map((failure) => failure.path)).toContain(dll)
	})

	it("refuses when a CPU backend DLL is missing", async () => {
		const root = stageEngine("missing-backend")
		fs.rmSync(path.join(root, "b5454", "ggml-cpu-cascadelake.dll"))
		const result = await locateVerifiedWhisperBinary(onlyRoot(root))
		expect(result.ok).toBe(false)
		expect(result.failures.some((failure) => failure.failure === "MODEL_FILE_MISSING")).toBe(true)
	})

	it("refuses a zero-byte placeholder executable", async () => {
		const root = path.join(scratch, "placeholder")
		const dir = path.join(root, "b5454")
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(path.join(dir, "whisper-cli.exe"), Buffer.alloc(0))

		const result = await locateVerifiedWhisperBinary(onlyRoot(root))
		expect(result.ok).toBe(false)
		expect(result.failures.some((failure) => failure.failure === "MODEL_SIZE_MISMATCH")).toBe(true)
	})
})
