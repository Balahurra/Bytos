import fs from "node:fs/promises"
import path from "node:path"
import { ATTACHMENT_LIMITS } from "@shared/attachments"
import { truncateContent } from "@/shared/content-limits"
import { Logger } from "@/shared/services/Logger"

/**
 * Safe, bounded summaries for 3D assets that can be understood without a
 * renderer. Binary formats (BLEND/FBX/DWG/…) are intentionally rejected here;
 * the converter/preview phase will handle them out-of-process.
 */

const MAX_SOURCE_BYTES = ATTACHMENT_LIMITS.maxFileBytes
const MAX_BINARY_STL_BBOX_TRIANGLES = 200_000
const MAX_LISTED_NAMES = 25

type Json = Record<string, unknown>

interface Bounds {
	min: [number, number, number]
	max: [number, number, number]
}

function createBounds(): Bounds {
	return {
		min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
		max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
	}
}

function addPoint(bounds: Bounds, x: number, y: number, z: number): void {
	if (![x, y, z].every(Number.isFinite)) {
		return
	}
	bounds.min[0] = Math.min(bounds.min[0], x)
	bounds.min[1] = Math.min(bounds.min[1], y)
	bounds.min[2] = Math.min(bounds.min[2], z)
	bounds.max[0] = Math.max(bounds.max[0], x)
	bounds.max[1] = Math.max(bounds.max[1], y)
	bounds.max[2] = Math.max(bounds.max[2], z)
}

function hasBounds(bounds: Bounds): boolean {
	return Number.isFinite(bounds.min[0]) && Number.isFinite(bounds.max[0])
}

function formatNumber(value: number): string {
	return value.toFixed(3)
}

function formatBounds(bounds: Bounds): string {
	if (!hasBounds(bounds)) {
		return "not available"
	}
	const size: [number, number, number] = [
		bounds.max[0] - bounds.min[0],
		bounds.max[1] - bounds.min[1],
		bounds.max[2] - bounds.min[2],
	]
	return `min (${bounds.min.map(formatNumber).join(", ")}), max (${bounds.max
		.map(formatNumber)
		.join(", ")}), size (${size.map(formatNumber).join(", ")})`
}

function listNames(names: Iterable<string>): string {
	const unique = [...new Set([...names].filter(Boolean))]
	if (unique.length === 0) {
		return "none"
	}
	const shown = unique.slice(0, MAX_LISTED_NAMES)
	return `${shown.join(", ")}${unique.length > shown.length ? ` (+${unique.length - shown.length} more)` : ""}`
}

async function readSource(filePath: string, maxSourceBytes = MAX_SOURCE_BYTES): Promise<Buffer> {
	const stat = await fs.stat(filePath)
	if (!stat.isFile()) {
		throw new Error("Path is not a file.")
	}
	if (stat.size > maxSourceBytes) {
		throw new Error(`3D file is too large to summarize (limit ${maxSourceBytes} bytes).`)
	}
	return fs.readFile(filePath)
}

function assertText(buffer: Buffer, extension: string): string {
	if (buffer.includes(0)) {
		throw new Error(`Binary .${extension} files are not supported yet. Export to glTF/GLB/OBJ/STL.`)
	}
	return buffer.toString("utf8")
}

function summarizeObj(text: string, fileName: string): string {
	const bounds = createBounds()
	let vertices = 0
	let triangles = 0
	const objects = new Set<string>()
	const groups = new Set<string>()
	const materials = new Set<string>()
	const materialLibraries = new Set<string>()

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith("#")) {
			continue
		}
		if (line.startsWith("v ")) {
			const [x, y, z] = line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number)
			vertices += 1
			if (x !== undefined && y !== undefined && z !== undefined) {
				addPoint(bounds, x, y, z)
			}
		} else if (line.startsWith("f ")) {
			const corners = line.slice(2).trim().split(/\s+/).length
			triangles += Math.max(0, corners - 2)
		} else if (line.startsWith("o ")) {
			objects.add(line.slice(2).trim())
		} else if (line.startsWith("g ")) {
			groups.add(line.slice(2).trim())
		} else if (line.startsWith("usemtl ")) {
			materials.add(line.slice(7).trim())
		} else if (line.startsWith("mtllib ")) {
			for (const library of line.slice(7).trim().split(/\s+/)) {
				materialLibraries.add(library)
			}
		}
	}

	return [
		`[3D model summary: ${fileName}]`,
		"format: OBJ",
		`vertices: ${vertices}`,
		`triangles: ${triangles}`,
		`objects: ${objects.size}`,
		`groups: ${groups.size}`,
		`materials: ${listNames(materials)}`,
		`material libraries: ${listNames(materialLibraries)}`,
		`bounding box: ${formatBounds(bounds)}`,
	].join("\n")
}

