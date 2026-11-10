import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import JSZip from "jszip"
import { afterAll, describe, expect, it } from "vitest"
import { extractTextFromFile } from "./extract-text"

/**
 * Regression coverage for the XLSX text reader that replaced ExcelJS.
 *
 * The old path pulled `buffers@0.1.1` into the shipped bundle through
 * `exceljs -> unzipper -> binary -> buffers`; that package has no verified
 * license. These tests build a tiny real XLSX archive and verify that sheet
 * names, shared strings, inline strings, numbers, formulas, and hidden-sheet
 * skipping still work through the JSZip + DOM reader.
 */

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-xlsx-"))

afterAll(async () => {
	await fs.rm(tempDir, { recursive: true, force: true })
})

async function writeWorkbook(name: string): Promise<string> {
	const zip = new JSZip()
	zip.file(
		"xl/workbook.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Data" sheetId="1" r:id="rId1"/>
    <sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/>
  </sheets>
</workbook>`,
	)
	zip.file(
		"xl/_rels/workbook.xml.rels",
		`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>
  <Relationship Id="rId2" Target="worksheets/sheet2.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>
</Relationships>`,
	)
	zip.file(
		"xl/sharedStrings.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2">
  <si><t>Name</t></si>
  <si><t>Value</t></si>
</sst>`,
	)
	zip.file(
		"xl/worksheets/sheet1.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Alpha</t></is></c><c r="B2" t="n"><v>42</v></c></row>
    <row r="3"><c r="A3" t="str"><f>CONCAT("x","y")</f><v>xy</v></c><c r="B3" t="b"><v>1</v></c></row>
  </sheetData>
</worksheet>`,
	)
	zip.file(
		"xl/worksheets/sheet2.xml",
		`<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Secret hidden sheet</t></is></c></row></sheetData>
</worksheet>`,
	)

	const file = path.join(tempDir, name)
	await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }))
	return file
}

describe("extractTextFromFile .xlsx", () => {
	it("reads sheets, shared strings, inline strings, formulas, and booleans", async () => {
		const text = await extractTextFromFile(await writeWorkbook("sample.xlsx"))
		expect(text).toContain("--- Sheet: Data ---")
		expect(text).toContain("Name\tValue")
		expect(text).toContain("Alpha\t42")
		expect(text).toContain("xy\tTRUE")
	})

	it("does not expose hidden sheets", async () => {
		const text = await extractTextFromFile(await writeWorkbook("hidden.xlsx"))
		expect(text).not.toContain("Hidden")
		expect(text).not.toContain("Secret hidden sheet")
	})
})
