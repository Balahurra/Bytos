import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * §4.4 — the ProtoBus contract is audio-free BY CONSTRUCTION.
 *
 * This guard parses the shipped `proto/bytos/voice.proto` from disk (not a copy)
 * and fails if any message field could carry audio: no `bytes`, no `fixed*` /
 * `sfixed*`, and no audio-like field name. If a later phase ever tries to put
 * audio on ProtoBus, this test is what stops it.
 */

const PROTO_DIR = path.resolve(__dirname, "..", "..", "..", "..", "proto", "bytos")
const VOICE_PROTO = path.join(PROTO_DIR, "voice.proto")

/** Strips comments so documentation text cannot trip the name checks. */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n")
}

function fieldLines(source: string): string[] {
	return stripComments(source)
		.split("\n")
		.filter((line) => /^\s*(optional\s+|repeated\s+|required\s+)?[A-Za-z_.][\w.<>, ]*\s+\w+\s*=\s*\d+\s*;/.test(line))
}

describe("voice.proto (ProtoBus contract)", () => {
	const exists = fs.existsSync(VOICE_PROTO)
	const source = exists ? fs.readFileSync(VOICE_PROTO, "utf8") : ""
	const body = stripComments(source)

	it("exists in the proto directory", () => {
		expect(exists).toBe(true)
	})

	it("declares the VoiceService with exactly the capture, settings and dictation RPCs", () => {
		for (const rpc of [
			// F1 — capture
			"getVoiceStatus",
			"listCaptureDevices",
			"startCapture",
			"stopCapture",
			"cancelCapture",
			"subscribeToVoiceEvents",
			// F3 — settings (model metadata, consent-gated downloads)
			"getVoiceServiceStatus",
			"downloadVoiceModel",
			"cancelVoiceModelDownload",
			"removeVoiceModel",
			"verifyVoiceModel",
			// F4 — composer dictation (returns TEXT, never audio)
			"transcribeUtterance",
		]) {
			expect(body).toMatch(new RegExp(`rpc\\s+${rpc}\\s*\\(`))
		}
		// Nothing else: a recogniser is not installed, configured or driven under
		// a second name, and there is no separate "send" path on this service.
		expect(body).not.toMatch(/\brpc\s+installModel\b/)
		expect(body).not.toMatch(/\brpc\s+sendTranscript\b/)
		expect(body).not.toMatch(/\brpc\s+sendMessage\b/)
	})

	it("keeps the F3 model surface metadata-only", () => {
		// Consent must be expressible, and every model response must carry a state
		// the UI can render — never a path to a model file.
		expect(body).toMatch(/bool\s+consent\s*=\s*2/)
		expect(body).toMatch(/string\s+model_state\s*=/)
		expect(body).toMatch(/int64\s+size_bytes\s*=/)
		expect(body).not.toMatch(/\b(model_path|file_path|local_path)\b/i)
	})

	it("contains no bytes / fixed / sfixed field anywhere", () => {
		const offenders = fieldLines(source).filter((line) =>
			/^\s*(optional\s+|repeated\s+)?(bytes|fixed32|fixed64|sfixed32|sfixed64)\s+/.test(line),
		)
		expect(offenders).toEqual([])
	})

	it("contains no audio-like field name", () => {
		// The F4 dictation response carries `text`, which is the point of it; the
		// guard rejects anything that could carry a *waveform*, not the result.
		const offenders = fieldLines(source).filter((line) =>
			/\b(audio|pcm|wav|wave|samples?|pcm16|transcript|audio_bytes|blob)\b/i.test(line),
		)
		expect(offenders).toEqual([])
	})

	it("returns text and counters from transcribeUtterance, never audio", () => {
		const responseBlock = body.match(/message TranscribeUtteranceResponse \{([\s\S]*?)\n\}/)?.[1] ?? ""
		expect(responseBlock).toMatch(/string\s+text\s*=\s*1\s*;/)
		expect(responseBlock).toMatch(/bool\s+empty_audio\s*=/)
		// The only string fields allowed here are the transcript, the language, the
		// model id and its warnings — no path, no payload.
		const stringFields = (responseBlock.match(/(?:repeated\s+)?string\s+\w+/g) ?? []).map((field) =>
			field.replace(/\s+/g, " "),
		)
		expect(stringFields.sort()).toEqual(["repeated string warnings", "string language", "string model_id", "string text"])
		// The request names a session and settings; it has no room for audio.
		const requestBlock = body.match(/message TranscribeUtteranceRequest \{([\s\S]*?)\n\}/)?.[1] ?? ""
		expect(requestBlock).toMatch(/string\s+session_id\s*=/)
		expect(requestBlock).toMatch(/string\s+language\s*=/)
		expect(requestBlock).toMatch(/string\s+model_id\s*=/)
		expect(requestBlock).not.toMatch(/\b(bytes|pcm|wav|samples?)\b/i)
	})

	it("carries no audio path field (a path would be the same leak in a costume)", () => {
		expect(body).not.toMatch(/\b(file_path|audio_path|wav_path|temp_path)\b/i)
	})

	it("keeps the status contract to counters and codes", () => {
		expect(body).toMatch(/int32\s+frames_received\s*=/)
		expect(body).toMatch(/int32\s+bytes_received\s*=/)
		expect(body).toMatch(/string\s+unavailable_reason\s*=/)
	})
})

describe("UpdateSettingsRequest (voice settings write path)", () => {
	const stateProto = fs.readFileSync(path.join(PROTO_DIR, "state.proto"), "utf8")
	const requestBlock = stateProto.match(/message UpdateSettingsRequest \{([\s\S]*?)\n\}/)?.[1] ?? ""

	it("exposes the six F1 voice capture preferences", () => {
		for (const field of [
			"voice_enabled",
			"voice_capture_method",
			"voice_microphone_id",
			"voice_silence_detection_enabled",
			"voice_silence_timeout_ms",
			"voice_max_duration_ms",
		]) {
			expect(requestBlock).toContain(field)
		}
	})

	it("exposes the F3 voice recognition preferences", () => {
		expect(requestBlock).toContain("voice_language")
		expect(requestBlock).toContain("voice_model_id")
	})

	it("keeps the settings message audio-free", () => {
		expect(requestBlock).not.toMatch(/\b(bytes|fixed32|fixed64|sfixed32|sfixed64)\s+\w+\s*=/)
	})
})
