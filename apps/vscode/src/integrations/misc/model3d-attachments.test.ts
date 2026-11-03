import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { summarizeModel3d } from "./model3d-attachments"

describe("summarizeModel3d", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "bytos-3d-"))
	})

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true })
	})

	function file(name: string, content: string | Buffer): string {
		const filePath = join(tempDir, name)
		writeFileSync(filePath, content)
		return filePath
	}

	it("summarizes OBJ geometry and materials", async () => {
		const filePath = file(
			"model.obj",
			["mtllib scene.mtl", "o Cube", "v 0 0 0", "v 2 0 0", "v 0 3 0", "v 0 0 4", "usemtl red", "f 1 2 3", "f 1 2 3 4"].join(
				"\n",
			),
		)

		const summary = await summarizeModel3d(filePath)

		expect(summary).toContain("format: OBJ")
		expect(summary).toContain("vertices: 4")
		expect(summary).toContain("triangles: 3")
		expect(summary).toContain("materials: red")
		expect(summary).toContain("material libraries: scene.mtl")
		expect(summary).toContain("size (2.000, 3.000, 4.000)")
	})

	it("summarizes ASCII STL triangles", async () => {
		const filePath = file(
			"model.stl",
			[
				"solid cube",
				"facet normal 0 0 1",
				"outer loop",
				"vertex 0 0 0",
				"vertex 1 0 0",
				"vertex 0 1 0",
				"endloop",
				"endfacet",
				"endsolid cube",
			].join("\n"),
		)

		const summary = await summarizeModel3d(filePath)

		expect(summary).toContain("format: STL (ASCII)")
		expect(summary).toContain("triangles: 1")
		expect(summary).toContain("size (1.000, 1.000, 0.000)")
	})

	it("summarizes binary STL headers and bounds", async () => {
		const buffer = Buffer.alloc(84 + 50)
		buffer.writeUInt32LE(1, 80)
		const vertexOffset = 84 + 12
		const vertices = [
			[0, 0, 0],
			[2, 0, 0],
			[0, 3, 0],
		]
		for (const [index, vertex] of vertices.entries()) {
			const base = vertexOffset + index * 12
			buffer.writeFloatLE(vertex[0], base)
			buffer.writeFloatLE(vertex[1], base + 4)
			buffer.writeFloatLE(vertex[2], base + 8)
		}
		const filePath = file("model-binary.stl", buffer)

		const summary = await summarizeModel3d(filePath)

		expect(summary).toContain("format: STL (binary)")
		expect(summary).toContain("triangles: 1")
		expect(summary).toContain("size (2.000, 3.000, 0.000)")
	})

	it("summarizes PLY headers", async () => {
		const filePath = file(
			"model.ply",
			["ply", "format ascii 1.0", "element vertex 8", "element face 6", "end_header", "0 0 0"].join("\n"),
		)

		const summary = await summarizeModel3d(filePath)

		expect(summary).toContain("format: PLY")
		expect(summary).toContain("vertices: 8")
		expect(summary).toContain("faces: 6")
	})

	it("summarizes glTF JSON scenes, triangles and bounds", async () => {
		const gltf = {
			asset: { version: "2.0" },
			nodes: [{ name: "root" }],
			meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
			materials: [{ name: "steel" }],
			textures: [{}],
			images: [{}],
			animations: [{ name: "spin", channels: [], samplers: [] }],
			accessors: [{ count: 4, min: [0, 0, 0], max: [1, 2, 3] }, { count: 6 }],
			buffers: [{ byteLength: 100 }],
		}
		const filePath = file("scene.gltf", JSON.stringify(gltf))

		const summary = await summarizeModel3d(filePath)

		expect(summary).toContain("format: glTF (.gltf JSON)")
		expect(summary).toContain("triangles: 2")
		expect(summary).toContain("materials: 1 (steel)")
		expect(summary).toContain("animations: 1 (spin)")
		expect(summary).toContain("size (1.000, 2.000, 3.000)")
	})

	it("summarizes the JSON chunk of a GLB", async () => {
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
		const filePath = file("scene.glb", buffer)

		const summary = await summarizeModel3d(filePath)

		expect(summary).toContain("format: GLB (version 2)")
		expect(summary).toContain("triangles: 1")
		expect(summary).toContain("embedded binary chunk")
	})

	it("summarizes COLLADA element counts", async () => {
		const filePath = file(
			"scene.dae",
			[
				"<COLLADA>",
				"<geometry></geometry>",
				"<geometry></geometry>",
				"<node></node>",
				"<material></material>",
				"<animation></animation>",
				"</COLLADA>",
			].join("\n"),
		)

		const summary = await summarizeModel3d(filePath)

		expect(summary).toContain("format: COLLADA (.dae)")
		expect(summary).toContain("geometries: 2")
		expect(summary).toContain("nodes: 1")
		expect(summary).toContain("animations: 1")
	})

	it("rejects binary formats that belong to the converter phase", async () => {
		const filePath = file("scene.fbx", Buffer.from([0, 1, 2, 3]))

		await expect(summarizeModel3d(filePath)).rejects.toThrow(/not supported yet/i)
	})
})