function summarizeMtl(text: string, fileName: string): string {
	const materials = new Set<string>()
	let textureMaps = 0
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (line.startsWith("newmtl ")) {
			materials.add(line.slice(7).trim())
		} else if (/^(map_|bump|disp|decal|refl)/i.test(line)) {
			textureMaps += 1
		}
	}
	return [
		`[3D material summary: ${fileName}]`,
		"format: MTL",
		`materials: ${listNames(materials)}`,
		`texture map entries: ${textureMaps}`,
	].join("\n")
}

function summarizeAsciiStl(text: string, fileName: string): { triangles: number; bounds: Bounds } {
	const bounds = createBounds()
	let triangles = 0
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim().toLowerCase()
		if (line.startsWith("facet normal")) {
			triangles += 1
		} else if (line.startsWith("vertex ")) {
			const [x, y, z] = line.slice(7).trim().split(/\s+/).slice(0, 3).map(Number)
			if (x !== undefined && y !== undefined && z !== undefined) {
				addPoint(bounds, x, y, z)
			}
		}
	}
	return { triangles, bounds }
}

function summarizeBinaryStl(buffer: Buffer, fileName: string): string {
	if (buffer.length < 84) {
		throw new Error("Binary STL is truncated.")
	}
	const triangleCount = buffer.readUInt32LE(80)
	const bounds = createBounds()
	const scanCount = Math.min(triangleCount, MAX_BINARY_STL_BBOX_TRIANGLES)
	for (let index = 0; index < scanCount; index++) {
		const offset = 84 + index * 50
		if (offset + 50 > buffer.length) {
			break
		}
		for (let vertex = 0; vertex < 3; vertex++) {
			const base = offset + 12 + vertex * 12
			addPoint(bounds, buffer.readFloatLE(base), buffer.readFloatLE(base + 4), buffer.readFloatLE(base + 8))
		}
	}
	return [
		`[3D model summary: ${fileName}]`,
		"format: STL (binary)",
		`triangles: ${triangleCount}`,
		`bounding box: ${formatBounds(bounds)}`,
	].join("\n")
}

function summarizePly(buffer: Buffer, fileName: string): string {
	const headerText = buffer.toString("utf8", 0, Math.min(buffer.length, 64 * 1024))
	const headerEnd = headerText.indexOf("end_header")
	if (headerEnd < 0) {
		throw new Error("PLY header is missing end_header.")
	}
	const headerLines = headerText.slice(0, headerEnd).split(/\r?\n/)
	let format = "unknown"
	let vertexCount = 0
	let faceCount = 0
	for (const line of headerLines) {
		if (line.startsWith("format ")) {
			format = line.slice(7).trim()
		} else if (line.startsWith("element vertex ")) {
			vertexCount = Number.parseInt(line.slice(15), 10) || 0
		} else if (line.startsWith("element face ")) {
			faceCount = Number.parseInt(line.slice(13), 10) || 0
		}
	}

	return [
		`[3D model summary: ${fileName}]`,
		"format: PLY",
		`encoding: ${format}`,
		`vertices: ${vertexCount}`,
		`faces: ${faceCount}`,
		"note: PLY geometry is summarized from its header; vertex payload is not sent to the model.",
	].join("\n")
}

