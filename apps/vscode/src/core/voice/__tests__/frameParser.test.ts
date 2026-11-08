import { type DecodedFrame, FRAME_HEADER_BYTES, FrameParser, payloadToInt16 } from "@core/voice/capture/frameParser"
import { describe, expect, it } from "vitest"

/** Builds one wire frame exactly as the native helper emits it. */
function encodeFrame(
	payload: Uint8Array,
	overrides: { formatTag?: number; sampleRate?: number; channels?: number; bits?: number } = {},
): Uint8Array {
	const header = new Uint8Array(FRAME_HEADER_BYTES)
	const view = new DataView(header.buffer)
	view.setUint32(0, payload.length, true)
	view.setUint16(4, overrides.formatTag ?? 1, true)
	view.setUint32(6, overrides.sampleRate ?? 16000, true)
	view.setUint16(10, overrides.channels ?? 1, true)
	view.setUint16(12, overrides.bits ?? 16, true)
	const frame = new Uint8Array(header.length + payload.length)
	frame.set(header, 0)
	frame.set(payload, header.length)
	return frame
}

function pcmPayload(samples: number): Uint8Array {
	const payload = new Uint8Array(samples * 2)
	const view = new DataView(payload.buffer)
	for (let i = 0; i < samples; i++) {
		view.setInt16(i * 2, (i % 100) - 50, true)
	}
	return payload
}

function collect(): { frames: DecodedFrame[]; errors: string[]; parser: FrameParser } {
	const frames: DecodedFrame[] = []
	const errors: string[] = []
	const parser = new FrameParser({
		onFrame: (frame) => frames.push(frame),
		onError: (code) => errors.push(code),
	})
	return { frames, errors, parser }
}

function concat(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0)
	const merged = new Uint8Array(total)
	let offset = 0
	for (const part of parts) {
		merged.set(part, offset)
		offset += part.length
	}
	return merged
}

describe("FrameParser", () => {
	it("decodes one frame delivered in a single chunk", () => {
		const { frames, parser } = collect()
		parser.push(encodeFrame(pcmPayload(160)))
		expect(frames).toHaveLength(1)
		expect(frames[0].sampleRate).toBe(16000)
		expect(frames[0].channels).toBe(1)
		expect(frames[0].payload.length).toBe(320)
	})

	it("handles several frames in one chunk", () => {
		const { frames, parser } = collect()
		parser.push(concat([encodeFrame(pcmPayload(10)), encodeFrame(pcmPayload(20)), encodeFrame(pcmPayload(30))]))
		expect(frames.map((frame) => frame.payload.length)).toEqual([20, 40, 60])
	})

	it("handles a frame split across chunks (including mid-header)", () => {
		const { frames, parser } = collect()
		const wire = encodeFrame(pcmPayload(50))
		parser.push(wire.subarray(0, 3))
		expect(frames).toHaveLength(0)
		parser.push(wire.subarray(3, 100))
		expect(frames).toHaveLength(0)
		parser.push(wire.subarray(100))
		expect(frames).toHaveLength(1)
		expect(frames[0].payload.length).toBe(100)
	})

	it("reassembles byte-identical audio at 1000 random chunk boundaries", () => {
		const reference = pcmPayload(5000)
		const wire = concat([encodeFrame(reference), encodeFrame(reference)])
		const { frames, parser } = collect()

		let seed = 1337
		const random = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff
			return seed / 0x7fffffff
		}
		let offset = 0
		while (offset < wire.length) {
			const size = 1 + Math.floor(random() * 97)
			parser.push(wire.subarray(offset, Math.min(offset + size, wire.length)))
			offset += size
		}

		expect(frames).toHaveLength(2)
		expect(Array.from(frames[0].payload)).toEqual(Array.from(reference))
		expect(Array.from(frames[1].payload)).toEqual(Array.from(reference))
	})

	it("rejects an absurd length without throwing or allocating", () => {
		const { frames, errors, parser } = collect()
		const header = new Uint8Array(FRAME_HEADER_BYTES)
		new DataView(header.buffer).setUint32(0, 0xffffffff, true)
		expect(() => parser.push(header)).not.toThrow()
		expect(frames).toHaveLength(0)
		expect(errors).toContain("CAPTURE_FRAME_TOO_LARGE")
		expect(parser.bufferedBytes).toBe(0)
	})

	it("skips a corrupt frame (wrong format) and keeps decoding", () => {
		const { frames, errors, parser } = collect()
		parser.push(concat([encodeFrame(pcmPayload(10), { formatTag: 3 }), encodeFrame(pcmPayload(10))]))
		expect(errors).toContain("CAPTURE_FRAME_CORRUPT")
		expect(frames).toHaveLength(1)
	})

	it("rejects a payload that is not a whole number of samples", () => {
		const { frames, errors, parser } = collect()
		parser.push(encodeFrame(new Uint8Array(3)))
		expect(errors).toContain("CAPTURE_FRAME_CORRUPT")
		expect(frames).toHaveLength(0)
	})

	it("converts a payload to PCM16 samples", () => {
		const payload = pcmPayload(4)
		const samples = payloadToInt16(payload)
		expect(samples.length).toBe(4)
		expect(samples[0]).toBe(-50)
		expect(samples[49 % 4]).toBeDefined()
	})

	it("reset() drops buffered bytes", () => {
		const { frames, parser } = collect()
		const wire = encodeFrame(pcmPayload(10))
		parser.push(wire.subarray(0, 5))
		expect(parser.bufferedBytes).toBe(5)
		parser.reset()
		expect(parser.bufferedBytes).toBe(0)
		expect(frames).toHaveLength(0)
	})
})
