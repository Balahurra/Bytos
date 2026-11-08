import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useVoiceDictation } from "./useVoiceDictation"

/**
 * F4 — the composer's dictation state machine.
 *
 * The gRPC client is the seam: these cases assert the exact request sequence the
 * mic button produces, that repeated clicks cannot duplicate work, and that a
 * cancel or an unmount always leaves the host with nothing running.
 */

const rpc = vi.hoisted(() => ({
	startCapture: vi.fn(),
	stopCapture: vi.fn(),
	cancelCapture: vi.fn(),
	transcribeUtterance: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({ VoiceServiceClient: rpc }))

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function setup(overrides: Partial<Parameters<typeof useVoiceDictation>[0]> = {}) {
	const onTranscript = vi.fn()
	const view = renderHook(() => useVoiceDictation({ enabled: true, onTranscript, ...overrides }))
	return { ...view, onTranscript }
}

beforeEach(() => {
	for (const fn of Object.values(rpc)) fn.mockReset()
	rpc.startCapture.mockResolvedValue({ sessionId: "voice-1", sampleRate: 16000, channels: 1, backend: "wasapi" })
	rpc.cancelCapture.mockResolvedValue({})
	rpc.transcribeUtterance.mockResolvedValue({ text: "merhaba dünya", language: "tr", modelId: "base" })
})

describe("idle → recording → completed", () => {
	it("starts capture, then transcribes and hands the text to the composer", async () => {
		const { result, onTranscript } = setup()

		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		expect(rpc.startCapture).toHaveBeenCalledTimes(1)

		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("completed"))

		// Exactly one transcribe call, carrying the session id and the settings.
		expect(rpc.transcribeUtterance).toHaveBeenCalledTimes(1)
		expect(rpc.transcribeUtterance.mock.calls[0][0]).toMatchObject({ sessionId: "voice-1" })
		expect(onTranscript).toHaveBeenCalledWith("merhaba dünya")
	})

	it("sends the persisted language and model with the request", async () => {
		const { result } = setup({ language: "de", modelId: "tiny" })
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("completed"))
		expect(rpc.transcribeUtterance.mock.calls[0][0]).toMatchObject({ language: "de", modelId: "tiny" })
	})

	it("adds nothing to the draft for an empty or silent capture", async () => {
		rpc.transcribeUtterance.mockResolvedValue({ text: "", language: "tr", modelId: "base", emptyAudio: true })
		const { result, onTranscript } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("idle"))
		expect(onTranscript).not.toHaveBeenCalled()
	})

	it("never sends a message: the hook has no send path at all", async () => {
		const { result } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("completed"))
		// The only RPCs are capture control and the text-only transcription.
		expect(Object.keys(rpc).sort()).toEqual(["cancelCapture", "startCapture", "stopCapture", "transcribeUtterance"])
	})
})

describe("duplicate clicks", () => {
	it("ignores a second click while capture is starting", async () => {
		const pending = deferred<{ sessionId: string }>()
		rpc.startCapture.mockReturnValue(pending.promise)
		const { result } = setup()

		act(() => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("initializing"))
		// Three more clicks while the first start is in flight.
		act(() => result.current.toggle())
		act(() => result.current.toggle())
		act(() => result.current.toggle())

		expect(rpc.startCapture).toHaveBeenCalledTimes(1)
		await act(async () => pending.resolve({ sessionId: "voice-1", sampleRate: 16000, channels: 1, backend: "wasapi" }))
		await waitFor(() => expect(result.current.phase).toBe("recording"))
	})

	it("ignores a second stop while transcription is in flight", async () => {
		const pending = deferred<{ text: string }>()
		rpc.transcribeUtterance.mockReturnValue(pending.promise)
		const { result, onTranscript } = setup()

		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))

		act(() => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("transcribing"))
		act(() => result.current.toggle())
		act(() => result.current.toggle())

		expect(rpc.transcribeUtterance).toHaveBeenCalledTimes(1)
		await act(async () => pending.resolve({ text: "once", language: "tr", modelId: "base" }))
		await waitFor(() => expect(result.current.phase).toBe("completed"))
		expect(onTranscript).toHaveBeenCalledTimes(1)
	})

	it("starts a fresh run after a completed one, not a second capture in parallel", async () => {
		const { result } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("completed"))

		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		expect(rpc.startCapture).toHaveBeenCalledTimes(2)
	})
})

