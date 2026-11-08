import { type ChildProcess, spawn } from "node:child_process"
import { type PcmFrame, VOICE_SAMPLE_RATE, VoiceError } from "../types"
import { VoiceSessionRegistry } from "../VoiceSessionRegistry"
import type {
	AudioCaptureProvider,
	CaptureDeviceInfo,
	ProviderProbeResult,
	ProviderStartOptions,
	ProviderStartResult,
	ProviderStopResult,
} from "./AudioCaptureProvider"
import { FrameParser, payloadToInt16 } from "./frameParser"

/**
 * Windows WASAPI capture through the Bytos native helper
 * (`assets/voice/bin/win32-x64/bv-os-audio-helper.exe`).
 *
 * Responsibilities are deliberately narrow: spawn the helper, read control JSON
 * from stdout, decode length-prefixed PCM frames, and hand normalised frames to
 * a listener. It reports what it observed; it does not choose a backend.
 *
 * Audio never leaves memory: frames go to `onFrames` listeners and nowhere else
 * (no file sink, no RPC sink, no logger).
 */

export interface WasapiProviderOptions {
	helperPath: string
	/** Injectable for tests. */
	spawnImpl?: typeof spawn
	/** Extra args appended after the fixed capture args (tests use this to fake a helper). */
	extraArgs?: string[]
}

interface PendingControl {
	resolve: (value: HelperJson) => void
	reject: (error: Error) => void
	timeout: NodeJS.Timeout
	matches: (json: HelperJson) => boolean
}

/** Control JSON the helper prints on stdout. Audio is never part of it. */
export interface HelperJson {
	kind?: string
	code?: string
	backend?: string
	version?: string
	available?: boolean
	deviceCount?: number
	activeDeviceCount?: number
	permission?: string
	devices?: Array<{ id?: string; name?: string; state?: string; isDefault?: boolean }>
	sampleRate?: number
	channels?: number
	frames?: number
	bytes?: number
}

export class WasapiCaptureProvider implements AudioCaptureProvider {
	readonly id = "wasapi"

	private child: ChildProcess | undefined
	private parser: FrameParser | undefined
	private listeners = new Set<(frame: PcmFrame) => void>()
	private stdoutRemainder = ""
	private bannerSeen = false
	private controlQueue: HelperJson[] = []
	private pendingControl: PendingControl | undefined
	private polling: NodeJS.Timeout | undefined
	private capturing = false
	private frames = 0
	private bytes = 0
	private captureStartedAt = 0
	private exitCode: number | null = null
	private stderrTail: string[] = []
	private disposed = false
	private readonly spawnImpl: typeof spawn

	constructor(private readonly options: WasapiProviderOptions) {
		this.spawnImpl = options.spawnImpl ?? spawn
	}

	async isAvailable(): Promise<boolean> {
		return this.options.helperPath.length > 0
	}

	async probe(): Promise<ProviderProbeResult> {
		this.assertNotDisposed()
		const json = await this.runControl(["--probe"])
		return {
			available: json.available === true,
			permission: json.permission === "denied" ? "denied" : json.permission === "granted" ? "granted" : "unknown",
			deviceCount: json.deviceCount ?? 0,
			activeDeviceCount: json.activeDeviceCount ?? 0,
			version: json.version,
			errorCode: json.code,
		}
	}

	async enumerateDevices(): Promise<CaptureDeviceInfo[]> {
		this.assertNotDisposed()
		const json = await this.runControl(["--list-devices"])
		if (json.kind === "error") {
			throw new VoiceError("CAPTURE_ENUMERATION_FAILED")
		}
		return (json.devices ?? []).map((device) => ({
			id: device.id ?? "",
			name: device.name ?? "Unnamed capture device",
			state: normaliseState(device.state),
			isDefault: device.isDefault === true,
		}))
	}

	async startCapture(options: ProviderStartOptions): Promise<ProviderStartResult> {
		this.assertNotDisposed()
		if (this.capturing) {
			throw new VoiceError("CAPTURE_ALREADY_ACTIVE")
		}
		await this.killChild()

		const deviceId = options.deviceId && options.deviceId.length > 0 ? options.deviceId : "default"
		const args = [
			"--capture",
			"--device",
			deviceId,
			"--rate",
			String(VOICE_SAMPLE_RATE),
			"--channels",
			"1",
			...(this.options.extraArgs ?? []),
		]
		const child = this.spawnImpl(this.options.helperPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			// No provider credentials reach the helper process.
			env: scrubHelperEnv(process.env),
		})
		this.child = child
		VoiceSessionRegistry.register(child)

		this.stdoutRemainder = ""
		this.bannerSeen = false
		this.controlQueue = []
		this.frames = 0
		this.bytes = 0
		this.exitCode = null
		this.stderrTail = []
		this.captureStartedAt = Date.now()

