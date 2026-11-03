import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { ATTACHMENT_LIMITS } from "@shared/attachments"
import { Logger } from "@/shared/services/Logger"
import { summarizeModel3d } from "./model3d-attachments"

/**
 * External converter pipeline for binary 3D/CAD assets.
 *
 * Nothing is bundled. The host detects the following tools and uses the first
 * suitable one:
 * - Blender headless for BLEND/FBX/3DS
 * - Assimp for FBX/3DS
 * - LibreDWG (dwg2dxf) for DWG, then the DXF summarizer
 * - FreeCADCmd for STEP/IGES, then the STL summarizer
 *
 * Converted output is written to a temp directory, size-checked, summarized,
 * and deleted. Conversion failures never leave temporary files behind.
 */

const execFileAsync = promisify(execFile)
const DETECT_TIMEOUT_MS = 10_000
const CONVERT_TIMEOUT_MS = 5 * 60_000
const MAX_CONVERTED_BYTES = 100 * 1024 * 1024

const TEXT_SUMMARIZABLE_EXTENSIONS = new Set(["obj", "mtl", "stl", "ply", "gltf", "glb", "dae", "dxf", "unity", "prefab"])

const BLENDER_EXTENSIONS = new Set(["blend", "fbx", "3ds"])
const ASSIMP_EXTENSIONS = new Set(["fbx", "3ds"])
const FREECAD_EXTENSIONS = new Set(["step", "stp", "iges", "igs"])
const GAME_ENGINE_EXTENSIONS = new Set(["uasset", "umap"])

export interface RunCommandResult {
	stdout: string
	stderr: string
}

export type RunCommand = (
	command: string,
	args: string[],
	options?: { timeout?: number; cwd?: string },
) => Promise<RunCommandResult>

const defaultRunCommand: RunCommand = async (command, args, options) => {
	const { stdout, stderr } = await execFileAsync(command, args, {
		timeout: options?.timeout ?? CONVERT_TIMEOUT_MS,
		cwd: options?.cwd,
		maxBuffer: 20 * 1024 * 1024,
		windowsHide: true,
	})
	return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }
}

async function commandAvailable(run: RunCommand, command: string, args: string[]): Promise<boolean> {
	try {
		await run(command, args, { timeout: DETECT_TIMEOUT_MS })
		return true
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code
		return code !== "ENOENT" && code !== "EACCES"
	}
}

export interface Model3dToolchain {
	blender: boolean
	assimp: boolean
	freecad: boolean
	dwg2dxf: boolean
}

let toolchainPromise: Promise<Model3dToolchain> | undefined

export async function detectModel3dToolchain(run: RunCommand = defaultRunCommand): Promise<Model3dToolchain> {
	const [blender, assimp, freecad, dwg2dxf] = await Promise.all([
		commandAvailable(run, "blender", ["--version"]),
		commandAvailable(run, "assimp", ["version"]),
		commandAvailable(run, "FreeCADCmd", ["--version"]),
		commandAvailable(run, "dwg2dxf", ["--version"]),
	])
	return { blender, assimp, freecad, dwg2dxf }
}

function cachedToolchain(run: RunCommand): Promise<Model3dToolchain> {
	if (run !== defaultRunCommand) {
		return detectModel3dToolchain(run)
	}
	toolchainPromise ??= detectModel3dToolchain(run)
	return toolchainPromise
}

export function describeConverterRequirement(extension: string): string {
	if (GAME_ENGINE_EXTENSIONS.has(extension)) {
		return "Unreal .uasset/.umap files cannot be read directly. Export the asset to glTF/GLB/FBX from Unreal Engine and attach that file instead."
	}
	if (extension === "dwg") {
		return "DWG conversion requires LibreDWG (`dwg2dxf`) on PATH, or export the drawing to DXF."
	}
	if (FREECAD_EXTENSIONS.has(extension)) {
		return "STEP/IGES conversion requires FreeCADCmd on PATH, or export the model to glTF/GLB/OBJ/STL."
	}
	return (
		"Binary 3D conversion requires Blender (headless) or Assimp on PATH. " +
		"Install Blender (https://www.blender.org) or Assimp (https://assimp.org), or export the asset to glTF/GLB/OBJ/STL."
	)
}

async function assertConverted(filePath: string): Promise<void> {
	const stat = await fs.stat(filePath)
	if (!stat.isFile() || stat.size === 0) {
		throw new Error("Converter produced no output.")
	}
	if (stat.size > MAX_CONVERTED_BYTES) {
		throw new Error(`Converted 3D file is too large (${stat.size} bytes; limit ${MAX_CONVERTED_BYTES}).`)
	}
}

const BLENDER_SCRIPT = String.raw`
import bpy, sys
input_path, output_path = sys.argv[-2], sys.argv[-1]
extension = input_path.lower().rsplit(".", 1)[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
try:
    if extension == "blend":
        bpy.ops.wm.open_mainfile(filepath=input_path)
    elif extension == "fbx":
        bpy.ops.import_scene.fbx(filepath=input_path)
    elif extension == "3ds":
        bpy.ops.import_scene.autodesk_3ds(filepath=input_path)
    else:
        raise RuntimeError("Unsupported Blender import: " + extension)
except Exception as error:
    print("IMPORT_FAILED", error)
    sys.exit(2)
bpy.ops.export_scene.gltf(filepath=output_path, export_format="GLB")
`

