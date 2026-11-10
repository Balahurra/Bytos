import { getVoiceServiceStatus, setVoiceEngineResolverForTesting } from "@core/controller/voice/getVoiceServiceStatus"
import { runConsentedModelDownload } from "@core/controller/voice/modelDownloadFlow"
import {
	activeVoiceEventSubscriptionCount,
	resetVoiceEventSubscriptionsForTesting,
	subscribeToVoiceEvents,
} from "@core/controller/voice/subscribeToVoiceEvents"
import { getVoiceModelService, resetVoiceModelServiceForTesting } from "@core/controller/voice/VoiceModelService"
import { EmptyRequest } from "@shared/proto/bytos/common"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F3 — handler contract tests.
 *
 * These drive the real handlers with a fake host state manager and a faked
 * *engine resolver only* (resolving the whisper binary is the one thing a unit
 * test cannot do honestly). Consent, model state and events are the real paths.
 */

const runtimeHolder = vi.hoisted(() => ({ runtime: undefined as unknown }))

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>()
	const spawnMock = vi.fn(() => {
		throw new Error("the F3 voice handlers must not spawn a capture helper")
	})
	return { ...actual, spawn: spawnMock, default: { ...actual, spawn: spawnMock } }
})

vi.mock("@core/voice", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@core/voice")>()
	return {
		...actual,
		getVoiceRuntime: async () => {
			if (!runtimeHolder.runtime) throw new Error("runtime not primed for this test")
			return runtimeHolder.runtime
		},
		updateVoiceSettings: () => {},
	}
})

const deviceList = [
	{ id: "dev-a", name: "Microphone Array", state: "active", isDefault: true },
	{ id: "dev-b", name: "USB Headset", state: "active", isDefault: false },
]

function fakeRuntime(options: { canCapture?: boolean; reason?: string; devices?: typeof deviceList } = {}) {
	const capability = {
		canCapture: options.canCapture ?? true,
		backend: "wasapi",
		reason: options.reason ?? "",
		detail: "",
		osLabel: "Windows x64 (local)",
		platform: "win32",
		arch: "x64",
		remoteName: undefined,
		helperPath: "helper.exe",
		deviceCount: 1,
		permission: "granted",
	}
	const runtime = {
		capability,
		captureState: "idle",
		currentSessionId: "voice-1",
		refreshCapability: (next: typeof capability) => {
			runtime.capability = next
		},
		snapshot: () => ({
			state: "idle",
			sessionId: "voice-1",
			framesReceived: 0,
			bytesReceived: 0,
			droppedFrames: 0,
			durationMs: 0,
			lastErrorCode: undefined,
			lastErrorMessage: undefined,
		}),
		devices: options.devices,
		listDevices: vi.fn(async () => ({ provider: "wasapi", devices: runtime.devices ?? deviceList })),
		coordinator: {
			listDevices: () => runtime.listDevices(),
		},
	}
	return runtime
}

function fakeController(settings: Record<string, unknown> = {}) {
	const global = new Map(Object.entries(settings))
	return {
		global,
		stateManager: {
			getGlobalSettingsKey: (key: string) => global.get(key),
			getGlobalStateKey: (key: string) => global.get(key),
			setGlobalState: (key: string, value: unknown) => global.set(key, value),
		},
		postStateToWebview: async () => {},
	} as never
}

beforeEach(() => {
	runtimeHolder.runtime = fakeRuntime()
	resetVoiceModelServiceForTesting()
	resetVoiceEventSubscriptionsForTesting()
	// Model directory: unset, so no model is installed anywhere real.
	process.env.BYTOS_WHISPER_MODEL_DIR = ""
	setVoiceEngineResolverForTesting(async () => ({ state: "ready", errorCode: "" }))
})

afterEach(() => {
	setVoiceEngineResolverForTesting(undefined)
	resetVoiceModelServiceForTesting()
})

