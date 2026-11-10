import * as fs from "node:fs/promises"
import * as path from "node:path"

export interface WorkspacePathOptions {
	/**
	 * Allow a path outside the workspace. This must only be set after an
	 * explicit, per-operation user authorization; it is false by default.
	 */
	allowOutsideWorkspace?: boolean
}

function isWithin(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate)
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	)
}

/**
 * Resolve the real location of a path, walking up to the nearest existing
 * ancestor for paths that do not exist yet (for example a new file).
 */
async function realpathNearest(target: string): Promise<string> {
	let current = target
	const missing: string[] = []
	for (;;) {
		try {
			const real = await fs.realpath(current)
			return path.join(real, ...missing.reverse())
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code !== "ENOENT" && code !== "ENOTDIR") {
				throw error
			}
			const parent = path.dirname(current)
			if (parent === current) {
				return target
			}
			missing.push(path.basename(current))
			current = parent
		}
	}
}

/**
 * Resolve a user/model-provided path against the active workspace and reject
 * anything that escapes it after normalization and symlink resolution.
 *
 * This is the single validation point used by the file tools. It handles
 * relative paths, absolute paths, `..` traversal, Windows drive paths, UNC
 * paths, and symlinks/junctions whose real target is outside the workspace.
 */
export async function resolveWorkspacePath(
	workspaceRoot: string,
	inputPath: string,
	options: WorkspacePathOptions = {},
): Promise<string> {
	if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
		throw new Error("A valid workspace root is required for file operations.")
	}
	if (!inputPath || inputPath.includes("\0")) {
		throw new Error("A valid file path is required.")
	}

	const root = await fs
		.realpath(workspaceRoot)
		.catch(() => path.resolve(workspaceRoot))
	const resolved = path.isAbsolute(inputPath)
		? path.normalize(inputPath)
		: path.resolve(root, inputPath)

	// Reject obvious lexical escapes before touching the filesystem. This is
	// not the authorization decision (realpath below is), but it avoids
	// resolving arbitrary network/UNC targets and gives a stable error even
	// when the target cannot be reached.
	if (!options.allowOutsideWorkspace && !isWithin(root, resolved)) {
		throw new Error(`Path is outside the workspace: ${inputPath}`)
	}

	const real = await realpathNearest(resolved)

	if (!options.allowOutsideWorkspace && !isWithin(root, real)) {
		throw new Error(`Path is outside the workspace: ${inputPath}`)
	}
	return real
}

export { isWithin as isPathInsideWorkspace }