function summarizeGltfJson(json: Json, fileName: string, container: string): string {
	const asset = (json.asset ?? {}) as Json
	const meshes = Array.isArray(json.meshes) ? json.meshes : []
	const nodes = Array.isArray(json.nodes) ? json.nodes : []
	const materials = Array.isArray(json.materials) ? json.materials : []
	const textures = Array.isArray(json.textures) ? json.textures : []
	const images = Array.isArray(json.images) ? json.images : []
	const animations = Array.isArray(json.animations) ? json.animations : []
	const accessors = Array.isArray(json.accessors) ? json.accessors : []
	const buffers = Array.isArray(json.buffers) ? json.buffers : []

	let primitives = 0
	let triangles = 0
	const bounds = createBounds()
	const materialNames = materials.map((material) => {
		const entry = material as Json
		return typeof entry.name === "string" ? entry.name : ""
	})
	const animationNames = animations.map((animation) => {
		const entry = animation as Json
		return typeof entry.name === "string" ? entry.name : ""
	})

	for (const mesh of meshes) {
		const entry = mesh as Json
		const meshPrimitives = Array.isArray(entry.primitives) ? entry.primitives : []
		for (const primitive of meshPrimitives) {
			primitives += 1
			const attributes = ((primitive as Json).attributes ?? {}) as Json
			const positionIndex = attributes.POSITION
			if (typeof positionIndex === "number") {
				const accessor = accessors[positionIndex] as Json | undefined
				if (accessor) {
					const accessorMin = Array.isArray(accessor.min) ? accessor.min : undefined
					const accessorMax = Array.isArray(accessor.max) ? accessor.max : undefined
					if (accessorMin && accessorMax && accessorMin.length >= 3 && accessorMax.length >= 3) {
						addPoint(bounds, Number(accessorMin[0]), Number(accessorMin[1]), Number(accessorMin[2]))
						addPoint(bounds, Number(accessorMax[0]), Number(accessorMax[1]), Number(accessorMax[2]))
					}
					const count = typeof accessor.count === "number" ? accessor.count : 0
					const indices = (primitive as Json).indices
					if (typeof indices === "number") {
						const indexAccessor = accessors[indices] as Json | undefined
						const indexCount = typeof indexAccessor?.count === "number" ? indexAccessor.count : 0
						triangles += Math.floor(indexCount / 3)
					} else {
						triangles += Math.floor(count / 3)
					}
				}
			}
		}
	}

	return [
		`[3D model summary: ${fileName}]`,
		`format: ${container}`,
		`glTF version: ${typeof asset.version === "string" ? asset.version : "unknown"}`,
		`nodes: ${nodes.length}`,
		`meshes: ${meshes.length}`,
		`primitives: ${primitives}`,
		`triangles: ${triangles}`,
		`materials: ${materials.length === 0 ? "none" : `${materials.length} (${listNames(materialNames)})`}`,
		`textures: ${textures.length}`,
		`images: ${images.length}`,
		`animations: ${animations.length === 0 ? "none" : `${animations.length} (${listNames(animationNames)})`}`,
		`buffers: ${buffers.length}`,
		`bounding box: ${formatBounds(bounds)}`,
	].join("\n")
}

function summarizeGltf(text: string, fileName: string): string {
	let json: Json
	try {
		json = JSON.parse(text) as Json
	} catch (error) {
		throw new Error(`glTF JSON is invalid: ${error instanceof Error ? error.message : String(error)}`)
	}
	return summarizeGltfJson(json, fileName, "glTF (.gltf JSON)")
}

function summarizeGlb(buffer: Buffer, fileName: string): string {
	if (buffer.length < 20) {
		throw new Error("GLB file is truncated.")
	}
	const magic = buffer.readUInt32LE(0)
	if (magic !== 0x46546c67) {
		throw new Error("Not a GLB file (bad magic header).")
	}
	const version = buffer.readUInt32LE(4)
	const chunkLength = buffer.readUInt32LE(12)
	const chunkType = buffer.readUInt32LE(16)
	if (chunkType !== 0x4e4f534a) {
		throw new Error("GLB first chunk is not JSON.")
	}
	const jsonEnd = Math.min(buffer.length, 20 + chunkLength)
	const jsonText = buffer.toString("utf8", 20, jsonEnd)
	let json: Json
	try {
		json = JSON.parse(jsonText) as Json
	} catch (error) {
		throw new Error(`GLB JSON chunk is invalid: ${error instanceof Error ? error.message : String(error)}`)
	}
	const binChunkBytes =
		buffer.length >= jsonEnd + 8 && buffer.readUInt32LE(jsonEnd + 4) === 0x004e4942 ? buffer.readUInt32LE(jsonEnd) : 0
	return [summarizeGltfJson(json, fileName, `GLB (version ${version})`), `embedded binary chunk: ${binChunkBytes} bytes`].join(
		"\n",
	)
}

function summarizeDae(text: string, fileName: string): string {
	const count = (pattern: RegExp): number => (text.match(pattern) ?? []).length
	return [
		`[3D model summary: ${fileName}]`,
		"format: COLLADA (.dae)",
		`geometries: ${count(/<geometry\b/gi)}`,
		`nodes: ${count(/<node\b/gi)}`,
		`materials: ${count(/<material\b/gi)}`,
		`animations: ${count(/<animation\b/gi)}`,
		`controllers: ${count(/<controller\b/gi)}`,
	].join("\n")
}

