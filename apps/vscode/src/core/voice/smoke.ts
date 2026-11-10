import * as fs from "node:fs"
import * as path from "node:path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { Logger } from "@/shared/services/Logger"

/**
 * Developer-facing Voice F1 smoke driver.
 *
 * F1 has no UI (the composer and Settings panels are F4/F3). This driver lets a
 * developer exercise the REAL capture path inside a REAL VS Code extension host
 * without a webview: it builds the same `VoiceRuntime` the handlers use, over the
 * same native helper, and calls the same start/stop/cancel methods.
 *
 * Privacy: this module never reads, prints, logs or writes audio samples. It
 * reports counters only (frames, bytes, duration) and checks which files appeared
 * around a capture. Audio itself stays inside `core/voice/VoiceRuntime`.
 *
 * Host access goes through `HostProvider` (the project's abstraction layer), not
 * raw `vscode` APIs.
 */

const OUTPUT_PREFIX = "[Bytos Voice F1]"
const AUDIO_EXTENSIONS = new Set([".wav", ".pcm", ".raw", ".webm", ".ogg", ".mp3", ".flac", ".m4a"])

/** Writes one counter/status line to the extension log (never audio). */
export function logVoiceSmoke(line: string): void {
	Logger.info(`${OUTPUT_PREFIX} ${line}`)
}

/** File names under the directories a leak would show up in. */
export function snapshotDirs(roots: string[]): Set<string> {
	const names = new Set<string>()
	const walk = (dir: string, depth: number) => {
		if (depth > 3) return
		let entries: fs.Dirent[]
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name)
			names.add(full)
			if (entry.isDirectory()) walk(full, depth + 1)
		}
	}
	for (const root of roots) walk(root, 0)
	return names
}

export function newFileReport(before: Set<string>, after: Set<string>): { total: number; audio: string[] } {
	const created: string[] = []
	for (const entry of after) {
		if (before.has(entry)) continue
		try {
			if (fs.statSync(entry).isFile()) created.push(entry)
		} catch {
			// vanished between scan and stat
		}
	}
	return {
		total: created.length,
		audio: created.filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase())),
	}
}

/** Builds a runtime over the real helper (no webview, no ProtoBus). */
export async function createSmokeRuntime(extensionRoot: string) {
	const voice = await import("@core/voice")
	const { VoiceSessionRegistry } = await import("@core/voice/VoiceSessionRegistry")
	const capability = voice.resolveVoiceCapability({
		extensionRoot,
		deviceCount: 1,
		permission: "granted",
		recorderIsolationVerified: true,
		voiceEnabled: true,
	})
	const providers: import("./capture/AudioCaptureProvider").AudioCaptureProvider[] = []
	if (capability.helperPath) {
		providers.push(new voice.WasapiCaptureProvider({ helperPath: capability.helperPath }))
	}
	const coordinator = new voice.AudioCaptureCoordinator({ providers, captureMethod: "auto" })
	const runtime = new voice.VoiceRuntime(capability, coordinator, {
		silenceTimeoutMs: 1200,
		maxDurationMs: 120000,
	})
	return { voice, VoiceSessionRegistry, capability, coordinator, runtime }
}

/** Shows the smoke result in the host's notification UI (counters only). */
export async function notifySmokeResult(summary: string): Promise<void> {
	await HostProvider.window.showMessage({ type: ShowMessageType.INFORMATION, message: summary })
}
