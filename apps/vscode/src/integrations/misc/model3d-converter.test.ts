import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { describeConverterRequirement, detectModel3dToolchain, type RunCommand, summarizeModel3dAsset } from "./model3d-converter"

function commandError(code: string): NodeJS.ErrnoException {
	const error = new Error(code) as NodeJS.ErrnoException
	error.code = code
	return error
}

function createGlbBuffer(): Buffer {
	const json = JSON.stringify({
		asset: { version: "2.0" },
		nodes: [{ name: "root" }],
		meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
		accessors: [{ count: 3, min: [0, 0, 0], max: [1, 1, 1] }],
	})
	const jsonBuffer = Buffer.from(json, "utf8")
	const paddedLength = Math.ceil(jsonBuffer.length / 4) * 4
	const buffer = Buffer.alloc(20 + paddedLength)
	buffer.writeUInt32LE(0x46546c67, 0)
	buffer.writeUInt32LE(2, 4)
	buffer.writeUInt32LE(buffer.length, 8)
	buffer.writeUInt32LE(paddedLength, 12)
	buffer.writeUInt32LE(0x4e4f534a, 16)
	jsonBuffer.copy(buffer, 20)
	buffer.fill(0x20, 20 + jsonBuffer.length)
	return buffer
}

describe("detectModel3dToolchain", () => {
	it("reports missing tools", async () => {
		const run: RunCommand = async () => {
			throw commandError("ENOENT")
		}

		await expect(detectModel3dToolchain(run)).resolves.toEqual({
			blender: false,
			assimp: false,
			freecad: false,
			dwg2dxf: false,
		})
	})

	it("detects Blender and LibreDWG", async () => {
		const run: RunCommand = async (command) => {
			if (command === "blender" || command === "dwg2dxf") {
				return { stdout: "ok", stderr: "" }
			}
			throw commandError("ENOENT")
		}

		await expect(detectModel3dToolchain(run)).resolves.toEqual({
			blender: true,
			assimp: false,
			freecad: false,
			dwg2dxf: true,
		})
	})
})

describe("summarizeModel3dAsset", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "bytos-3d-convert-test-"))
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	function file(name: string, content: string | Buffer): string {
		const filePath = join(tempDir, name)
		writeFileSync(filePath, content)
		return filePath
	}

	it("summarizes DXF and Unity assets without external tools", async () => {
		const dxfPath = file("drawing.dxf", ["0", "SECTION", "0", "LINE", "0", "CIRCLE", "0", "LAYER", "0", "ENDSEC"].join("\n"))
		const unityPath = file(
			"scene.unity",
			["--- !u!1 &1", "GameObject:", "--- !u!4 &2", "Transform:", "--- !u!33 &3", "MeshFilter:"].join("\n"),
		)

		await expect(summarizeModel3dAsset(dxfPath)).resolves.toContain("format: DXF")
		await expect(summarizeModel3dAsset(unityPath)).resolves.toContain("format: Unity YAML asset")
	})

	it("throws a clear error for Unreal assets", async () => {
		const assetPath = file("asset.uasset", Buffer.from([0, 1, 2, 3]))

		await expect(summarizeModel3dAsset(assetPath)).rejects.toThrow(/Export the asset to glTF/)
	})

	it("requires a converter when Blender/Assimp are absent", async () => {
		const fbxPath = file("model.fbx", Buffer.from([0, 1, 2, 3]))
		const run: RunCommand = async () => {
			throw commandError("ENOENT")
		}

		await expect(summarizeModel3dAsset(fbxPath, { run })).rejects.toThrow(/Blender \(headless\) or Assimp/)
	})

	it("converts FBX with Blender and summarizes the resulting GLB", async () => {
		const fbxPath = file("model.fbx", Buffer.from([0, 1, 2, 3]))
		const run: RunCommand = async (command, args) => {
			if (command === "blender" && args[0] === "--version") {
				return { stdout: "Blender 4", stderr: "" }
			}
			if (command === "blender") {
				const outputPath = args[args.length - 1]
				await import("node:fs/promises").then((fs) => fs.writeFile(outputPath, createGlbBuffer()))
				return { stdout: "", stderr: "" }
			}
			throw commandError("ENOENT")
		}

		const summary = await summarizeModel3dAsset(fbxPath, { run })

		expect(summary).toContain("format: GLB (version 2)")
		expect(summary).toContain("triangles: 1")
	})
})

describe("describeConverterRequirement", () => {
	it("names the per-format toolchain", () => {
		expect(describeConverterRequirement("dwg")).toContain("LibreDWG")
		expect(describeConverterRequirement("step")).toContain("FreeCADCmd")
		expect(describeConverterRequirement("uasset")).toContain("Unreal")
		expect(describeConverterRequirement("fbx")).toContain("Blender")
	})
})
