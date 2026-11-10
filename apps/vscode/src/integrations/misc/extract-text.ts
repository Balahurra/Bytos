/*
 * Copyright 2026 Cline Bot Inc.
 * Bytos modifications Copyright 2026 Bytos contributors.
 *
 * Modified from the Cline project (https://github.com/cline/cline), Apache-2.0.
 * Changes by Bytos: attachment extraction covers additional binary formats
 * (PDF, office documents, media) and normalizes their output.
 * See NOTICE and apps/vscode/THIRD-PARTY-NOTICES.txt.
 */

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
 * Extract and format text from xlsx files.
 *
 * This deliberately uses JSZip + a DOM parser instead of ExcelJS. ExcelJS pulls
 * in `unzipper -> binary -> buffers`, and `buffers@0.1.1` has no verified
 * license. The reader below preserves the text-extraction behavior (sheet names,
 * hidden-sheet skipping, shared strings, inline strings, formulas, booleans,
 * errors, and date-formatted cells) without that dependency path.
 */
async function extractTextFromExcel(filePath: string): Promise<string> {
	const [{ default: JSZip }, { DOMParser }] = await Promise.all([import("jszip"), import("@xmldom/xmldom")])
	const parser = new DOMParser()
	const parseXml = (xml: string) => parser.parseFromString(xml, "text/xml")

	const textContent = (node: Node, tag: string): string => {
		const elements = (node as Element).getElementsByTagName(tag)
		let text = ""
		for (let i = 0; i < elements.length; i++) {
			text += elements[i].textContent ?? ""
		}
		return text
	}

	const columnIndex = (reference: string): number => {
		const letters = reference.replace(/[^A-Z]/gi, "").toUpperCase()
		let index = 0
		for (const letter of letters) {
			index = index * 26 + (letter.charCodeAt(0) - 64)
		}
		return Math.max(index - 1, 0)
	}

	const excelSerialToIsoDate = (serial: number, date1904: boolean): string => {
		const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
		return new Date(epoch + serial * 86_400_000).toISOString().slice(0, 10)
	}

	try {
		const archive = await JSZip.loadAsync(await fs.readFile(filePath))

		const workbookFile = archive.file("xl/workbook.xml")
		const workbookRelsFile = archive.file("xl/_rels/workbook.xml.rels")
		if (!workbookFile) {
			throw new Error("The workbook is missing xl/workbook.xml.")
		}

		const workbook = parseXml(await workbookFile.async("text"))
		const date1904 = workbook.documentElement.getAttribute("date1904") === "1"
		const relTargets = new Map<string, string>()
		if (workbookRelsFile) {
			const rels = parseXml(await workbookRelsFile.async("text"))
			const relationships = rels.getElementsByTagName("Relationship")
			for (let i = 0; i < relationships.length; i++) {
				const relationship = relationships[i]
				const id = relationship.getAttribute("Id")
				const target = relationship.getAttribute("Target")
				if (id && target) {
					relTargets.set(id, target.replace(/^\/+/, ""))
				}
			}
		}

		const sharedStrings: string[] = []
		const sharedStringsFile = archive.file("xl/sharedStrings.xml")
		if (sharedStringsFile) {
			const shared = parseXml(await sharedStringsFile.async("text"))
			const items = shared.getElementsByTagName("si")
			for (let i = 0; i < items.length; i++) {
				sharedStrings.push(textContent(items[i], "t"))
			}
		}

		// Map cell-style indexes to date formats so serial numbers can be rendered
		// like ExcelJS rendered Date cells.
		const dateStyles = new Set<number>()
		const stylesFile = archive.file("xl/styles.xml")
		if (stylesFile) {
			const styles = parseXml(await stylesFile.async("text"))
			const customFormats = new Map<number, string>()
			const numFmts = styles.getElementsByTagName("numFmt")
			for (let i = 0; i < numFmts.length; i++) {
				const id = Number(numFmts[i].getAttribute("numFmtId"))
				const code = numFmts[i].getAttribute("formatCode") ?? ""
				if (!Number.isNaN(id)) customFormats.set(id, code)
			}
			const builtInDateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
			const cellXfs = styles.getElementsByTagName("cellXfs")[0]?.getElementsByTagName("xf") ?? []
			for (let i = 0; i < cellXfs.length; i++) {
				const numFmtId = Number(cellXfs[i].getAttribute("numFmtId") ?? "0")
				const code = customFormats.get(numFmtId) ?? ""
				if (builtInDateFormats.has(numFmtId) || /[ymdhis]/i.test(code)) {
					dateStyles.add(i)
				}
			}
		}

		let excelText = ""
		const sheets = workbook.getElementsByTagName("sheet")
		for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex++) {
			const sheet = sheets[sheetIndex]
			const state = sheet.getAttribute("state")
			if (state === "hidden" || state === "veryHidden") continue

			const name = sheet.getAttribute("name") ?? `Sheet${sheetIndex + 1}`
			const relationshipId = sheet.getAttribute("r:id")
			const target = (relationshipId && relTargets.get(relationshipId)) || `worksheets/sheet${sheetIndex + 1}.xml`
			const sheetFile = archive.file(`xl/${target.replace(/^xl\//, "")}`)
			if (!sheetFile) continue

			excelText += `--- Sheet: ${name} ---\n`
			const worksheet = parseXml(await sheetFile.async("text"))
			const rows = worksheet.getElementsByTagName("row")
			for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
				const row = rows[rowIndex]
				const rowNumber = Number(row.getAttribute("r") ?? rowIndex + 1)
				if (rowNumber > 50000) {
					excelText += `[... truncated at row ${rowNumber} ...]\n`
					break
				}

				const cells = row.getElementsByTagName("c")
				if (cells.length === 0) continue
				const values: string[] = []
				let maxColumn = -1
				for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
					const cell = cells[cellIndex]
					const reference = cell.getAttribute("r") ?? ""
					const column = columnIndex(reference)
					maxColumn = Math.max(maxColumn, column)

					const type = cell.getAttribute("t")
					const styleIndex = Number(cell.getAttribute("s") ?? "-1")
					const formula = cell.getElementsByTagName("f")[0]?.textContent ?? ""
					const rawValue = textContent(cell, "v")
					let value = ""

					if (type === "inlineStr") {
						value = textContent(cell, "t")
					} else if (type === "s") {
						value = sharedStrings[Number(rawValue)] ?? ""
					} else if (type === "b") {
						value = rawValue === "1" ? "TRUE" : "FALSE"
					} else if (type === "e") {
						value = `[Error: ${rawValue}]`
					} else if (type === "d") {
						value = rawValue ? new Date(rawValue).toISOString().slice(0, 10) : ""
					} else if (rawValue !== "") {
						value =
							dateStyles.has(styleIndex) && !Number.isNaN(Number(rawValue))
								? excelSerialToIsoDate(Number(rawValue), date1904)
								: rawValue
					} else if (formula) {
						value = `[Formula: ${formula}]`
					}

					values[column] = value
				}

				// Drop completely empty rows, matching the old includeEmpty:false
				// behavior for rows and preserving tab-separated columns.
				if (values.some((value) => (value ?? "").trim().length > 0)) {
					excelText += Array.from({ length: maxColumn + 1 }, (_, index) => values[index] ?? "").join("\t") + "\n"
				}
			}
			excelText += "\n"
		}

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
