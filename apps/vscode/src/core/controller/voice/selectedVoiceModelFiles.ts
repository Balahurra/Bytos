import { randomUUID } from "node:crypto"
import * as path from "node:path"

/**
 * Short-lived host-side store for the file the user picked in the custom-model
 * dialog.
 *
 * ProtoBus must not carry a filesystem path (`voiceProtoGuard.test.ts` enforces
 * it), so the webview receives a token and the host keeps the path in memory.
 * A token is single-use and expires, so a stale UI cannot add a file it did not
 * choose in this session.
 */

const TTL_MS = 10 * 60 * 1000

interface Selection {
	filePath: string
	fileName: string
	createdAt: number
}

const selections = new Map<string, Selection>()

function prune(now = Date.now()): void {
	for (const [token, selection] of selections) {
		if (now - selection.createdAt > TTL_MS) {
			selections.delete(token)
		}
	}
}

export function rememberSelectedModelFile(filePath: string): { token: string; fileName: string } {
	prune()
	const token = randomUUID()
	const fileName = path.basename(filePath)
	selections.set(token, { filePath, fileName, createdAt: Date.now() })
	return { token, fileName }
}

/** Resolves and consumes a token. Returns `undefined` when it is unknown/expired. */
export function takeSelectedModelFile(token: string): string | undefined {
	prune()
	const selection = selections.get(token)
	if (!selection) return undefined
	selections.delete(token)
	return selection.filePath
}

/** Test seam. */
export function clearSelectedModelFilesForTesting(): void {
	selections.clear()
}
