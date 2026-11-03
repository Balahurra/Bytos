import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { truncateContent } from "@/shared/content-limits"
import { Logger } from "@/shared/services/Logger"

/**
 * Optional OCR fallback for scanned PDFs.
 *
 * Bytos intentionally does not bundle Tesseract/Poppler: both are large,
 * platform-specific toolchains. When they are present on PATH we render the
 * first pages with the available PDF rasterizer and OCR each page. Otherwise
 * callers keep the clear "OCR is not available" error.
 */

const execFileAsync = promisify(execFile)

export type OcrRenderer = "pdftoppm" | "mutool" | "magick" | "gs"

export interface OcrToolchain {
	renderer: OcrRenderer
}

export interface RunCommandResult {
	stdout: string
	stderr: string
}

export type RunCommand = (command: string, args: string[], options?: { timeout?: number }) => Promise<RunCommandResult>

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000
const OCR_COMMAND_TIMEOUT_MS = 60_000
const DEFAULT_MAX_PAGES = 10
const DEFAULT_DPI = 200
const DEFAULT_LANGUAGE = "eng"

const defaultRunCommand: RunCommand = async (command, args, options) => {
	const { stdout, stderr } = await execFileAsync(command, args, {
		timeout: options?.timeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
		maxBuffer: 20 * 1024 * 1024,
		windowsHide: true,
	})
	return { stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }
}

async function commandAvailable(run: RunCommand, command: string, args: string[]): Promise<boolean> {
	try {
		await run(command, args, { timeout: 5_000 })
		return true
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code
		// `-v`/`--version` commonly exits non-zero even when the tool is usable;
		// only ENOENT/EACCES mean it is genuinely unavailable.
		return code !== "ENOENT" && code !== "EACCES"
	}
}

const RENDERER_CANDIDATES: ReadonlyArray<{ renderer: OcrRenderer; command: string; versionArgs: string[] }> = [
	{ renderer: "pdftoppm", command: "pdftoppm", versionArgs: ["-v"] },
	{ renderer: "mutool", command: "mutool", versionArgs: ["-v"] },
	{ renderer: "magick", command: "magick", versionArgs: ["-version"] },
	{ renderer: "gs", command: "gs", versionArgs: ["--version"] },
]

/** Detect Tesseract plus at least one PDF rasterizer. */
export async function detectOcrToolchain(run: RunCommand = defaultRunCommand): Promise<OcrToolchain | undefined> {
	if (!(await commandAvailable(run, "tesseract", ["--version"]))) {
		return undefined
	}
	for (const candidate of RENDERER_CANDIDATES) {
		if (await commandAvailable(run, candidate.command, candidate.versionArgs)) {
			return { renderer: candidate.renderer }
		}
	}
	return undefined
}

export function describeOcrRequirement(): string {
	return (
		"OCR is not available. Install Poppler (pdftoppm) and Tesseract OCR and add both to PATH " +
		"(macOS: brew install poppler tesseract; Linux: apt install poppler-utils tesseract-ocr; " +
		"Windows: install Poppler and Tesseract and add their bin folders to PATH)."
	)
}

function rendererCommand(
	renderer: OcrRenderer,
	pdfPath: string,
	outputDir: string,
	maxPages: number,
	dpi: number,
): { command: string; args: string[] } {
	const prefix = path.join(outputDir, "page")
	switch (renderer) {
		case "pdftoppm":
			return {
				command: "pdftoppm",
				args: ["-png", "-r", String(dpi), "-f", "1", "-l", String(maxPages), pdfPath, prefix],
			}
		case "mutool":
			return {
				command: "mutool",
				args: ["draw", "-r", String(dpi), "-o", `${prefix}-%d.png`, "-F", "png", pdfPath, `1-${maxPages}`],
			}
		case "magick":
			return {
				command: "magick",
				args: ["-density", String(dpi), `${pdfPath}[0-${maxPages - 1}]`, `${prefix}-%d.png`],
			}
		case "gs":
			return {
				command: "gs",
				args: [
					"-q",
					"-dNOPAUSE",
					"-dBATCH",
					"-sDEVICE=png16m",
					`-r${dpi}`,
					"-dFirstPage=1",
					`-dLastPage=${maxPages}`,
					`-sOutputFile=${prefix}-%d.png`,
					pdfPath,
				],
			}
	}
}

async function renderPdfPages(
	toolchain: OcrToolchain,
	pdfPath: string,
	outputDir: string,
	maxPages: number,
	dpi: number,
	run: RunCommand,
): Promise<string[]> {
	const { command, args } = rendererCommand(toolchain.renderer, pdfPath, outputDir, maxPages, dpi)
	await run(command, args, { timeout: OCR_COMMAND_TIMEOUT_MS })
	const files = (await fs.readdir(outputDir)).filter((file) => file.toLowerCase().endsWith(".png")).sort()
	return files.map((file) => path.join(outputDir, file))
}

export interface OcrPdfOptions {
	run?: RunCommand
	maxPages?: number
	dpi?: number
	language?: string
}

/**
 * OCR a PDF with external tools. Returns undefined when the toolchain is not
 * installed or no page produced text. Never throws for a missing toolchain;
 * command failures are logged and also produce undefined so the caller can
 * surface the standard "OCR is not available" message.
 */
export async function ocrPdfWithExternalTools(pdfPath: string, options: OcrPdfOptions = {}): Promise<string | undefined> {
	const run = options.run ?? defaultRunCommand
	const toolchain = await detectOcrToolchain(run)
	if (!toolchain) {
		return undefined
	}

	const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES)
	const dpi = Math.max(72, options.dpi ?? DEFAULT_DPI)
	const language = options.language?.trim() || DEFAULT_LANGUAGE
	const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-ocr-"))

	try {
		const pages = await renderPdfPages(toolchain, pdfPath, outputDir, maxPages, dpi, run)
		if (pages.length === 0) {
			return undefined
		}

		const pageTexts: string[] = []
		for (const [index, pagePath] of pages.entries()) {
			try {
				const { stdout } = await run("tesseract", [pagePath, "stdout", "-l", language, "--psm", "3"], {
					timeout: OCR_COMMAND_TIMEOUT_MS,
				})
				const text = stdout.trim()
				if (text) {
					pageTexts.push(`--- Page ${index + 1} ---\n${text}`)
				}
			} catch (error) {
				Logger.warn(`[PDF OCR] Tesseract failed for ${path.basename(pagePath)}:`, error)
			}
		}

		if (pageTexts.length === 0) {
			return undefined
		}
		return truncateContent(pageTexts.join("\n\n"))
	} catch (error) {
		Logger.warn(`[PDF OCR] Rendering failed for ${pdfPath}:`, error)
		return undefined
	} finally {
		await fs.rm(outputDir, { recursive: true, force: true }).catch((error) => {
			Logger.warn(`[PDF OCR] Could not clean up ${outputDir}:`, error)
		})
	}
}
