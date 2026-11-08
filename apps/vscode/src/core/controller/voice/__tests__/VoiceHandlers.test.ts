import * as fsModule from "node:fs/promises"
import * as pathModule from "node:path"
import { cancelCapture } from "@core/controller/voice/cancelCapture"
import { getVoiceStatus } from "@core/controller/voice/getVoiceStatus"
import { listCaptureDevices } from "@core/controller/voice/listCaptureDevices"
import { startCapture } from "@core/controller/voice/startCapture"
import { stopCapture } from "@core/controller/voice/stopCapture"
import {
	activeVoiceEventSubscriptionCount,
	publishVoiceEvent,
	resetVoiceEventSubscriptionsForTesting,
	subscribeToVoiceEvents,
} from "@core/controller/voice/subscribeToVoiceEvents"
import { EmptyRequest } from "@shared/proto/bytos/common"
import { CancelCaptureRequest, StartCaptureRequest, StopCaptureRequest } from "@shared/proto/bytos/voice"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * T5b — handler contract tests. The handlers are audio-free by construction:
 * the request/response messages cannot express audio, no handler returns audio,
 * and no handler touches the agent runtime or the send path.
 */

const { spawnMock, runtimeHolder } = vi.hoisted(() => ({
	spawnMock: vi.fn(),
	runtimeHolder: { runtime: undefined as unknown },
}))

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>()
	spawnMock.mockImplementation(() => {
		throw new Error("spawn must not be called by getVoiceStatus")
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

function fakeController(settings: Record<string, unknown> = {}) {
	return {
		stateManager: {
			getGlobalSettingsKey: (key: string) => settings[key],
		},
		postStateToWebview: async () => {},
	} as never
}

function fakeRuntime(overrides: Record<string, unknown> = {}) {
	const runtime = {
		capability: {
			canCapture: true,
			backend: "wasapi",
			reason: "",
			detail: "",
			osLabel: "Windows x64 (local)",
			platform: "win32",
			arch: "x64",
			remoteName: undefined,
			helperPath: "helper.exe",
			deviceCount: 1,
			permission: "granted",
		},
		captureState: "idle",
		currentSessionId: "voice-1",
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
		coordinator: {
			listDevices: async () => ({
				provider: "wasapi",
				devices: [{ id: "dev-a", name: "Microphone Array", state: "active", isDefault: true }],
			}),
		},
		startCapture: async () => ({ sessionId: "voice-1", sampleRate: 16000, channels: 1, backend: "wasapi" }),
		stopCapture: async () => ({
			sessionId: "voice-1",
			durationMs: 1500,
			samples: new Int16Array(24000),
			counters: { frames: 10, bytes: 48000, droppedFrames: 0 },
			truncated: false,
			reason: "stopped",
		}),
		cancelCapture: async () => {},
		...overrides,
	}
	return runtime
}

beforeEach(async () => {
	// Subscription state is module-level; clear it so cases stay independent.
	const { resetVoiceEventSubscriptionsForTesting } = await import("@core/controller/voice/subscribeToVoiceEvents")
	resetVoiceEventSubscriptionsForTesting()
	spawnMock.mockClear()
	runtimeHolder.runtime = fakeRuntime()
})

describe("getVoiceStatus", () => {
	it("spawns NOTHING (zero child processes) and reports the capability object", async () => {
		const status = await getVoiceStatus(fakeController({ voiceEnabled: true }), EmptyRequest.create())
		expect(spawnMock).not.toHaveBeenCalled()
		expect(status.canCapture).toBe(true)
		expect(status.backend).toBe("wasapi")
		expect(status.unavailableReason).toBe("")
		expect(status.captureState).toBe("idle")
	}, 30_000)

	it("reports the reason and never throws for an unsupported host", async () => {
		runtimeHolder.runtime = fakeRuntime({
			capability: {
				canCapture: false,
				backend: "none",
				reason: "REMOTE_HOST_UNSUPPORTED",
				detail: "remote host",
				osLabel: "Windows x64 (remote: ssh-remote)",
				platform: "win32",
				arch: "x64",
				remoteName: "ssh-remote",
				helperPath: "helper.exe",
				deviceCount: 0,
				permission: "unknown",
			},
		})
		const status = await getVoiceStatus(fakeController(), EmptyRequest.create())
		expect(status.canCapture).toBe(false)
		expect(status.unavailableReason).toBe("REMOTE_HOST_UNSUPPORTED")
		expect(spawnMock).not.toHaveBeenCalled()
	}, 30_000)

	it("returns a typed status instead of throwing when the runtime is unavailable", async () => {
		runtimeHolder.runtime = undefined
		const status = await getVoiceStatus(fakeController(), EmptyRequest.create())
		expect(status.canCapture).toBe(false)
		expect(status.lastErrorCode).toBe("VOICE_INTERNAL_ERROR")
	})
})

describe("listCaptureDevices", () => {
	it("returns device METADATA only — no audio and no path", async () => {
		const response = await listCaptureDevices(fakeController(), EmptyRequest.create())
		expect(response.devices).toHaveLength(1)
		expect(response.devices[0]).toMatchObject({ id: "dev-a", name: "Microphone Array", state: "active", isDefault: true })
		// ProtoBus-safe: serialises to JSON with no byte payload.
		const json = JSON.stringify(response)
		expect(json).not.toMatch(/audio|pcm|wav|sample/i)
	})

	it("reports the capability reason instead of probing an unsupported host", async () => {
		runtimeHolder.runtime = fakeRuntime({
			capability: { ...fakeRuntime().capability, canCapture: false, reason: "PLATFORM_NOT_SUPPORTED_IN_F1" },
		})
		const response = await listCaptureDevices(fakeController(), EmptyRequest.create())
		expect(response.devices).toEqual([])
		expect(response.errorCode).toBe("PLATFORM_NOT_SUPPORTED_IN_F1")
	})
})

describe("startCapture / stopCapture / cancelCapture", () => {
	it("start returns identifiers and format only — never audio", async () => {
		const response = await startCapture(
			fakeController(),
			StartCaptureRequest.create({ microphoneId: "", captureMethod: "auto" }),
		)
		expect(response.sessionId).toBe("voice-1")
		expect(response.sampleRate).toBe(16000)
		expect(response.channels).toBe(1)
		expect(response.backend).toBe("wasapi")
		// The only numbers are the format declaration ("sampleRate"); no payload.
		expect(JSON.stringify(response)).not.toMatch(/audio|pcm|wav|samples/i)
	})

	it("honours the persisted microphone when the request names none (F4)", async () => {
		// The composer sends `microphoneId: ""` meaning "whatever is configured".
		// An empty string used to override the Settings pin with the system
		// default, so a chosen USB/Bluetooth microphone was silently ignored.
		const requested: Array<string | undefined> = []
		runtimeHolder.runtime = fakeRuntime({
			startCapture: async (options: { deviceId?: string }) => {
				requested.push(options.deviceId)
				return { sessionId: "voice-1", sampleRate: 16000, channels: 1, backend: "wasapi" }
			},
		})
		await startCapture(fakeController({ voiceMicrophoneId: "dev-pinned" }), StartCaptureRequest.create({ microphoneId: "" }))
		expect(requested[0]).toBe("dev-pinned")
	})

	it("prefers an explicit microphone in the request over the persisted one", async () => {
		const requested: Array<string | undefined> = []
		runtimeHolder.runtime = fakeRuntime({
			startCapture: async (options: { deviceId?: string }) => {
				requested.push(options.deviceId)
				return { sessionId: "voice-1", sampleRate: 16000, channels: 1, backend: "wasapi" }
			},
		})
		await startCapture(
			fakeController({ voiceMicrophoneId: "dev-pinned" }),
			StartCaptureRequest.create({ microphoneId: "dev-explicit" }),
		)
		expect(requested[0]).toBe("dev-explicit")
	})

	it("falls back to the system default when nothing is pinned", async () => {
		const requested: Array<string | undefined> = []
		runtimeHolder.runtime = fakeRuntime({
			startCapture: async (options: { deviceId?: string }) => {
				requested.push(options.deviceId)
				return { sessionId: "voice-1", sampleRate: 16000, channels: 1, backend: "wasapi" }
			},
		})
		await startCapture(fakeController(), StartCaptureRequest.create({ microphoneId: "" }))
		expect(requested[0]).toBeUndefined()
	})

	it("propagates a typed error when the runtime refuses to start", async () => {
		const { VoiceError } = await import("@core/voice")
		runtimeHolder.runtime = fakeRuntime({
			startCapture: async () => {
				throw new VoiceError("MICROPHONE_ACCESS_DENIED")
			},
		})
		await expect(startCapture(fakeController(), StartCaptureRequest.create({}))).rejects.toMatchObject({
			code: "MICROPHONE_ACCESS_DENIED",
		})
	})

	it("stop returns an EMPTY response (the utterance stays in the host)", async () => {
		const response = await stopCapture(fakeController(), StopCaptureRequest.create({ sessionId: "voice-1" }))
		expect(response).toBeDefined()
		expect(Object.keys(response as object)).toEqual([])
	})

	it("stop rejects a session mismatch with a typed error", async () => {
		await expect(stopCapture(fakeController(), StopCaptureRequest.create({ sessionId: "other" }))).rejects.toMatchObject({
			code: "CAPTURE_SESSION_MISMATCH",
		})
	})

	it("cancel succeeds and never throws for an idle runtime", async () => {
		await expect(cancelCapture(fakeController(), CancelCaptureRequest.create({ sessionId: "" }))).resolves.toBeDefined()
	})
})

describe("subscribeToVoiceEvents", () => {
	it("publishes status/error events and drops handlers that throw", async () => {
		const received: string[] = []
		const good = vi.fn(async (event: { kind: string }) => {
			received.push(event.kind)
		})
		const bad = vi.fn(async () => {
			throw new Error("client gone")
		})
		await subscribeToVoiceEvents(fakeController(), EmptyRequest.create(), good as never, "req-good")
		await subscribeToVoiceEvents(fakeController(), EmptyRequest.create(), bad as never, "req-bad")
		expect(activeVoiceEventSubscriptionCount()).toBe(2)

		await publishVoiceEvent({
			kind: "captureStatus",
			sessionId: "voice-1",
			captureState: "capturing",
			durationMs: 0,
			bytesReceived: 0,
			code: "",
			message: "",
		} as never)
		expect(received).toEqual(["captureStatus"])
		expect(activeVoiceEventSubscriptionCount()).toBe(1)
	})

	it("resetVoiceEventSubscriptionsForTesting clears every subscription", async () => {
		await subscribeToVoiceEvents(fakeController(), EmptyRequest.create(), vi.fn() as never, "req-a")
		expect(activeVoiceEventSubscriptionCount()).toBe(1)
		resetVoiceEventSubscriptionsForTesting()
		expect(activeVoiceEventSubscriptionCount()).toBe(0)
	})
})

/**
 * Architecture isolation: voice code must not reach the agent runtime, the send
 * path, telemetry, the recorder, or the filesystem.
 */
describe("voice module isolation (architecture)", () => {
	const root = pathModule.resolve(__dirname, "..", "..", "..", "..", "..")

	async function sourceOf(relative: string): Promise<string> {
		return await fsModule.readFile(pathModule.join(root, relative), "utf8")
	}

	it("imports no provider, telemetry, recorder or task service from voice code", async () => {
		for (const relative of [
			"src/core/voice/VoiceRuntime.ts",
			"src/core/voice/capture/WasapiCaptureProvider.ts",
			"src/core/voice/capture/AudioCaptureCoordinator.ts",
			"src/core/controller/voice/startCapture.ts",
			"src/core/controller/voice/stopCapture.ts",
			"src/core/controller/voice/cancelCapture.ts",
			"src/core/controller/voice/getVoiceStatus.ts",
			// F4: the dictation handler is the newest path to the recogniser, so it
			// is held to exactly the same isolation rules.
			"src/core/controller/voice/transcribeUtterance.ts",
		]) {
			const source = await sourceOf(relative)
			expect(source, relative).not.toMatch(/@bytos\/llms/)
			expect(source, relative).not.toMatch(/services\/telemetry/)
			expect(source, relative).not.toMatch(/\.\.\/task\//)
			expect(source, relative).not.toMatch(/grpc-recorder\/grpc-recorder/)
		}
	})

	it("has no filesystem write call in the audio path", async () => {
		for (const relative of [
			"src/core/voice/VoiceRuntime.ts",
			"src/core/voice/audio/UtteranceBuffer.ts",
			"src/core/voice/capture/WasapiCaptureProvider.ts",
		]) {
			const source = await sourceOf(relative)
			expect(source, relative).not.toMatch(/\bwriteFile(Sync)?\b/)
			expect(source, relative).not.toMatch(/\bcreateWriteStream\b/)
			expect(source, relative).not.toMatch(/\bappendFile(Sync)?\b/)
			expect(source, relative).not.toMatch(/\.wav\b/)
		}
	})
})
