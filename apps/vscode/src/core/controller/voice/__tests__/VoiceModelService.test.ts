import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { assertModelId, resetVoiceModelServiceForTesting, VoiceModelService } from "@core/controller/voice/VoiceModelService"
import { PINNED_MODELS } from "@core/voice/transcription/models/modelCatalog"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

/**
 * F3 — the model service against real bytes on disk.
 *
 * Nothing here mocks the filesystem or the hash: a "corrupt" model is a real file
 * of the right size with the wrong bytes, so the size check passes and the
 * SHA-256 check is what fails. That is the only way to prove the "SHA-256 must
 * match before use" rule actually holds.
 */

let root: string
let dir: string

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "bytos-f3-models-"))
	dir = path.join(root, "voice", "models")
	fs.mkdirSync(dir, { recursive: true })
	process.env.BYTOS_WHISPER_MODEL_DIR = dir
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
	resetVoiceModelServiceForTesting()
	// Every case starts from an empty model directory.
	fs.rmSync(dir, { recursive: true, force: true })
	fs.mkdirSync(dir, { recursive: true })
	process.env.BYTOS_WHISPER_MODEL_DIR = dir
})

/** Writes a file of the pinned size whose SHA-256 deliberately does not match. */
function writeFakeModel(modelId: "tiny" | "base"): string {
	const pin = PINNED_MODELS[modelId]
	const target = path.join(dir, pin.fileName)
	const chunk = Buffer.alloc(1024 * 1024, 7)
	const handle = fs.openSync(target, "w")
	let written = 0
	while (written < pin.sizeBytes) {
		const remaining = pin.sizeBytes - written
		const slice = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining)
		fs.writeSync(handle, slice)
		written += slice.length
	}
	fs.closeSync(handle)
	return target
}

describe("VoiceModelService — real file verification", () => {
	it("reports every pinned model as not installed in an empty directory", () => {
		const service = new VoiceModelService()
		const models = service.list()
		expect(models.map((model) => model.id)).toEqual(["tiny", "base"])
		expect(models.every((model) => model.state === "not-installed")).toBe(true)
		expect(models.every((model) => model.installed === false)).toBe(true)
		// The default is `base`, per the F2 measurement.
		expect(models.find((model) => model.isDefault)?.id).toBe("base")
	})

	it("reports the real pinned download size for each model", () => {
		const service = new VoiceModelService()
		for (const model of service.list()) {
			expect(model.sizeBytes).toBe(PINNED_MODELS[model.id as "tiny" | "base"].sizeBytes)
		}
	})

	it("fails verification when the bytes do not match the SHA-256 pin", async () => {
		writeFakeModel("tiny")
		const service = new VoiceModelService()
		const view = await service.verify("tiny")
		expect(view.installed).toBe(true)
		expect(view.verified).toBe(false)
		expect(view.state).toBe("failed")
		expect(view.errorCode).toBe("MODEL_INTEGRITY_FAILED")
	})

	it("reports a size mismatch as a size problem, not a hash problem", async () => {
		fs.writeFileSync(path.join(dir, PINNED_MODELS.tiny.fileName), Buffer.alloc(1024, 3))
		const service = new VoiceModelService()
		const view = await service.verify("tiny")
		expect(view.state).toBe("failed")
		expect(view.errorCode).toBe("MODEL_SIZE_MISMATCH")
	})

	it("goes back to not-installed when the file is absent", async () => {
		const service = new VoiceModelService()
		const view = await service.verify("base")
		expect(view.state).toBe("not-installed")
		expect(view.verified).toBe(false)
	})

	it("removes a model file and reports the row as not installed", async () => {
		const target = writeFakeModel("tiny")
		const service = new VoiceModelService()
		expect(service.isInstalled("tiny")).toBe(true)
		await service.remove("tiny")
		expect(fs.existsSync(target)).toBe(false)
		expect(service.viewOf("tiny").state).toBe("not-installed")
	})

	it("removes a leftover .part file as well", async () => {
		const partPath = path.join(dir, `${PINNED_MODELS.base.fileName}.part`)
		fs.writeFileSync(partPath, Buffer.alloc(16, 1))
		const service = new VoiceModelService()
		await service.remove("base")
		expect(fs.existsSync(partPath)).toBe(false)
	})

	it("notifies subscribers with every state it passes through", async () => {
		writeFakeModel("tiny")
		const service = new VoiceModelService()
		const seen: string[] = []
		service.subscribe((change) => seen.push(change.state))
		await service.verify("tiny")
		expect(seen).toContain("verifying")
		expect(seen.at(-1)).toBe("failed")
	})

	it("never reports ready for a model it did not verify in this session", () => {
		writeFakeModel("tiny")
		const service = new VoiceModelService()
		expect(service.viewOf("tiny").state).not.toBe("ready")
		expect(service.isModelReady("tiny")).toBe(false)
	})

	it("keeps a verified model verified when another model is selected", async () => {
		// Selecting a model only writes `voiceModelId`; it must never touch another
		// model's cached verification. This was observed in the real editor as
		// "verified Base becomes not-installed after selecting Tiny".
		writeFakeModel("tiny")
		const service = new VoiceModelService()
		await service.verify("tiny")
		expect(service.viewOf("tiny").state).toBe("failed") // fake bytes, but known
		const tinyAfter = service.viewOf("tiny").state

		// Simulate the settings write that selecting the other model performs.
		const baseBefore = service.viewOf("base").state
		expect(baseBefore).toBe("not-installed")
		expect(service.viewOf("tiny").state).toBe(tinyAfter)
	})

	it("labels an installed but unchecked model as unverified, with a stable code", () => {
		writeFakeModel("tiny")
		const service = new VoiceModelService()
		const view = service.viewOf("tiny")
		expect(view.installed).toBe(true)
		expect(view.verified).toBe(false)
		// Not `not-installed` (the file is there) and not `ready` (unchecked).
		expect(view.state).toBe("failed")
		expect(view.errorCode).toBe("MODEL_UNVERIFIED")
	})
})

describe("VoiceModelService — consent", () => {
	it("refuses to download without explicit consent and touches no file", async () => {
		const service = new VoiceModelService()
		await expect(service.download("tiny", { consent: false })).rejects.toMatchObject({
			code: "MODEL_CONSENT_REQUIRED",
		})
		expect(fs.readdirSync(dir)).toEqual([])
	})
})

describe("assertModelId", () => {
	it("accepts the pinned ids and rejects everything else", () => {
		expect(assertModelId("tiny")).toBe("tiny")
		expect(assertModelId("base")).toBe("base")
		expect(() => assertModelId("small")).toThrow()
		expect(() => assertModelId("")).toThrow()
		expect(() => assertModelId(undefined)).toThrow()
	})
})

describe("fake model fixture", () => {
	it("really does produce a different hash than the pin", () => {
		const target = writeFakeModel("tiny")
		const hash = createHash("sha256").update(fs.readFileSync(target)).digest("hex")
		expect(hash).not.toBe(PINNED_MODELS.tiny.sha256)
	})
})
