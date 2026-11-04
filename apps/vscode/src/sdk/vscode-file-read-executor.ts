/*
 * Copyright 2026 Cline Bot Inc.
 * Bytos modifications Copyright 2026 Bytos contributors.
 *
 * Modified from the Cline project (https://github.com/cline/cline), Apache-2.0.
 * Changes by Bytos: failed file reads that target a path outside the workspace
 * boundary are rejected before the host is asked to read the file.
 * See NOTICE and apps/vscode/THIRD-PARTY-NOTICES.txt.
 */

import { createDefaultExecutors, resolveWorkspacePath, type ToolExecutors } from "@bytos/core"

type FileReadExecutor = NonNullable<ToolExecutors["readFile"]>

/**
 * `read_files` executor override that resolves relative paths against the workspace
 * root before delegating to the SDK's built-in file reader.
 *
 * The built-in executor resolves relative paths against `process.cwd()`, which in a
 * VS Code extension host is usually "/" — not the workspace — so every relative-path
 * read failed with ENOENT and pushed the model into terminal fallbacks. The terminal
 * and editor tools already run against the workspace root; this makes reads match.
 */
export function createWorkspaceFileReadExecutor(getWorkspaceRoot: () => Promise<string>): FileReadExecutor {
	const readFile = createDefaultExecutors().readFile
	if (!readFile) {
		throw new Error("SDK default executors did not provide a readFile executor")
	}
	return async (request, context) => {
		if (request.path.startsWith("bytos://cache/")) {
			return readFile(request, context)
		}
		const workspaceRoot = await getWorkspaceRoot()
		const resolvedPath = await resolveWorkspacePath(workspaceRoot, request.path)
		return readFile({ ...request, path: resolvedPath }, { ...context, cwd: workspaceRoot })
	}
}
