import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { describeOcrRequirement, detectOcrToolchain, ocrPdfWithExternalTools, type RunCommand } from "./pdf-ocr"

function commandError(code: string): NodeJS.ErrnoException {
	const error = new Error(code) as NodeJS.ErrnoException
	error.code = code
	return error
}

describe("detectOcrToolchain", () => {
	it("returns undefined when Tesseract is missing", async () => {
		const run: RunCommand = async (command) => {
			throw commandError(command === "tesseract" ? "ENOENT" : "ENOENT")
		}

		await expect(detectOcrToolchain(run)).resolves.toBeUndefined()
	})

	it("prefers pdftoppm when both Tesseract and Poppler are available", async () => {
		const run: RunCommand = async (command) => {
			if (command === "tesseract" || command === "pdftoppm") {
				return { stdout: "", stderr: "version" }
			}
			throw commandError("ENOENT")
		}

		await expect(detectOcrToolchain(run)).resolves.toEqual({ renderer: "pdftoppm" })
	})

	it("accepts a renderer whose version command exits non-zero", async () => {
		const run: RunCommand = async (command) => {
			if (command === "tesseract") {
				return { stdout: "tesseract 5", stderr: "" }
			}
			if (command === "pdftoppm") {
				throw commandError("1")
			}
			throw commandError("ENOENT")
		}

		await expect(detectOcrToolchain(run)).resolves.toEqual({ renderer: "pdftoppm" })
	})

	it("falls back to another rasterizer", async () => {
		const run: RunCommand = async (command) => {
			if (command === "tesseract" || command === "mutool") {
				return { stdout: "", stderr: "" }
			}
			throw commandError("ENOENT")
		}

		await expect(detectOcrToolchain(run)).resolves.toEqual({ renderer: "mutool" })
	})
})

describe("ocrPdfWithExternalTools", () => {
	it("returns undefined when the toolchain is not installed", async () => {
		const run: RunCommand = async () => {
			throw commandError("ENOENT")
		}

		await expect(ocrPdfWithExternalTools("/tmp/report.pdf", { run })).resolves.toBeUndefined()
	})

	it("renders pages and concatenates Tesseract output", async () => {
		const run: RunCommand = async (command, args) => {
			if (command === "tesseract" && args[0] === "--version") {
				return { stdout: "tesseract 5", stderr: "" }
			}
			if (command === "pdftoppm" && args[0] === "-v") {
				return { stdout: "", stderr: "pdftoppm" }
			}
			if (command === "pdftoppm") {
				const prefix = args[args.length - 1]
				await fs.writeFile(`${prefix}-1.png`, "page 1")
				await fs.writeFile(`${prefix}-2.png`, "page 2")
				return { stdout: "", stderr: "" }
			}
			if (command === "tesseract" && args[1] === "stdout") {
				return { stdout: `OCR text for ${path.basename(args[0])}`, stderr: "" }
			}
			throw commandError("ENOENT")
		}

		const text = await ocrPdfWithExternalTools("/tmp/report.pdf", { run })

		expect(text).toContain("--- Page 1 ---")
		expect(text).toContain("--- Page 2 ---")
		expect(text).toContain("OCR text for page-1.png")
		expect(text).toContain("OCR text for page-2.png")
	})
})

describe("describeOcrRequirement", () => {
	it("names the required tools and platforms", () => {
		const message = describeOcrRequirement()
		expect(message).toContain("Poppler")
		expect(message).toContain("Tesseract")
		expect(message).toContain("PATH")
	})
})
