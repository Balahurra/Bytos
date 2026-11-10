import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { sha256File, verifyFile, verifyFileSet } from "../models/integrity"

/**
 * Integrity primitives. The point of these tests is that a *wrong byte* is
 * rejected — not merely that a right byte is accepted.
 */
let dir: string
const goodBytes = Buffer.from("b047os-integrity-fixture")
const goodHash = createHash("sha256").update(goodBytes).digest("hex")

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "bytos-f2-integrity-"))
})

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true })
})

describe("sha256File", () => {
	it("matches node:crypto for a real file", async () => {
		const file = path.join(dir, "hash-me.bin")
		fs.writeFileSync(file, goodBytes)
		expect(await sha256File(file)).toBe(goodHash)
	})

	it("hashes an empty file to the known empty digest", async () => {
		const file = path.join(dir, "empty.bin")
		fs.writeFileSync(file, Buffer.alloc(0))
		expect(await sha256File(file)).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
	})
})

describe("verifyFile", () => {
	it("accepts a file whose size and hash both match", async () => {
		const file = path.join(dir, "good.bin")
		fs.writeFileSync(file, goodBytes)
		const result = await verifyFile(file, {
			fileName: "good.bin",
			sizeBytes: goodBytes.length,
			sha256: goodHash,
		})
		expect(result.ok).toBe(true)
		expect(result.actualSha256).toBe(goodHash)
	})

	it("rejects a missing file", async () => {
		const result = await verifyFile(path.join(dir, "nope.bin"), {
			fileName: "nope.bin",
			sizeBytes: 10,
			sha256: goodHash,
		})
		expect(result.ok).toBe(false)
		expect(result.failure).toBe("MODEL_FILE_MISSING")
	})

	it("rejects a file with the right length but different bytes", async () => {
		// Same size, one byte different: only the hash can catch this.
		const tampered = Buffer.from(goodBytes)
		tampered[0] = tampered[0] ^ 0xff
		const file = path.join(dir, "tampered.bin")
		fs.writeFileSync(file, tampered)

		const result = await verifyFile(file, {
			fileName: "tampered.bin",
			sizeBytes: goodBytes.length,
			sha256: goodHash,
		})
		expect(result.ok).toBe(false)
		expect(result.failure).toBe("MODEL_INTEGRITY_FAILED")
		expect(result.actualSize).toBe(goodBytes.length)
		expect(result.actualSha256).not.toBe(goodHash)
	})

	it("rejects a truncated file on size before hashing", async () => {
		const file = path.join(dir, "short.bin")
		fs.writeFileSync(file, goodBytes.subarray(0, 5))
		const result = await verifyFile(file, {
			fileName: "short.bin",
			sizeBytes: goodBytes.length,
			sha256: goodHash,
		})
		expect(result.failure).toBe("MODEL_SIZE_MISMATCH")
	})

	it("rejects a file that is larger than pinned", async () => {
		const file = path.join(dir, "long.bin")
		fs.writeFileSync(file, Buffer.concat([goodBytes, Buffer.from("extra")]))
		const result = await verifyFile(file, {
			fileName: "long.bin",
			sizeBytes: goodBytes.length,
			sha256: goodHash,
		})
		expect(result.failure).toBe("MODEL_SIZE_MISMATCH")
	})

	it("compares hashes case-insensitively", async () => {
		const file = path.join(dir, "case.bin")
		fs.writeFileSync(file, goodBytes)
		const result = await verifyFile(file, {
			fileName: "case.bin",
			sizeBytes: goodBytes.length,
			sha256: goodHash.toUpperCase(),
		})
		expect(result.ok).toBe(true)
	})
})

describe("verifyFileSet", () => {
	it("reports one failure per bad member and still checks the rest", async () => {
		const setDir = path.join(dir, "set")
		fs.mkdirSync(setDir, { recursive: true })
		fs.writeFileSync(path.join(setDir, "a.bin"), goodBytes)
		fs.writeFileSync(path.join(setDir, "b.bin"), Buffer.from("different"))

		const { ok, results } = await verifyFileSet(setDir, [
			{ fileName: "a.bin", sizeBytes: goodBytes.length, sha256: goodHash },
			{ fileName: "b.bin", sizeBytes: goodBytes.length, sha256: goodHash },
		])
		expect(ok).toBe(false)
		expect(results).toHaveLength(2)
		expect(results[0].ok).toBe(true)
		expect(results[1].ok).toBe(false)
	})
})
