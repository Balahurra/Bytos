import type { GrpcRequest } from "@/shared/WebviewMessage"

/**
 * Recorder / logging / telemetry isolation for the voice feature (F1, T1).
 *
 * The gRPC recorder persists every request it sees — including the request
 * message body — into `tests/specs/grpc_recorded_session_*.json`. If a voice
 * request ever carried audio (or a path to an audio file), that recorder would
 * write it to disk. The F0 audit confirmed the leak mechanism; this predicate
 * retires it in product code.
 *
 * Rules it enforces, in order:
 *  1. Every `bytos.VoiceService` RPC is excluded, whatever its payload.
 *  2. Any request carrying an audio-like field, on *any* service, is excluded.
 *     `GrpcRequest.message` is `any`, so such a field can appear anywhere; the
 *     check is defence in depth, not a duplicate of rule 1.
 *
 * The filter is SAFE BY DEFAULT: it is registered unconditionally in
 * `GrpcRecorderBuilder.getRecorder()`, not behind an opt-in env flag, so a
 * future recorder build cannot silently start capturing voice traffic.
 */

export const VOICE_SERVICE_NAME = "bytos.VoiceService"

/**
 * Field names that mean "this request may hold audio". Matched case-insensitively
 * against object keys; a single hit anywhere in the payload excludes the request.
 */
const AUDIO_FIELD_PATTERN = /(audio|pcm|wav|wave|sample|transcript|utterance|microphone_data|micdata)/i

/**
 * A raw audio byte container is easy to spot: any ArrayBuffer/view, Node Buffer
 * or a string that looks like a long base64 payload.
 */
function isByteContainer(value: unknown): boolean {
	if (value == null) return false
	if (value instanceof ArrayBuffer) return true
	if (ArrayBuffer.isView(value)) return true
	if (typeof value === "string") {
		// A long base64/hex blob is not a legitimate control field. Real prompts and
		// settings values contain spaces, punctuation or are simply short, so the
		// alphabet check keeps ordinary text out of this branch.
		return value.length > 512 && !/\s/.test(value) && /^[A-Za-z0-9+/=]+$/.test(value)
	}
	return false
}

function safeParseMessage(message: unknown): unknown {
	if (typeof message !== "string") {
		return message
	}
	try {
		return JSON.parse(message)
	} catch {
		return message
	}
}

/**
 * Walks a parsed request body looking for an audio-like field name or a raw byte
 * container. Bounded in depth and visited-node count so a hostile/cyclic payload
 * cannot hang the recorder path.
 */
export function carriesAudioFields(value: unknown, maxDepth = 8, maxNodes = 2000): boolean {
	let visited = 0
	const seen = new WeakSet<object>()

	const walk = (node: unknown, depth: number): boolean => {
		if (node == null || depth > maxDepth) return false
		if (++visited > maxNodes) return false
		if (isByteContainer(node)) return true
		if (typeof node !== "object") return false
		if (seen.has(node as object)) return false
		seen.add(node as object)

		if (Array.isArray(node)) {
			for (const item of node) {
				if (walk(item, depth + 1)) return true
			}
			return false
		}

		for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
			if (AUDIO_FIELD_PATTERN.test(key)) return true
			if (walk(child, depth + 1)) return true
		}
		return false
	}

	return walk(value, 0)
}

/**
 * `GrpcRequestFilter` registered on every recorder build. Returns true when the
 * request must NOT be recorded.
 */
export function isVoiceRequest(request: GrpcRequest): boolean {
	if (!request) return false
	if (request.service === VOICE_SERVICE_NAME) return true
	return carriesAudioFields(safeParseMessage(request.message))
}