describe("getVoiceServiceStatus", () => {
	it("reports persisted preferences and validates what it reads", async () => {
		const controller = fakeController({ voiceEnabled: true, voiceLanguage: "de", voiceModelId: "tiny" })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(status.language).toBe("de")
		expect(status.modelId).toBe("tiny")
	})

	it("falls back to safe values for unset or invalid preferences", async () => {
		const controller = fakeController({ voiceLanguage: "klingon", voiceModelId: "medium" })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(status.language).toBe("auto")
		expect(status.modelId).toBe("base")
	})

	it("returns the real enumerated devices", async () => {
		const controller = fakeController({ voiceEnabled: true })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(status.devices.map((device) => device.name)).toEqual(["Microphone Array", "USB Headset"])
		expect(status.devices[0].isDefault).toBe(true)
		expect(status.microphoneAvailable).toBe(true)
	})

	it("enumerates microphones even when Voice is still switched off", async () => {
		// F4.1: the device list must be readable before the toggle is turned on,
		// otherwise a fresh install looks as if the machine has no microphone.
		const runtime = fakeRuntime({ canCapture: false, reason: "VOICE_DISABLED" })
		runtimeHolder.runtime = runtime
		const controller = fakeController({ voiceEnabled: false })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(runtime.listDevices).toHaveBeenCalledTimes(1)
		expect(status.microphoneAvailable).toBe(true)
		expect(status.devices.map((device) => device.name)).toEqual(["Microphone Array", "USB Headset"])
		// Capture stays gated on the toggle, but the devices are known.
		expect(status.capability?.canCapture).toBe(false)
		expect(status.capability?.unavailableReason).toBe("VOICE_DISABLED")
	})

	it("does not spawn the helper when the host itself is unsupported", async () => {
		const runtime = fakeRuntime({ canCapture: false, reason: "CAPTURE_HELPER_MISSING" })
		runtimeHolder.runtime = runtime
		const controller = fakeController({ voiceEnabled: true })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(runtime.listDevices).not.toHaveBeenCalled()
		expect(status.devices).toEqual([])
		expect(status.microphoneErrorCode).toBe("CAPTURE_HELPER_MISSING")
	})

	it("picks up a microphone plugged in after the first read (Refresh)", async () => {
		const runtime = fakeRuntime({ devices: [] })
		runtimeHolder.runtime = runtime
		const controller = fakeController({ voiceEnabled: true })
		const first = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(first.microphoneAvailable).toBe(false)
		expect(first.microphoneErrorCode).toBe("NO_CAPTURE_DEVICE")
		// A microphone appears; Refresh must observe it and unlock capture.
		runtime.devices = deviceList
		const second = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(second.microphoneAvailable).toBe(true)
		expect(second.capability?.canCapture).toBe(true)
		expect(second.capability?.unavailableReason).toBe("")
	})

	it("reports no microphone with a stable code when enumeration finds none", async () => {
		runtimeHolder.runtime = fakeRuntime({ devices: [] })
		const controller = fakeController({ voiceEnabled: true })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(status.devices).toEqual([])
		expect(status.microphoneAvailable).toBe(false)
		expect(status.microphoneErrorCode).toBe("NO_CAPTURE_DEVICE")
	})

	it("explains an unsupported host instead of pretending capture works", async () => {
		runtimeHolder.runtime = fakeRuntime({ canCapture: false, reason: "REMOTE_HOST_UNSUPPORTED" })
		const controller = fakeController({ voiceEnabled: true })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(status.capability?.canCapture).toBe(false)
		expect(status.capability?.unavailableReason).toBe("REMOTE_HOST_UNSUPPORTED")
		expect(status.microphoneAvailable).toBe(false)
		expect(status.microphoneErrorCode).toBe("REMOTE_HOST_UNSUPPORTED")
	})

	it("is not transcribe-ready when no model is verified", async () => {
		const controller = fakeController({ voiceEnabled: true, voiceModelId: "base" })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(status.engineState).toBe("ready")
		expect(status.transcribeReady).toBe(false)
		expect(status.models.every((model) => model.state === "not-installed")).toBe(true)
	})

	it("reports the engine as unavailable when the binary cannot be resolved", async () => {
		setVoiceEngineResolverForTesting(async () => ({
			state: "missing",
			errorCode: "WHISPER_BINARY_MISSING",
		}))
		const controller = fakeController({ voiceEnabled: true })
		const status = await getVoiceServiceStatus(controller, EmptyRequest.create())
		expect(status.engineState).toBe("missing")
		expect(status.engineErrorCode).toBe("WHISPER_BINARY_MISSING")
		expect(status.transcribeReady).toBe(false)
	})
})

describe("runConsentedModelDownload", () => {
	it("does not start a transfer when the request carries no consent", async () => {
		const askConsent = vi.fn(async () => true)
		const started = await runConsentedModelDownload({
			controller: fakeController(),
			modelId: "tiny",
			consent: false,
			service: getVoiceModelService(),
			askConsent,
		})
		expect(started).toBe(false)
		// The prompt is never even shown.
		expect(askConsent).not.toHaveBeenCalled()
	})

	it("does not start a transfer when the user declines the host prompt", async () => {
		const events: string[] = []
		await subscribeToVoiceEvents(
			fakeController(),
			EmptyRequest.create(),
			(async (event: { kind: string; code?: string }) => {
				events.push(`${event.kind}:${event.code ?? ""}`)
			}) as never,
			"req-decline",
		)
		const started = await runConsentedModelDownload({
			controller: fakeController(),
			modelId: "tiny",
			consent: true,
			service: getVoiceModelService(),
			askConsent: async () => false,
		})
		expect(started).toBe(false)
		expect(activeVoiceEventSubscriptionCount()).toBe(1)
		expect(events.some((entry) => entry.includes("MODEL_CONSENT_REQUIRED"))).toBe(true)
	})

	it("rejects an unknown model id before doing anything", async () => {
		await expect(
			runConsentedModelDownload({
				controller: fakeController(),
				modelId: "medium",
				consent: true,
				service: getVoiceModelService(),
				askConsent: async () => true,
			}),
		).rejects.toMatchObject({ code: "MODEL_UNKNOWN" })
	})
})
