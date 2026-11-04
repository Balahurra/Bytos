/*
 * Copyright 2026 Cline Bot Inc.
 * Bytos modifications Copyright 2026 Bytos contributors.
 *
 * Modified from the Cline project (https://github.com/cline/cline), Apache-2.0.
 * Changes by Bytos: attachment extraction covers additional binary formats
 * (PDF, office documents, media) and normalizes their output.
 * See NOTICE and apps/vscode/THIRD-PARTY-NOTICES.txt.
 */

import type ExcelJS from "exceljs"
import fs from "fs/promises"
import * as iconv from "iconv-lite"
import { isBinaryFile } from "isbinaryfile"
import * as path from "path"
import { ATTACHMENT_LIMITS, isAttachmentFeatureEnabled } from "@/shared/attachments"
import { truncateContent } from "@/shared/content-limits"
import { Logger } from "@/shared/services/Logger"
import { sanitizeNotebookForLLM } from "./notebook-utils"
import { describeOcrRequirement, ocrPdfWithExternalTools } from "./pdf-ocr"

export async function detectEncoding(fileBuffer: Buffer, fileExtension?: string): Promise<string> {
	// BOM checks cover the common UTF-16/UTF-8 cases without an LGPL detector.
	if (fileBuffer.length >= 3 && fileBuffer[0] === 0xef && fileBuffer[1] === 0xbb && fileBuffer[2] === 0xbf) {
		return "utf8"
	}
	if (fileBuffer.length >= 2 && fileBuffer[0] === 0xff && fileBuffer[1] === 0xfe) {
		return "utf16-le"
	}
	if (fileBuffer.length >= 2 && fileBuffer[0] === 0xfe && fileBuffer[1] === 0xff) {
		return "utf16-be"
	}
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(fileBuffer)
		return "utf8"
	} catch {
		// Not valid UTF-8; fall through to the text/binary check.
	}
	if (fileExtension) {
		const isBinary = await isBinaryFile(fileBuffer).catch(() => false)
		if (isBinary) {
			throw new Error(`Cannot read text for file type: ${fileExtension}`)
		}
	}
	// Windows-1252 is a safe single-byte fallback for legacy text files and is
	// supported by iconv-lite. It never throws on arbitrary bytes.
	return "windows-1252"
}

export async function extractTextFromFile(filePath: string): Promise<string> {
	try {
		await fs.access(filePath)
	} catch (_error) {
		throw new Error(`File not found: ${filePath}`)
	}

	return callTextExtractionFunctions(filePath)
}

/**
 * Expects the fs.access call to have already been performed prior to calling.
 * Content is automatically truncated if it exceeds 400KB to prevent context overflow.
 */
async function callTextExtractionFunctions(filePath: string): Promise<string> {
	const fileExtension = path.extname(filePath).toLowerCase()

	let content: string

	switch (fileExtension) {
		case ".pdf":
			content = await extractTextFromPDF(filePath)
			break
		case ".docx":
			content = await extractTextFromDOCX(filePath)
			break
		case ".ipynb":
			content = await extractTextFromIPYNB(filePath)
			break
		case ".xlsx":
			content = await extractTextFromExcel(filePath)
			break
		default:
			// Check file size with stat() first - faster than reading entire file for size check
			const fileStat = await fs.stat(filePath)
			if (fileStat.size > ATTACHMENT_LIMITS.maxFileBytes) {
				// 20MB limit (decimal MB)
				throw new Error(`File is too large to read into context.`)
			}
			const fileBuffer = await fs.readFile(filePath)
			const encoding = await detectEncoding(fileBuffer, fileExtension)
			content = iconv.decode(fileBuffer, encoding)
	}

	// Truncate content if it exceeds 400KB to prevent context overflow
	return truncateContent(content)
}

async function extractTextFromPDF(filePath: string): Promise<string> {
	const fileStat = await fs.stat(filePath)
	if (fileStat.size > ATTACHMENT_LIMITS.maxFileBytes) {
		throw new Error(`PDF is too large to read into context (${ATTACHMENT_LIMITS.maxFileBytes} byte limit).`)
	}
	const [{ default: pdf }, dataBuffer] = await Promise.all([
		// @ts-expect-error-next-line
		import("pdf-parse/lib/pdf-parse"),
		fs.readFile(filePath),
	])
	const data = await pdf(dataBuffer)
	const text = data.text?.trim() ?? ""
	if (text) {
		return text
	}

	if (isAttachmentFeatureEnabled("pdfOcr")) {
		const ocrText = await ocrPdfWithExternalTools(filePath)
		if (ocrText?.trim()) {
			return ocrText
		}
	}

	throw new Error(
		`No extractable text found in this PDF. It may be a scanned/image-only PDF, and OCR produced no text. ${describeOcrRequirement()}`,
	)
}

