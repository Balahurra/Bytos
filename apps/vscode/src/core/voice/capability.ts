import { tryLocateAudioHelper } from "./capture/binaryLocator"
import type { CaptureBackend, CapturePermission, VoiceCapability, VoiceUnavailableReason } from "./types"

/**
 * Platform and runtime capability detection (T2, TD-18).
 *
 * Produces ONE host-owned `VoiceCapability` object — the only thing any consumer
 * reads. Honesty rules baked in here:
 *  - only Windows x64 local VS Code can capture in F1;
 *  - remote / WSL / container / Codespaces and VS Code Web report
 *    `canCapture: false` with a specific reason, because the extension host runs
 *    on the far machine and has no guaranteed access to the user's microphone;
 *  - macOS, Linux and win32-arm64 report `PLATFORM_NOT_SUPPORTED_IN_F1` — no
 *    support is claimed for a platform F1 did not verify.
 */

export interface CapabilityInputs {
	platform: NodeJS.Platform | string
	arch: string
	/** `vscode.env.remoteName` (set for SSH/WSL/container/tunnel). */
	remoteName?: string
	/** `vscode.env.uiKind === vscode.UIKind.Web`. */
	isWeb?: boolean
	/** Absolute path of the capture helper, or undefined when it is missing. */
	helperPath?: string
	/** Active capture endpoints reported by a probe, when one was run. */
	deviceCount?: number
	permission?: CapturePermission
	/** True once the recorder-isolation gate (T1) is verified in product code. */
	recorderIsolationVerified?: boolean
	/** Persisted `voiceEnabled` setting. */
	voiceEnabled?: boolean
}

const SUPPORTED_PLATFORM = "win32"
const SUPPORTED_ARCH = "x64"

export function detectVoiceCapability(inputs: CapabilityInputs): VoiceCapability {
	const {
		platform,
		arch,
		remoteName,
		isWeb = false,
		helperPath,
		deviceCount = 0,
		permission = "unknown",
		recorderIsolationVerified = true,
		voiceEnabled = true,
	} = inputs

	const base = {
		platform,
		arch,
		remoteName,
		helperPath,
		deviceCount,
		permission,
	}

	const unavailable = (reason: VoiceUnavailableReason, detail: string, osLabel: string): VoiceCapability => ({
		...base,
		canCapture: false,
		backend: "none",
		reason,
		detail,
		osLabel,
	})

	// 1. Remote / web hosts first: the microphone physically belongs to the client.
	if (isWeb) {
		return unavailable(
			"WEB_UI_UNSUPPORTED",
			"Bytos runs in a browser tab; microphone capture needs the local desktop app.",
			describeOs(platform, arch, remoteName),
		)
	}
	if (remoteName) {
		return unavailable(
			"REMOTE_HOST_UNSUPPORTED",
			`Voice is unavailable in a ${remoteName} session: the extension host runs on the remote machine and has no guaranteed access to your local microphone.`,
			describeOs(platform, arch, remoteName),
		)
	}

	// 2. Only the platform F1 actually verified.
	if (platform !== SUPPORTED_PLATFORM || arch !== SUPPORTED_ARCH) {
		return unavailable(
			"PLATFORM_NOT_SUPPORTED_IN_F1",
			`Voice capture is implemented for Windows x64 only. ${platform}/${arch} is not supported in this phase.`,
			describeOs(platform, arch, remoteName),
		)
	}

	// 3. The helper must exist on disk.
	if (!helperPath) {
		return unavailable(
			"CAPTURE_HELPER_MISSING",
			"The Windows audio capture helper is missing from this installation.",
			describeOs(platform, arch, remoteName),
		)
	}

	// 4. The recorder/logging isolation gate must be green before audio may flow.
	if (!recorderIsolationVerified) {
		return unavailable(
			"RECORDER_ISOLATION_UNVERIFIED",
			"Voice capture is held back until recorder isolation is verified.",
			describeOs(platform, arch, remoteName),
		)
	}

	// 5. A microphone must be present (only known once a probe has run).
	if (deviceCount === 0) {
		return unavailable(
			"NO_CAPTURE_DEVICE",
			"No active microphone was found on this machine.",
			describeOs(platform, arch, remoteName),
		)
	}

	const backend: CaptureBackend = "wasapi"
	return {
		...base,
		canCapture: voiceEnabled,
		backend,
		reason: voiceEnabled ? "" : "VOICE_DISABLED",
		detail: voiceEnabled ? "" : "Voice is disabled in settings.",
		osLabel: describeOs(platform, arch, remoteName),
	}
}

export function describeOs(platform: string, arch: string, remoteName?: string): string {
	const names: Record<string, string> = {
		win32: "Windows",
		darwin: "macOS",
		linux: "Linux",
	}
	const name = names[platform] ?? platform
	const suffix = remoteName ? ` (remote: ${remoteName})` : " (local)"
	return `${name} ${arch}${suffix}`
}

/**
 * Convenience wrapper used by the runtime: resolves the helper and returns a
 * capability object. Does not spawn anything.
 */
export function resolveVoiceCapability(options: {
	extensionRoot: string
	platform?: string
	arch?: string
	remoteName?: string
	isWeb?: boolean
	deviceCount?: number
	permission?: CapturePermission
	recorderIsolationVerified?: boolean
	voiceEnabled?: boolean
}): VoiceCapability {
	const platform = options.platform ?? process.platform
	const arch = options.arch ?? process.arch
	const helperPath = tryLocateAudioHelper({ extensionRoot: options.extensionRoot, platform, arch })
	return detectVoiceCapability({
		platform,
		arch,
		remoteName: options.remoteName,
		isWeb: options.isWeb,
		helperPath,
		deviceCount: options.deviceCount,
		permission: options.permission,
		recorderIsolationVerified: options.recorderIsolationVerified,
		voiceEnabled: options.voiceEnabled,
	})
}
