import type { PcmFrame } from "../types"

/**
 * Capture backend abstraction (TD-16).
 *
 * Design rule (non-negotiable): a provider reports what it can do and what it
 * observed; it never decides which one wins. Selection and fallback live in
 * `AudioCaptureCoordinator`, so the policy is unit-testable in isolation and
 * identical on every OS. F1 ships exactly one implementation.
 */
export interface AudioCaptureProvider {
	/** Stable backend id, e.g. "wasapi". */
	readonly id: string

	/** Cheap presence check — must not spawn a process. */
	isAvailable(): Promise<boolean>

	/** Probe the backend (may spawn the helper once). */
	probe(): Promise<ProviderProbeResult>

	enumerateDevices(): Promise<CaptureDeviceInfo[]>

	startCapture(options: ProviderStartOptions): Promise<ProviderStartResult>

	stopCapture(): Promise<ProviderStopResult>

	cancelCapture(): Promise<void>

	/** Receives normalised 16 kHz mono PCM16 frames. Never a file, never an RPC. */
	onFrames(listener: (frame: PcmFrame) => void): () => void

	dispose(): Promise<void>
}

export interface ProviderProbeResult {
	available: boolean
	permission: "granted" | "denied" | "unknown"
	deviceCount: number
	activeDeviceCount: number
	version?: string
	errorCode?: string
}

export interface ProviderStartOptions {
	deviceId?: string
	signal?: AbortSignal
}

export interface ProviderStartResult {
	backend: string
	sampleRate: number
	channels: number
	deviceId: string
}

export interface ProviderStopResult {
	framesReceived: number
	bytesReceived: number
}

export interface CaptureDeviceInfo {
	id: string
	name: string
	state: "active" | "disabled" | "unplugged" | "notpresent" | "unknown"
	isDefault: boolean
}
