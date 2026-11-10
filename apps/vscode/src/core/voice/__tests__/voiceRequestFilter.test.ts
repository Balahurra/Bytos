import { carriesAudioFields, isVoiceRequest, VOICE_SERVICE_NAME } from "@core/voice/recorder/voiceRequestFilter"
import { describe, expect, it } from "vitest"
import type { GrpcRequest } from "@/shared/WebviewMessage"

/**
 * T1 — recorder isolation. These are the five F0 cases, reproduced as real tests
 * against the SHIPPED predicate (not a harness copy), plus defence-in-depth
 * cases for audio-like fields on unrelated services.
 */

function request(overrides: Partial<GrpcRequest>): GrpcRequest {
	return {
		service: "bytos.StateService",
		method: "updateSettings",
		message: {},
		request_id: "req-1",
		is_streaming: false,
		...overrides,
	} as GrpcRequest
}

describe("isVoiceRequest", () => {
	it("filters a voice transcribeUtterance-shaped request (F0 case 1)", () => {
		expect(
			isVoiceRequest(
				request({
					service: VOICE_SERVICE_NAME,
					method: "transcribeUtterance",
					message: { sessionId: "voice-1" },
				}),
			),
		).toBe(true)
	})

	it("filters every VoiceService method, including audio-free ones (F0 case 2)", () => {
		expect(isVoiceRequest(request({ service: VOICE_SERVICE_NAME, method: "getVoiceStatus", message: {} }))).toBe(true)
		expect(isVoiceRequest(request({ service: VOICE_SERVICE_NAME, method: "startCapture", message: {} }))).toBe(true)
		expect(isVoiceRequest(request({ service: VOICE_SERVICE_NAME, method: "subscribeToVoiceEvents", message: {} }))).toBe(true)
		expect(isVoiceRequest(request({ service: VOICE_SERVICE_NAME, method: "listCaptureDevices" }))).toBe(true)
	})

	it("does NOT filter StateService.updateSettings (F0 case 3)", () => {
		expect(
			isVoiceRequest(
				request({
					service: "bytos.StateService",
					method: "updateSettings",
					message: { voiceEnabled: true, voiceCaptureMethod: "auto" },
				}),
			),
		).toBe(false)
	})

	it("does NOT filter TaskService.newTask (F0 case 4)", () => {
		expect(
			isVoiceRequest(
				request({
					service: "bytos.TaskService",
					method: "newTask",
					message: { text: "please refactor the parser" },
				}),
			),
		).toBe(false)
	})

	it("filters any StateService request carrying an audio field (F0 case 5)", () => {
		expect(isVoiceRequest(request({ service: "bytos.StateService", method: "getLatestState", message: { audio: 1 } }))).toBe(
			true,
		)
		expect(
			isVoiceRequest(
				request({ service: "bytos.StateService", method: "updateSettings", message: { nested: { pcm: [1, 2] } } }),
			),
		).toBe(true)
	})

	it("filters a JSON-string payload carrying audio (GrpcRequest.message is `any`)", () => {
		expect(
			isVoiceRequest(
				request({ message: JSON.stringify({ settings: { wav: "x" } }) as unknown as Record<string, unknown> }),
			),
		).toBe(true)
	})

	it("filters raw byte containers even under an innocent field name", () => {
		expect(isVoiceRequest(request({ message: { value: new Uint8Array(8) } }))).toBe(true)
		expect(isVoiceRequest(request({ message: { value: new ArrayBuffer(8) } }))).toBe(true)
	})

	it("does not filter ordinary long-ish text field values", () => {
		expect(isVoiceRequest(request({ message: { text: "hello world".repeat(200) } }))).toBe(false)
	})

	it("is safe on cyclic payloads", () => {
		const cyclic: Record<string, unknown> = { name: "x" }
		cyclic.self = cyclic
		expect(isVoiceRequest(request({ message: cyclic }))).toBe(false)
	})

	it("tolerates malformed JSON strings without throwing", () => {
		expect(() => isVoiceRequest(request({ message: "{not json" as unknown as Record<string, unknown> }))).not.toThrow()
	})
})

describe("carriesAudioFields", () => {
	it("detects audio-like field names case-insensitively", () => {
		for (const field of ["audio", "Audio", "pcm", "PCM16", "wav", "waveform", "samples", "transcript", "utterance"]) {
			expect(carriesAudioFields({ [field]: 1 })).toBe(true)
		}
	})

	it("returns false for control-shaped payloads", () => {
		expect(carriesAudioFields({ deviceId: "{0.0.1}", captureMethod: "auto", silenceTimeoutMs: 1200 })).toBe(false)
	})
})