async function extractTextFromDOCX(filePath: string): Promise<string> {
	const { default: mammoth } = await import("mammoth")
	const result = await mammoth.extractRawText({ path: filePath })
	return result.value
}

async function extractTextFromIPYNB(filePath: string): Promise<string> {
	const fileBuffer = await fs.readFile(filePath)
	const encoding = await detectEncoding(fileBuffer)
	const data = iconv.decode(fileBuffer, encoding)

	// Strip all outputs to reduce context size - outputs aren't needed for understanding
	// notebook structure. For Jupyter commands, the specific cell's outputs are included
	// separately via sanitizeCellForLLM which preserves text outputs.
	return sanitizeNotebookForLLM(data, true)
}

/**
 * Format the data inside Excel cells
 */
function formatCellValue(cell: ExcelJS.Cell): string {
	const value = cell.value
	if (value === null || value === undefined) {
		return ""
	}

	// Handle error values (#DIV/0!, #N/A, etc.)
	if (typeof value === "object" && "error" in value) {
		return `[Error: ${value.error}]`
	}

	// Handle dates - ExcelJS can parse them as Date objects
	if (value instanceof Date) {
		return value.toISOString().split("T")[0] // Just the date part
	}

	// Handle rich text
	if (typeof value === "object" && "richText" in value) {
		return value.richText.map((rt) => rt.text).join("")
	}

	// Handle hyperlinks
	if (typeof value === "object" && "text" in value && "hyperlink" in value) {
		return `${value.text} (${value.hyperlink})`
	}

	// Handle formulas - get the calculated result
	if (typeof value === "object" && "formula" in value) {
		if ("result" in value && value.result !== undefined && value.result !== null) {
			return value.result.toString()
		}
		return `[Formula: ${value.formula}]`
	}

	return value.toString()
}

/**
 * Extract and format text from xlsx files
 */
async function extractTextFromExcel(filePath: string): Promise<string> {
	const { default: ExcelJS } = await import("exceljs")
	const workbook = new ExcelJS.Workbook()
	let excelText = ""

	try {
		await workbook.xlsx.readFile(filePath)

		workbook.eachSheet((worksheet, _sheetId) => {
			// Skip hidden sheets
			if (worksheet.state === "hidden" || worksheet.state === "veryHidden") {
				return
			}

			excelText += `--- Sheet: ${worksheet.name} ---\n`

			worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
				// Optional: limit processing for very large sheets
				if (rowNumber > 50000) {
					excelText += `[... truncated at row ${rowNumber} ...]\n`
					return false
				}

				const rowTexts: string[] = []
				let hasContent = false

				row.eachCell({ includeEmpty: true }, (cell, _colNumber) => {
					const cellText = formatCellValue(cell)
					if (cellText.trim()) {
						hasContent = true
					}
					rowTexts.push(cellText)
				})

				// Only add rows with actual content
				if (hasContent) {
					excelText += rowTexts.join("\t") + "\n"
				}

				return true
			})

			excelText += "\n" // Blank line between sheets
		})

		return excelText.trim()
	} catch (error: any) {
		Logger.error(`Error extracting text from Excel ${filePath}:`, error)
		throw new Error(`Failed to extract text from Excel: ${error.message}`)
	}
}

/**
 * Helper function used to load file(s) and format them into a string
 */
export async function processFilesIntoText(files: string[]): Promise<string> {
	const fileContentsPromises = files.map(async (filePath) => {
		try {
			// Check if file exists and is binary
			//const isBinary = await isBinaryFile(filePath).catch(() => false)
			//if (isBinary) {
			//	return `<file_content path="${filePath.toPosix()}">\n(Binary file, unable to display content)\n</file_content>`
			//}
			const content = await extractTextFromFile(filePath)
			return `<file_content path="${filePath.toPosix()}">\n${content}\n</file_content>`
		} catch (error) {
			Logger.error(`Error processing file ${filePath}:`, error)
			return `<file_content path="${filePath.toPosix()}">\nError fetching content: ${error.message}\n</file_content>`
		}
	})

	const fileContents = await Promise.all(fileContentsPromises)

	const validFileContents = fileContents.filter((content) => content !== null).join("\n\n")

	if (validFileContents) {
		return `Files attached by the user:\n\n${validFileContents}`
	}

	// returns empty string if no files were loaded properly
	return ""
}
