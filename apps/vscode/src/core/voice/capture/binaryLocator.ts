import fs from "fs"
import path from "path"
import { VoiceError } from "../types"

/**
 * Locates the F1 Windows capture helper:
 *   <extensionRoot>/assets/voice/bin/<platform>-<arch>/bv-os-audio-helper[.exe]
 * plus the `app.asar.unpacked` variant, mirroring how the extension resolves
 * other packaged binaries.
 *
 * This is NOT the whisper binary locator (F2 owns that). It resolves one
 * artifact for one platform, and reports CAPTURE_HELPER_MISSING everywhere else
 * rather than guessing.
 */

const HELPER_BASENAME = "bv-os-audio-helper"

export function helperRelativePath(platform: string, arch: string): string {
	const executable = platform === "win32" ? `${HELPER_BASENAME}.exe` : HELPER_BASENAME
	return path.join("assets", "voice", "bin", `${platform}-${arch}`, executable)
}

/**
 * Candidate absolute paths, in resolution order. Exported for tests so the
 * ordering contract is asserted rather than assumed.
 */
export function helperCandidates(extensionRoot: string, platform: string, arch: string): string[] {
	const relative = helperRelativePath(platform, arch)
	const direct = path.join(extensionRoot, relative)
	const candidates = [direct]
	// A packaged extension keeps `assets/**` outside the asar archive.
	const unpackedRoot = extensionRoot.includes("app.asar")
		? extensionRoot.replace(/app\.asar(?=$|[\\/])/, "app.asar.unpacked")
		: path.join(extensionRoot, "app.asar.unpacked")
	const unpacked = path.join(unpackedRoot, relative)
	if (unpacked !== direct) {
		candidates.push(unpacked)
	}
	return candidates
}

export interface LocateHelperOptions {
	extensionRoot: string
	platform?: string
	arch?: string
	/** Injectable for tests. */
	exists?: (candidate: string) => boolean
}

/** Returns the helper's absolute path, or throws `CAPTURE_HELPER_MISSING`. */
export function locateAudioHelper(options: LocateHelperOptions): string {
	const platform = options.platform ?? process.platform
	const arch = options.arch ?? process.arch
	const exists = options.exists ?? ((candidate: string) => fs.existsSync(candidate))
	for (const candidate of helperCandidates(options.extensionRoot, platform, arch)) {
		if (exists(candidate)) {
			return candidate
		}
	}
	throw new VoiceError("CAPTURE_HELPER_MISSING", `No voice capture helper for ${platform}-${arch}`)
}

/** Non-throwing probe used by capability detection. */
export function tryLocateAudioHelper(options: LocateHelperOptions): string | undefined {
	try {
		return locateAudioHelper(options)
	} catch {
		return undefined
	}
}
