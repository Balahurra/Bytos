import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveWorkspacePath } from "./path-safety"

let root: string
let outside: string

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-path-root-"))
	outside = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-path-outside-"))
})

afterEach(async () => {
	await fs.rm(root, { recursive: true, force: true })
	await fs.rm(outside, { recursive: true, force: true })
})

describe("resolveWorkspacePath", () => {
	it("resolves a relative path inside the workspace", async () => {
		const file = path.join(root, "src", "index.ts")
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, "x")
		await expect(resolveWorkspacePath(root, "src/index.ts")).resolves.toBe(
			await fs.realpath(file),
		)
	})

	it("resolves a new file inside the workspace", async () => {
		const resolved = await resolveWorkspacePath(root, "new/deep/file.ts")
		expect(resolved.startsWith(await fs.realpath(root))).toBe(true)
	})

	it("rejects relative traversal", async () => {
		await expect(resolveWorkspacePath(root, "../outside.txt")).rejects.toThrow(
			/outside the workspace/i,
		)
	})

	it("rejects an absolute path outside the workspace", async () => {
		await expect(
			resolveWorkspacePath(root, path.join(outside, "secret.txt")),
		).rejects.toThrow(/outside the workspace/i)
	})

	it("accepts an absolute path inside the workspace", async () => {
		const file = path.join(root, "inside.txt")
		await fs.writeFile(file, "x")
		await expect(resolveWorkspacePath(root, file)).resolves.toBe(
			await fs.realpath(file),
		)
	})

	it("rejects a symlink whose target is outside the workspace", async () => {
		const target = path.join(outside, "target.txt")
		await fs.writeFile(target, "secret")
		const link = path.join(root, "link.txt")
		try {
			await fs.symlink(target, link)
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === "EPERM" || code === "EACCES") {
				// Windows without Developer Mode; symlink creation is unavailable.
				return
			}
			throw error
		}
		await expect(resolveWorkspacePath(root, "link.txt")).rejects.toThrow(
			/outside the workspace/i,
		)
	})

	it("rejects NUL bytes", async () => {
		await expect(resolveWorkspacePath(root, "bad\0name")).rejects.toThrow(
			/valid file path/i,
		)
	})

	it("rejects Windows drive paths outside the workspace", async () => {
		if (process.platform !== "win32") {
			return
		}
		const otherDrive = path.join("D:\\", "bytos-outside", "secret.txt")
		await expect(resolveWorkspacePath(root, otherDrive)).rejects.toThrow(
			/outside the workspace/i,
		)
	})

	it("rejects UNC paths outside the workspace", async () => {
		if (process.platform !== "win32") {
			return
		}
		await expect(
			resolveWorkspacePath(root, "\\\\server\\share\\secret.txt"),
		).rejects.toThrow(/outside the workspace/i)
	})

	it("accepts a differently-cased path inside the workspace on Windows", async () => {
		if (process.platform !== "win32") {
			return
		}
		const file = path.join(root, "CaseSensitive.txt")
		await fs.writeFile(file, "x")
		await expect(resolveWorkspacePath(root, "casesensitive.TXT")).resolves.toBe(
			await fs.realpath(file),
		)
	})

	it("rejects a Windows junction whose target is outside the workspace", async () => {
		if (process.platform !== "win32") {
			return
		}
		const link = path.join(root, "junction-outside")
		try {
			await fs.symlink(outside, link, "junction")
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") {
				return
			}
			throw error
		}
		await expect(
			resolveWorkspacePath(root, "junction-outside"),
		).rejects.toThrow(/outside the workspace/i)
	})
})