function summarizeDxf(text: string, fileName: string): string {
	const entityPatterns: Array<[string, RegExp]> = [
		["lines", /^\s*LINE\s*$/gim],
		["polylines", /^\s*(?:LWPOLYLINE|POLYLINE)\s*$/gim],
		["circles", /^\s*CIRCLE\s*$/gim],
		["arcs", /^\s*ARC\s*$/gim],
		["splines", /^\s*SPLINE\s*$/gim],
		["3d faces", /^\s*3DFACE\s*$/gim],
		["meshes", /^\s*MESH\s*$/gim],
		["inserts", /^\s*INSERT\s*$/gim],
		["texts", /^\s*(?:TEXT|MTEXT)\s*$/gim],
		["dimensions", /^\s*DIMENSION\s*$/gim],
		["hatches", /^\s*HATCH\s*$/gim],
	]
	const counts = entityPatterns.map(([label, pattern]) => `${label}: ${(text.match(pattern) ?? []).length}`).join(", ")
	const versionMatch = text.match(/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*([^\r\n]+)/i)
	return [
		`[3D/CAD summary: ${fileName}]`,
		"format: DXF",
		`version: ${versionMatch?.[1]?.trim() ?? "unknown"}`,
		`entities: ${counts}`,
		`layers: ${(text.match(/^\s*LAYER\s*$/gim) ?? []).length}`,
		`blocks: ${(text.match(/^\s*BLOCK\s*$/gim) ?? []).length}`,
	].join("\n")
}

function summarizeUnityAsset(text: string, fileName: string): string {
	const count = (pattern: RegExp): number => (text.match(pattern) ?? []).length
	return [
		`[Game asset summary: ${fileName}]`,
		"format: Unity YAML asset",
		`documents: ${count(/^--- !u!/gm)}`,
		`game objects: ${count(/^\s*GameObject:\s*$/gm)}`,
		`transforms: ${count(/^\s*Transform:\s*$/gm)}`,
		`mesh filters: ${count(/^\s*MeshFilter:\s*$/gm)}`,
		`mesh renderers: ${count(/^\s*MeshRenderer:\s*$/gm)}`,
		`mono behaviours: ${count(/^\s*MonoBehaviour:\s*$/gm)}`,
		`animators: ${count(/^\s*Animator:\s*$/gm)}`,
		`animation clips: ${count(/^\s*AnimationClip:\s*$/gm)}`,
		`materials: ${count(/^\s*Material:\s*$/gm)}`,
	].join("\n")
}

const SUPPORTED_EXTENSIONS = new Set(["obj", "mtl", "stl", "ply", "gltf", "glb", "dae", "dxf", "unity", "prefab"])

export interface Model3dSummaryOptions {
	maxSourceBytes?: number
}

export async function summarizeModel3d(filePath: string, options: Model3dSummaryOptions = {}): Promise<string> {
	const extension = path.extname(filePath).toLowerCase().replace(/^\./, "")
	const fileName = path.basename(filePath)
	if (!SUPPORTED_EXTENSIONS.has(extension)) {
		throw new Error(
			`Binary 3D/CAD format ".${extension}" is not supported yet. Export it to glTF/GLB/OBJ/STL, or wait for the converter phase.`,
		)
	}

	const buffer = await readSource(filePath, options.maxSourceBytes)
	let summary: string
	switch (extension) {
		case "obj":
			summary = summarizeObj(assertText(buffer, extension), fileName)
			break
		case "mtl":
			summary = summarizeMtl(assertText(buffer, extension), fileName)
			break
		case "stl": {
			const head = buffer.toString("utf8", 0, Math.min(buffer.length, 2048)).toLowerCase()
			if (head.includes("solid") && head.includes("facet")) {
				const parsed = summarizeAsciiStl(buffer.toString("utf8"), fileName)
				summary = [
					`[3D model summary: ${fileName}]`,
					"format: STL (ASCII)",
					`triangles: ${parsed.triangles}`,
					`bounding box: ${formatBounds(parsed.bounds)}`,
				].join("\n")
			} else {
				summary = summarizeBinaryStl(buffer, fileName)
			}
			break
		}
		case "ply":
			summary = summarizePly(buffer, fileName)
			break
		case "gltf":
			summary = summarizeGltf(assertText(buffer, extension), fileName)
			break
		case "glb":
			summary = summarizeGlb(buffer, fileName)
			break
		case "dae":
			summary = summarizeDae(assertText(buffer, extension), fileName)
			break
		case "dxf":
			summary = summarizeDxf(assertText(buffer, extension), fileName)
			break
		case "unity":
		case "prefab":
			summary = summarizeUnityAsset(assertText(buffer, extension), fileName)
			break
		default:
			throw new Error(`Unsupported 3D format ".${extension}".`)
	}

	Logger.log(`[3D] Summarized ${fileName} (${buffer.length} bytes)`)
	return truncateContent(summary)
}
