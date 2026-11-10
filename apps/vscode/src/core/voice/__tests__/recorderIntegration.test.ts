import { GrpcRecorder } from "@core/controller/grpc-recorder/grpc-recorder"
import type { ILogFileHandler } from "@core/controller/grpc-recorder/log-file-handler"
import type { GrpcSessionLog } from "@core/controller/grpc-recorder/types"
import { isVoiceRequest, VOICE_SERVICE_NAME } from "@core/voice/recorder/voiceRequestFilter"
import { describe, expect, it } from "vitest"
import type { GrpcRequest } from "@/shared/WebviewMessage"

/**
 * T1 — recorder INTEGRATION. Builds the real `GrpcRecorder` with the real
 * shipped filter and a spy `ILogFileHandler`, then dispatches the same request
 * shapes `handleGrpcRequest` dispatches. This is what proves the filter is
 * actually wired into the recorder, not merely available.
 */

class SpyLogFileHandler implements ILogFileHandler {
	writes: GrpcSessionLog[] = []
	initialData: GrpcSessionLog | undefined

	async initialize(initialData: GrpcSessionLog): Promise<void> {
		this.initialData = initialData
	}

	async write(sessionLog: GrpcSessionLog): Promise<void> {
		// Snapshot: the recorder mutates its session log in place.
		this.writes.push(JSON.parse(JSON.stringify(sessionLog)) as GrpcSessionLog)
	}

	get allEntries(): Array<{ service: string; method: string }> {
		const entries = this.writes.flatMap((log) => log.entries.map((e) => ({ service: e.service, method: e.method })))
		const initial = this.initialData?.entries?.map((e) => ({ service: e.service, method: e.method })) ?? []
		return [...initial, ...entries]
	}

	get rawJson(): string {
		return JSON.stringify([this.initialData ?? {}, ...this.writes])
	}
}

function voiceRequest(method: string, message: Record<string, unknown> = {}): GrpcRequest {
	return {
		service: VOICE_SERVICE_NAME,
		method,
		message,
		request_id: `voice-${method}`,
		is_streaming: false,
	} as GrpcRequest
}

function stateRequest(method: string, message: Record<string, unknown> = {}): GrpcRequest {
	return {
		service: "bytos.StateService",
		method,
		message,
		request_id: `state-${method}`,
		is_streaming: false,
	} as GrpcRequest
}

describe("GrpcRecorder with the voice isolation filter", () => {
	it("never records bytos.VoiceService traffic", () => {
		const handler = new SpyLogFileHandler()
		const recorder = new GrpcRecorder(handler, [isVoiceRequest])

		for (const method of ["getVoiceStatus", "listCaptureDevices", "startCapture", "stopCapture", "cancelCapture"]) {
			const request = voiceRequest(method, { microphoneId: "dev", captureMethod: "auto" })
			recorder.recordRequest(request)
			recorder.recordResponse(request.request_id, { request_id: request.request_id, message: { ok: true } })
		}

		expect(handler.allEntries.filter((entry) => entry.service === VOICE_SERVICE_NAME)).toEqual([])
		expect(recorder.getSessionLog().entries).toEqual([])
	})

	it("still records non-voice traffic exactly as before", () => {
		const handler = new SpyLogFileHandler()
		const recorder = new GrpcRecorder(handler, [isVoiceRequest])

		const request = stateRequest("updateSettings", { voiceEnabled: true })
		recorder.recordRequest(request)
		recorder.recordResponse(request.request_id, { request_id: request.request_id, message: {} })

		const entries = recorder.getSessionLog().entries
		expect(entries).toHaveLength(1)
		expect(entries[0].service).toBe("bytos.StateService")
		expect(entries[0].method).toBe("updateSettings")
		expect(entries[0].status).toBe("completed")
	})

	it("never records a request carrying an audio-like field, even on another service", () => {
		const handler = new SpyLogFileHandler()
		const recorder = new GrpcRecorder(handler, [isVoiceRequest])

		recorder.recordRequest(stateRequest("getLatestState", { payload: { utterance: "x" } }))
		recorder.recordRequest({
			service: "bytos.TaskService",
			method: "newTask",
			message: { audio: "AAAA" },
			request_id: "task-audio",
			is_streaming: false,
		} as GrpcRequest)

		expect(recorder.getSessionLog().entries).toEqual([])
		expect(handler.rawJson).not.toContain("utterance")
		expect(handler.rawJson).not.toContain("AAAA")
	})

	it("writes a session log that contains no audio bytes after a mixed traffic run", () => {
		const handler = new SpyLogFileHandler()
		const recorder = new GrpcRecorder(handler, [isVoiceRequest])

		recorder.recordRequest(stateRequest("updateSettings", { preferredLanguage: "Turkish" }))
		recorder.recordRequest(voiceRequest("startCapture"))
		recorder.recordResponse("voice-startCapture", { request_id: "voice-startCapture", message: { sessionId: "v1" } })

		const raw = handler.rawJson
		expect(raw).not.toContain(VOICE_SERVICE_NAME)
		expect(raw).not.toContain("startCapture")
		// The legitimate, audio-free settings write is still there.
		expect(raw).toContain("preferredLanguage")
	})
})