		this.parser = new FrameParser({
			onFrame: (decoded) => {
				if (!this.capturing) return
				if (decoded.sampleRate !== VOICE_SAMPLE_RATE || decoded.channels !== 1) {
					// Providers hand the coordinator exactly one contract.
					return
				}
				const samples = payloadToInt16(decoded.payload)
				this.frames++
				this.bytes += decoded.payload.length
				const frame: PcmFrame = {
					samples,
					byteLength: decoded.payload.length,
					sampleRate: decoded.sampleRate,
					channels: decoded.channels,
					timestampMs: Date.now() - this.captureStartedAt,
				}
				for (const listener of this.listeners) {
					try {
						listener(frame)
					} catch {
						this.listeners.delete(listener)
					}
				}
			},
			// A corrupt frame is skipped, never fatal: one bad length must not take
			// the capture down. A stalled stream is caught by the start timeout.
			onError: () => {},
		})

		child.stdout?.on("data", (chunk: Buffer) => this.handleStdout(chunk))
		child.stderr?.on("data", (chunk: Buffer) => this.handleStderr(chunk))
		child.once("error", (error) => {
			this.exitCode = this.exitCode ?? -1
			this.rejectPending(new VoiceError("CAPTURE_HELPER_FAILED", error.message))
		})
		child.once("exit", (code) => {
			this.exitCode = code
			VoiceSessionRegistry.unregister(child)
			this.rejectPending(new VoiceError("CAPTURE_HELPER_EXITED", this.lastStderr()))
		})