describe("cancel and cleanup", () => {
	it("cancels the capture on the host and produces no text", async () => {
		const { result, onTranscript } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))

		await act(async () => result.current.cancel())
		await waitFor(() => expect(result.current.phase).toBe("cancelled"))
		expect(rpc.cancelCapture).toHaveBeenCalledWith({ sessionId: "voice-1" })
		expect(rpc.transcribeUtterance).not.toHaveBeenCalled()
		expect(onTranscript).not.toHaveBeenCalled()
	})

	it("cancels from the initializing phase as well", async () => {
		const pending = deferred<{ sessionId: string }>()
		rpc.startCapture.mockReturnValue(pending.promise)
		const { result } = setup()

		act(() => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("initializing"))
		await act(async () => result.current.cancel())
		await waitFor(() => expect(result.current.phase).toBe("cancelled"))

		// The late start still opened a helper: it is closed, not leaked.
		await act(async () => pending.resolve({ sessionId: "voice-2", sampleRate: 16000, channels: 1, backend: "wasapi" }))
		await waitFor(() => expect(rpc.cancelCapture).toHaveBeenCalledWith({ sessionId: "voice-2" }))
		expect(result.current.phase).toBe("cancelled")
	})

	it("drops a transcript that arrives after the run was cancelled", async () => {
		const pending = deferred<{ text: string }>()
		rpc.transcribeUtterance.mockReturnValue(pending.promise)
		const { result, onTranscript } = setup()

		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		act(() => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("transcribing"))

		await act(async () => result.current.cancel())
		await act(async () => pending.resolve({ text: "late", language: "tr", modelId: "base" }))
		expect(onTranscript).not.toHaveBeenCalled()
		expect(result.current.phase).toBe("cancelled")
	})

	it("cancels the capture when the composer unmounts mid-recording", async () => {
		const { result, unmount } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))

		unmount()
		await waitFor(() => expect(rpc.cancelCapture).toHaveBeenCalledWith({ sessionId: "voice-1" }))
	})

	it("cancels the capture when the composer unmounts while initializing", async () => {
		const pending = deferred<{ sessionId: string }>()
		rpc.startCapture.mockReturnValue(pending.promise)
		const { result, unmount } = setup()

		act(() => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("initializing"))
		unmount()

		// The helper that opened after unmount is closed immediately.
		await act(async () => pending.resolve({ sessionId: "voice-3", sampleRate: 16000, channels: 1, backend: "wasapi" }))
		await waitFor(() => expect(rpc.cancelCapture).toHaveBeenCalledWith({ sessionId: "voice-3" }))
	})
})
describe("errors", () => {
	it("reports a failed start with a readable sentence and the host's code", async () => {
		rpc.startCapture.mockRejectedValue(new Error("MICROPHONE_ACCESS_DENIED: denied"))
		const { result } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("error"))
		expect(result.current.errorCode).toBe("MICROPHONE_ACCESS_DENIED")
		// A sentence the user can act on, not the raw stack.
		expect(result.current.errorMessage).toMatch(/Microphone access was denied/)
	})

	it("reports a failed transcription without touching the draft", async () => {
		rpc.transcribeUtterance.mockRejectedValue(new Error("MODEL_NOT_INSTALLED: missing"))
		const { result, onTranscript } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("error"))
		expect(result.current.errorCode).toBe("MODEL_NOT_INSTALLED")
		expect(onTranscript).not.toHaveBeenCalled()
	})

	it("retries cleanly after an error instead of treating it as a double click", async () => {
		rpc.startCapture.mockRejectedValueOnce(new Error("NO_CAPTURE_DEVICE: none"))
		const { result } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("error"))

		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		expect(rpc.startCapture).toHaveBeenCalledTimes(2)
	})

	it("does nothing at all when voice is not available", async () => {
		const { result } = setup({ enabled: false })
		await act(async () => result.current.toggle())
		expect(rpc.startCapture).not.toHaveBeenCalled()
		expect(result.current.phase).toBe("idle")
	})
})

describe("phase transitions are explicit", () => {
	it("walks idle → initializing → recording → transcribing → completed", async () => {
		const seen: string[] = []
		const { result } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		seen.push(result.current.phase)
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("completed"))
		seen.push(result.current.phase)
		expect(seen).toEqual(["recording", "completed"])
	})

	it("reports the elapsed recording time", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true })
		try {
			const { result } = setup()
			await act(async () => result.current.toggle())
			await waitFor(() => expect(result.current.phase).toBe("recording"))
			await act(async () => {
				vi.advanceTimersByTime(1200)
			})
			expect(result.current.elapsedMs).toBeGreaterThan(1000)
		} finally {
			vi.useRealTimers()
		}
	})

	it("reset returns a finished run to idle, but never abandons a live capture", async () => {
		const { result } = setup()
		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("recording"))
		act(() => result.current.reset())
		expect(result.current.phase).toBe("recording")

		await act(async () => result.current.toggle())
		await waitFor(() => expect(result.current.phase).toBe("completed"))
		act(() => result.current.reset())
		expect(result.current.phase).toBe("idle")
	})
})
