import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import * as path from "node:path"

/**
 * SHA-256 verification (F2, TD-8).
 *
 * A file is accepted only when BOTH its size and its SHA-256 match the pinned
 * values. Size is checked first because it is free and catches the common case of
 * a truncated download or a placeholder file; the hash check is then the real
 * gate. Hashing is streamed so a 148 MB model never has to be held in memory.
 *
 * Nothing in this module trusts upstream metadata, HTTP headers, or the file
 * name. The only inputs are the bytes on disk and the pin table.
 */

export interface VerifyExpectation {
	fileName: string
	sizeBytes: number
	sha256: string
}

export type VerifyFailure = "MODEL_FILE_MISSING" | "MODEL_SIZE_MISMATCH" | "MODEL_INTEGRITY_FAILED"

export interface VerifyResult {
	ok: boolean
	path: string
	actualSize?: number
	actualSha256?: string
	failure?: VerifyFailure
	/** Short, non-audio diagnostic detail. */
	detail?: string
}

/** Streams a file and returns its lowercase hex SHA-256. */
export async function sha256File(path: string): Promise<string> {
	const hash = createHash("sha256")
	await new Promise<void>((resolve, reject) => {
		const stream = createReadStream(path)
		stream.on("error", reject)
		stream.on("data", (chunk) => hash.update(chunk))
		stream.on("end", () => resolve())
	})
	return hash.digest("hex")
}

/**
 * Verifies one file against an expectation. Never throws: every failure is
 * reported as data so callers can map it to their own typed error code (the
 * binary and the model use different codes for the same conditions).
 */
export async function verifyFile(path: string, expectation: VerifyExpectation): Promise<VerifyResult> {
	let actualSize: number
	try {
		actualSize = (await stat(path)).size
	} catch {
		return { ok: false, path, failure: "MODEL_FILE_MISSING", detail: `${expectation.fileName} is missing` }
	}
	if (actualSize !== expectation.sizeBytes) {
		return {
			ok: false,
			path,
			actualSize,
			failure: "MODEL_SIZE_MISMATCH",
			detail: `${expectation.fileName}: expected ${expectation.sizeBytes} bytes, found ${actualSize}`,
		}
	}
	let actualSha256: string
	try {
		actualSha256 = await sha256File(path)
	} catch {
		return { ok: false, path, actualSize, failure: "MODEL_FILE_MISSING", detail: `${expectation.fileName} is unreadable` }
	}
	if (actualSha256.toLowerCase() !== expectation.sha256.toLowerCase()) {
		return {
			ok: false,
			path,
			actualSize,
			actualSha256,
			failure: "MODEL_INTEGRITY_FAILED",
			detail: `${expectation.fileName}: SHA-256 mismatch`,
		}
	}
	return { ok: true, path, actualSize, actualSha256 }
}

/** Verifies a whole set, returning per-file results in pin-table order. */
export async function verifyFileSet(
	dir: string,
	expectations: readonly VerifyExpectation[],
): Promise<{ ok: boolean; results: VerifyResult[] }> {
	const results: VerifyResult[] = []
	for (const expectation of expectations) {
		results.push(await verifyFile(path.join(dir, expectation.fileName), expectation))
	}
	return { ok: results.every((result) => result.ok), results }
}