const FREECAD_SCRIPT = String.raw`
import sys, Part, Mesh, MeshPart
input_path, output_path = sys.argv[-2], sys.argv[-1]
shape = Part.Shape()
shape.read(input_path)
mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.2, AngularDeflection=0.5, Relative=False)
mesh.write(output_path)
`

async function convertWithBlender(inputPath: string, outputPath: string, run: RunCommand): Promise<void> {
	const scriptPath = path.join(path.dirname(outputPath), "import_blender.py")
	await fs.writeFile(scriptPath, BLENDER_SCRIPT, "utf8")
	await run("blender", ["--background", "--factory-startup", "--python", scriptPath, "--", inputPath, outputPath], {
		timeout: CONVERT_TIMEOUT_MS,
	})
	await assertConverted(outputPath)
}

async function convertWithAssimp(inputPath: string, outputPath: string, run: RunCommand): Promise<void> {
	try {
		await run("assimp", ["export", inputPath, outputPath], { timeout: CONVERT_TIMEOUT_MS })
		await assertConverted(outputPath)
	} catch (error) {
		// Some Assimp builds only export .gltf, not .glb.
		const gltfPath = outputPath.replace(/\.glb$/i, ".gltf")
		await run("assimp", ["export", inputPath, gltfPath], { timeout: CONVERT_TIMEOUT_MS })
		await assertConverted(gltfPath)
	}
}

async function convertWithFreeCad(inputPath: string, outputPath: string, run: RunCommand): Promise<void> {
	const scriptPath = path.join(path.dirname(outputPath), "import_freecad.py")
	await fs.writeFile(scriptPath, FREECAD_SCRIPT, "utf8")
	await run("FreeCADCmd", [scriptPath, inputPath, outputPath], { timeout: CONVERT_TIMEOUT_MS })
	await assertConverted(outputPath)
}

async function convertDwgToDxf(inputPath: string, outputPath: string, run: RunCommand): Promise<void> {
	await run("dwg2dxf", ["-o", outputPath, inputPath], { timeout: CONVERT_TIMEOUT_MS })
	await assertConverted(outputPath)
}

/**
 * Summarize any 3D/CAD/game asset. Text formats and GLB are summarized in
 * place; binary formats are converted with an external tool when available.
 */
export async function summarizeModel3dAsset(filePath: string, options: { run?: RunCommand } = {}): Promise<string> {
	const run = options.run ?? defaultRunCommand
	const extension = path.extname(filePath).toLowerCase().replace(/^\./, "")
	if (TEXT_SUMMARIZABLE_EXTENSIONS.has(extension)) {
		return summarizeModel3d(filePath)
	}
	if (GAME_ENGINE_EXTENSIONS.has(extension)) {
		throw new Error(describeConverterRequirement(extension))
	}

	const toolchain = await cachedToolchain(run)
	const sourceStat = await fs.stat(filePath)
	if (sourceStat.size > ATTACHMENT_LIMITS.maxMediaFileBytes) {
		throw new Error(
			`3D/CAD source file is too large to convert (${sourceStat.size} bytes; limit ${ATTACHMENT_LIMITS.maxMediaFileBytes}).`,
		)
	}
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-3d-convert-"))
	try {
		if (extension === "dwg") {
			if (!toolchain.dwg2dxf) {
				throw new Error(describeConverterRequirement(extension))
			}
			const dxfPath = path.join(tempDir, "converted.dxf")
			await convertDwgToDxf(filePath, dxfPath, run)
			return await summarizeModel3d(dxfPath, { maxSourceBytes: MAX_CONVERTED_BYTES })
		}

		if (FREECAD_EXTENSIONS.has(extension)) {
			if (!toolchain.freecad) {
				throw new Error(describeConverterRequirement(extension))
			}
			const stlPath = path.join(tempDir, "converted.stl")
			await convertWithFreeCad(filePath, stlPath, run)
			return await summarizeModel3d(stlPath, { maxSourceBytes: MAX_CONVERTED_BYTES })
		}

		if (BLENDER_EXTENSIONS.has(extension) && toolchain.blender) {
			const glbPath = path.join(tempDir, "converted.glb")
			await convertWithBlender(filePath, glbPath, run)
			return await summarizeModel3d(glbPath, { maxSourceBytes: MAX_CONVERTED_BYTES })
		}

		if (ASSIMP_EXTENSIONS.has(extension) && toolchain.assimp) {
			const glbPath = path.join(tempDir, "converted.glb")
			await convertWithAssimp(filePath, glbPath, run)
			return await summarizeModel3d(glbPath, { maxSourceBytes: MAX_CONVERTED_BYTES })
		}

		throw new Error(describeConverterRequirement(extension))
	} catch (error) {
		Logger.warn(`[3D] Conversion failed for ${filePath}:`, error)
		throw error
	} finally {
		await fs.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) => {
			Logger.warn(`[3D] Could not clean up ${tempDir}:`, cleanupError)
		})
	}
}
