import * as fs from "node:fs"
import * as path from "node:path"
import { VoiceError } from "../../types"
import { type VerifyResult, verifyFileSet } from "./integrity"
import {
	isWhisperPlatformSupported,
	PINNED_CPU_BACKENDS,
	PINNED_WHISPER_BINARY,
	type PinnedBinaryFile,
	WHISPER_ENGINE_DIR_ENV,
} from "./modelCatalog"

/**
 * Locates and verifies the pinned `whisper-cli.exe` (F2, §13.2 F2-f).
 *
 * Deliberately separate from `capture/binaryLocator.ts`: that one resolves the F1
 * native microphone helper under `assets/voice/bin/`, this one resolves the
 * recogniser under a model/engine data directory. They have different owners,
 * different lifetimes and different failure codes.
 *
 * Resolution order:
 *   1. `BYTOS_WHISPER_ENGINE_DIR` (explicit override, used by tests and dev);
 *   2. `<storageRoot>/voice/whisper`;
 *   3. `<extensionRoot>/assets/voice/whisper` (a future bundled build).
 *
 * Within a root the executable lives at `<root>/<subdir>/_release/whisper-cli.exe>`
 * (as unpacked by the pinned archive) or directly at `<root>/<subdir>/`. Both
 * layouts are accepted, but nothing is returned until every pinned file verifies.
 */

export interface LocateWhisperBinaryOptions {
	/** Extension root, used for the bundled candidate. */
	extensionRoot?: string
	/** Per-user storage root (`context.globalStorageUri.fsPath`). */
	storageRoot?: string
	platform?: string
	arch?: string
	/** Injectable for tests. */
	env?: NodeJS.ProcessEnv
}

export interface VerifiedBinary {
	ok: boolean
	/** Absolute path to the executable, present only when `ok`. */
	executablePath?: string
	/** Directory holding the executable and its DLLs. */
	engineDir?: string
	/** Which root matched. */
	root?: string
	failures: VerifyResult[]
	detail?: string
}

/** Candidate engine roots, in resolution order (absolute, deduplicated). */
export function whisperEngineRoots(options: LocateWhisperBinaryOptions = {}): string[] {
	const roots: string[] = []
	const env = options.env ?? process.env
	const override = env[WHISPER_ENGINE_DIR_ENV]
	if (override && override.trim().length > 0) {
		roots.push(path.resolve(override))
	}
	if (options.storageRoot) {
		// A caller that hands over an engine root directly gets it tried as-is, in
		// addition to the conventional `<storage>/voice/whisper` location.
		roots.push(path.resolve(options.storageRoot))
		roots.push(path.join(options.storageRoot, "voice", "whisper"))
	}
	if (options.extensionRoot) {
		roots.push(path.join(options.extensionRoot, "assets", "voice", "whisper"))
		// Development tree: F2 downloaded the pinned engine and models into
		// `test-assets/voice-f2/` (excluded from packaging). Accepting it here lets
		// a developer build exercise the real engine without moving 240 MB by
		// hand, and an installed build simply never has that folder.
		roots.push(path.join(options.extensionRoot, "test-assets", "voice-f2", "whisper"))
	}
	return [...new Set(roots)]
}

/** Directories that could contain the executable, for one root. */
export function engineDirCandidates(root: string): string[] {
	const pinnedDir = path.join(root, PINNED_WHISPER_BINARY.subdir)
	return [path.join(pinnedDir, "Release"), pinnedDir, root]
}

/** Every file that must verify for the engine to be trusted. */
export function requiredBinaryFiles(): readonly PinnedBinaryFile[] {
	return [...PINNED_WHISPER_BINARY.files, ...PINNED_CPU_BACKENDS]
}

function isPlatformSupported(platform: string, arch: string): boolean {
	return isWhisperPlatformSupported(platform, arch)
}

/**
 * Resolves and verifies the engine. Never throws; a missing or tampered engine is
 * reported as `ok: false` with a typed detail so the caller can surface an honest
 * "voice is unavailable" state instead of a crash.
 */
export async function locateVerifiedWhisperBinary(options: LocateWhisperBinaryOptions = {}): Promise<VerifiedBinary> {
	const platform = options.platform ?? process.platform
	const arch = options.arch ?? process.arch
	if (!isPlatformSupported(platform, arch)) {
		return {
			ok: false,
			failures: [],
			detail: `whisper-cli is available for ${PINNED_WHISPER_BINARY.subdir} windows x64 only; ${platform}/${arch} is not supported`,
		}
	}

	const required = requiredBinaryFiles()
	for (const root of whisperEngineRoots(options)) {
		for (const engineDir of engineDirCandidates(root)) {
			const executablePath = path.join(engineDir, PINNED_WHISPER_BINARY.executable)
			if (!fs.existsSync(executablePath)) continue
			const { ok, results } = await verifyFileSet(engineDir, required)
			if (ok) {
				return { ok: true, executablePath, engineDir, root, failures: [] }
			}
			const firstBad = results.find((result) => !result.ok)
			return {
				ok: false,
				engineDir,
				root,
				failures: results.filter((result) => !result.ok),
				detail: firstBad?.detail ?? "whisper engine failed integrity verification",
			}
		}
	}
	return {
		ok: false,
		failures: [],
		detail: "The whisper engine is not installed on this machine.",
	}
}

/** Throwing variant for call sites that must fail fast with a typed code. */
export async function requireVerifiedWhisperBinary(
	options: LocateWhisperBinaryOptions = {},
): Promise<{ executablePath: string; engineDir: string }> {
	const result = await locateVerifiedWhisperBinary(options)
	if (result.ok && result.executablePath && result.engineDir) {
		return { executablePath: result.executablePath, engineDir: result.engineDir }
	}
	const platform = options.platform ?? process.platform
	const arch = options.arch ?? process.arch
	if (!isPlatformSupported(platform, arch)) {
		throw new VoiceError("WHISPER_BINARY_UNSUPPORTED_PLATFORM", result.detail)
	}
	if (result.failures.length > 0) {
		throw new VoiceError("WHISPER_BINARY_INTEGRITY_FAILED", result.detail)
	}
	throw new VoiceError("WHISPER_BINARY_MISSING", result.detail)
}
