import * as path from "node:path"
import { helperCandidates, helperRelativePath, locateAudioHelper, tryLocateAudioHelper } from "@core/voice/capture/binaryLocator"
import { VoiceError } from "@core/voice/types"
import { describe, expect, it } from "vitest"

const ROOT = path.join(path.sep === "\\" ? "C:\\ext" : "/ext")

describe("helperRelativePath", () => {
	it("uses .exe on win32 and a bare name elsewhere", () => {
		expect(helperRelativePath("win32", "x64")).toBe(
			path.join("assets", "voice", "bin", "win32-x64", "bv-os-audio-helper.exe"),
		)
		expect(helperRelativePath("linux", "x64")).toBe(path.join("assets", "voice", "bin", "linux-x64", "bv-os-audio-helper"))
	})

	it("is platform-arch specific", () => {
		expect(helperRelativePath("win32", "arm64")).toContain("win32-arm64")
	})
})

describe("helperCandidates", () => {
	it("tries the plain path first, then the asar.unpacked variant", () => {
		const candidates = helperCandidates(ROOT, "win32", "x64")
		expect(candidates[0]).toBe(path.join(ROOT, helperRelativePath("win32", "x64")))
		expect(candidates[1]).toContain("app.asar.unpacked")
	})

	it("rewrites an app.asar extension root for the unpacked candidate", () => {
		const asarRoot = path.join(ROOT, "app.asar")
		const candidates = helperCandidates(asarRoot, "win32", "x64")
		expect(candidates[1]).toContain("app.asar.unpacked")
	})
})

describe("locateAudioHelper", () => {
	it("returns the first candidate that exists", () => {
		const found = locateAudioHelper({ extensionRoot: ROOT, platform: "win32", arch: "x64", exists: () => true })
		expect(found).toBe(path.join(ROOT, helperRelativePath("win32", "x64")))
	})

	it("falls through to the asar.unpacked variant", () => {
		const expected = helperCandidates(ROOT, "win32", "x64")[1]
		const found = locateAudioHelper({
			extensionRoot: ROOT,
			platform: "win32",
			arch: "x64",
			exists: (candidate) => candidate === expected,
		})
		expect(found).toBe(expected)
	})

	it("throws CAPTURE_HELPER_MISSING when nothing exists", () => {
		expect(() =>
			locateAudioHelper({ extensionRoot: ROOT, platform: "win32", arch: "x64", exists: () => false }),
		).toThrowError(VoiceError)
		try {
			locateAudioHelper({ extensionRoot: ROOT, platform: "darwin", arch: "arm64", exists: () => false })
		} catch (error) {
			expect((error as VoiceError).code).toBe("CAPTURE_HELPER_MISSING")
		}
	})

	it("tryLocateAudioHelper returns undefined instead of throwing", () => {
		expect(tryLocateAudioHelper({ extensionRoot: ROOT, platform: "linux", arch: "x64", exists: () => false })).toBeUndefined()
	})
})