		// The helper announces `captureStarted` before the first frame; that is the
		// point at which the microphone is really open.
		const banner = await this.waitForJson((json) => json.kind === "captureStarted" || json.kind === "error", 8000)
		if (banner.kind === "error") {
			const code = banner.code ?? "CAPTURE_HELPER_FAILED"
			await this.killChild()
			throw new VoiceError(code as "MICROPHONE_ACCESS_DENIED")
		}
		this.capturing = true
		return { backend: this.id, sampleRate: VOICE_SAMPLE_RATE, channels: 1, deviceId }
	}

	async stopCapture(): Promise<ProviderStopResult> {
		if (!this.capturing && !this.child) {
			return { framesReceived: 0, bytesReceived: 0 }
		}
		this.capturing = false
		// `q` asks the helper to stop cleanly and flush its final block; killing it
		// afterwards guarantees termination even if it ignores the byte.
		try {
			this.child?.stdin?.write("q\n")
		} catch {
			// pipe already gone; the exit handler covers it
		}
		await this.waitForExit(1500)
		await this.killChild()
		return { framesReceived: this.frames, bytesReceived: this.bytes }
	}

	async cancelCapture(): Promise<void> {
		this.capturing = false
		await this.killChild()
	}

	onFrames(listener: (frame: PcmFrame) => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		this.disposed = true
		this.capturing = false
		this.listeners.clear()
		await this.killChild()
	}

	/** Diagnostics for the coordinator: how many frames the helper produced. */
	get counters(): { frames: number; bytes: number } {
		return { frames: this.frames, bytes: this.bytes }
	}

	// ── internals ────────────────────────────────────────────────────────────

	private assertNotDisposed(): void {
		if (this.disposed) {
			throw new VoiceError("VOICE_RUNTIME_DISPOSED")
		}
	}

	private lastStderr(): string {
		return this.stderrTail.length > 0 ? this.stderrTail[this.stderrTail.length - 1] : "helper exited"
	}

	/**
	 * The helper prints one UTF-8 JSON line (the capture banner) before the first
	 * binary frame. Split that line off, then hand every remaining byte to the
	 * frame parser so a frame split across chunks is reassembled.
	 */
	private handleStdout(chunk: Buffer): void {
		let buffer = this.stdoutRemainder.length > 0 ? Buffer.concat([Buffer.from(this.stdoutRemainder, "latin1"), chunk]) : chunk
		this.stdoutRemainder = ""
		while (!this.bannerSeen) {
			const newline = buffer.indexOf(0x0a)
			if (newline === -1) {
				this.stdoutRemainder = buffer.toString("latin1")
				return
			}
			const line = buffer.subarray(0, newline).toString("utf8")
			buffer = buffer.subarray(newline + 1)
			const json = parseJson(line)
			if (json) {
				this.bannerSeen = true
				this.deliverJson(json)
			}
		}
		if (buffer.length > 0) {
			this.parser?.push(buffer)
		}
	}

	private handleStderr(chunk: Buffer): void {
		// Diagnostics only — codes and messages, never audio. Keep a short tail for
		// the typed error message; it is never persisted or logged.
		for (const line of chunk.toString("utf8").split(/\r?\n/)) {
			const trimmed = line.trim()
			if (trimmed.length > 0) {
				this.stderrTail.push(trimmed)
			}
		}
		if (this.stderrTail.length > 20) {
			this.stderrTail = this.stderrTail.slice(-20)
		}
	}

	private deliverJson(json: HelperJson): void {
		if (this.pendingControl && this.pendingControl.matches(json)) {
			const pending = this.pendingControl
			this.pendingControl = undefined
			clearTimeout(pending.timeout)
			this.stopPolling()
			pending.resolve(json)
			return
		}
		this.controlQueue.push(json)
	}

	private stopPolling(): void {
		if (this.polling) {
			clearInterval(this.polling)
			this.polling = undefined
		}
	}

	private rejectPending(error: Error): void {
		const pending = this.pendingControl
		if (!pending) return
		this.pendingControl = undefined
		clearTimeout(pending.timeout)
		this.stopPolling()
		pending.reject(error)
	}

	private waitForJson(matches: (json: HelperJson) => boolean, timeoutMs: number): Promise<HelperJson> {
		const index = this.controlQueue.findIndex(matches)
		if (index !== -1) {
			return Promise.resolve(this.controlQueue.splice(index, 1)[0])
		}
		if (this.exitCode !== null) {
			return Promise.reject(new VoiceError("CAPTURE_HELPER_EXITED", this.lastStderr()))
		}
		return new Promise<HelperJson>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingControl = undefined
				this.stopPolling()
				reject(new VoiceError("CAPTURE_HELPER_FAILED", "helper did not reply in time"))
			}, timeoutMs)
			timeout.unref?.()
			this.pendingControl = { resolve, reject, timeout, matches }
			// After the banner, any further control line still lands in the queue;
			// poll so a waiter never misses one that arrived without a waiter.
			this.polling = setInterval(() => {
				const idx = this.controlQueue.findIndex(matches)
				if (idx !== -1 && this.pendingControl) {
					this.deliverJson(this.controlQueue.splice(idx, 1)[0])
				}
			}, 25)
			this.polling.unref?.()
		})
	}

	/** Runs a one-shot control command (`--probe`, `--list-devices`). */
	private async runControl(args: string[]): Promise<HelperJson> {
		const child = this.spawnImpl(this.options.helperPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			env: scrubHelperEnv(process.env),
		})
		return await new Promise<HelperJson>((resolve, reject) => {
			let stdout = ""
			let stderr = ""
			const timeout = setTimeout(() => {
				try {
					child.kill()
				} catch {
					// ignore
				}
				reject(new VoiceError("CAPTURE_HELPER_FAILED", "helper did not reply in time"))
			}, 8000)
			timeout.unref?.()
			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8")
			})
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf8")
			})
			child.once("error", (error) => {
				clearTimeout(timeout)
				reject(new VoiceError("CAPTURE_HELPER_FAILED", error.message))
			})
			child.once("exit", () => {
				clearTimeout(timeout)
				const line = stdout.split(/\r?\n/).find((entry) => entry.trim().startsWith("{"))
				const json = line ? parseJson(line) : undefined
				if (json) {
					resolve(json)
					return
				}
				const stderrLine = stderr.trim().split(/\r?\n/).pop()
				reject(new VoiceError("CAPTURE_HELPER_FAILED", stderrLine ?? "helper produced no control reply"))
			})
		})
	}

	private async waitForExit(timeoutMs: number): Promise<void> {
		const child = this.child
		if (!child || child.exitCode !== null) return
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, timeoutMs)
			timer.unref?.()
			child.once("exit", () => {
				clearTimeout(timer)
				resolve()
			})
		})
	}

	/** Ends stdin (EOF makes the helper stop on its own), then kills if needed. */
	private async killChild(): Promise<void> {
		const child = this.child
		this.child = undefined
		this.parser = undefined
		this.stopPolling()
		if (!child) return
		VoiceSessionRegistry.unregister(child)
		if (child.exitCode !== null || child.signalCode !== null) return
		try {
			child.stdin?.end()
		} catch {
			// pipe already closed
		}
		try {
			child.kill()
		} catch {
			// already gone
		}
		await new Promise<void>((resolve) => {
			if (child.exitCode !== null || child.signalCode !== null) {
				resolve()
				return
			}
			const timer = setTimeout(resolve, 750)
			timer.unref?.()
			child.once("exit", () => {
				clearTimeout(timer)
				resolve()
			})
		})
	}
}

function normaliseState(state: string | undefined): CaptureDeviceInfo["state"] {
	switch (state) {
		case "active":
		case "disabled":
		case "unplugged":
		case "notpresent":
			return state
		default:
			return "unknown"
	}
}

function parseJson(line: string): HelperJson | undefined {
	try {
		const parsed = JSON.parse(line)
		return typeof parsed === "object" && parsed !== null ? (parsed as HelperJson) : undefined
	} catch {
		return undefined
	}
}

/**
 * The helper is a capture-only child process: it must never see provider
 * credentials or API keys.
 */
export function scrubHelperEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const scrubbed: NodeJS.ProcessEnv = { ...env }
	for (const key of Object.keys(scrubbed)) {
		if (/(API_KEY|APIKEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH)/i.test(key)) {
			delete scrubbed[key]
		}
	}
	return scrubbed
}
