#!/usr/bin/env node
// Generates the third-party notice inventory and the packaged NOTICE files.
//
// The inventory is intentionally a superset of the production bundle: it walks
// the installed dependency tree so that every package that could be linked into
// the extension, webview, or plugin runtime is represented. Packages that are
// known to be development-only or test fixtures are skipped by path. Anything
// with an unresolved license is written to the inventory and must be listed in
// license-exceptions.json before the release gate will pass.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")

const SKIP_DIR_NAMES = new Set([".bin", ".cache", ".git", "node_modules", "dist", "build", "out"])
const SKIP_PATH_SEGMENTS = new Set(["test", "tests", "__tests__", "fixtures", "__fixtures__", "examples", "playground"])

const packages = new Map()
const unresolved = []

function readText(filePath) {
	try {
		return fs.readFileSync(filePath, "utf8")
	} catch {
		return ""
	}
}

function firstCopyright(text) {
	const lines = text.split(/\r?\n/)
	for (const line of lines) {
		if (/copyright|\(c\)/i.test(line)) {
			const cleaned = line
				.replace(/[\u0000-\u001f]/g, " ")
				.replace(/\s+/g, " ")
				.trim()
			if (cleaned.length > 0) return cleaned.slice(0, 220)
		}
	}
	return ""
}

function detectLicenseFromText(text) {
	if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return "MIT"
	if (/Apache License\s+Version 2\.0/i.test(text)) return "Apache-2.0"
	if (/ISC License|Permission to use, copy, modify, and\/or distribute/i.test(text)) return "ISC"
	if (/BSD 3-Clause|Neither the name/i.test(text)) return "BSD-3-Clause"
	if (/BSD 2-Clause|Redistribution and use in source and binary forms/i.test(text)) return "BSD-2-Clause"
	if (/The Unlicense|free and unencumbered software released into the public domain/i.test(text)) {
		return "Unlicense"
	}
	if (/Mozilla Public License/i.test(text)) return "MPL-2.0"
	if (/GNU Lesser General Public License/i.test(text)) return "LGPL-2.1+"
	if (/GNU General Public License/i.test(text)) return "GPL"
	return ""
}

function findLicenseFile(dir) {
	let entries = []
	try {
		entries = fs.readdirSync(dir)
	} catch {
		return undefined
	}
	const preferred = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "COPYING", "COPYING.md", "NOTICE"]
	for (const name of preferred) {
		const match = entries.find((entry) => entry.toLowerCase() === name.toLowerCase())
		if (match) return path.join(dir, match)
	}
	const loose = entries.find((entry) => /^(licen[cs]e|copying|notice)/i.test(entry))
	return loose ? path.join(dir, loose) : undefined
}

function normalizeLicense(value) {
	if (typeof value === "string" && value.trim()) return value.trim()
	if (Array.isArray(value)) {
		return value
			.map((entry) => (typeof entry === "string" ? entry : entry?.type))
			.filter(Boolean)
			.join(" OR ")
	}
	if (value && typeof value === "object" && typeof value.type === "string") return value.type
	return ""
}

function collectPackage(dir) {
	const pkgPath = path.join(dir, "package.json")
	if (!fs.existsSync(pkgPath)) return

	let pkg
	try {
		pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
	} catch {
		return
	}
	if (!pkg.name || !pkg.version) return

	const key = `${pkg.name}@${pkg.version}`
	if (packages.has(key)) return

	const licenseFile = findLicenseFile(dir)
	const licenseText = licenseFile ? readText(licenseFile) : ""
	let license = normalizeLicense(pkg.license) || normalizeLicense(pkg.licenses)
	if (!license || /^SEE LICENSE IN/i.test(license)) {
		license = detectLicenseFromText(licenseText) || "UNKNOWN"
	}
	if (license === "UNKNOWN" && licenseText) {
		const detected = detectLicenseFromText(licenseText)
		if (detected) license = detected
	}

	const repo =
		typeof pkg.repository === "string"
			? pkg.repository
			: typeof pkg.repository?.url === "string"
				? pkg.repository.url
				: typeof pkg.homepage === "string"
					? pkg.homepage
					: ""

	const entry = {
		name: pkg.name,
		version: pkg.version,
		license,
		repository: repo.replace(/^git\+/, "").replace(/\.git$/, ""),
		copyright: firstCopyright(licenseText),
		private: Boolean(pkg.private),
	}

	packages.set(key, entry)
	if (license === "UNKNOWN") unresolved.push(entry)
}

function walk(dir, depth = 0) {
	if (depth > 14) return
	let entries
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		if (SKIP_DIR_NAMES.has(entry.name) && entry.name !== "node_modules") continue
		if (SKIP_PATH_SEGMENTS.has(entry.name)) continue
		const full = path.join(dir, entry.name)
		// Only collect real package roots. Walking every directory also picked up
		// fixture package.json files inside a dependency (for example
		// node-pre-gyp's `nw-pre-gyp` test app and github-from-package's
		// `example/package.json` named "beep-boop") and private subpath
		// manifests such as posthog-js/customizations. Those are not separately
		// distributed packages and must not appear as unresolved dependencies.
		if (isPackageRoot(full)) {
			collectPackage(full)
		}
		walk(full, depth + 1)
	}
}

function isPackageRoot(dir) {
	const parent = path.dirname(dir)
	const grandparent = path.dirname(parent)
	const parentName = path.basename(parent)
	if (parentName === "node_modules") return true
	// Scoped package: node_modules/@scope/name
	return parentName.startsWith("@") && path.basename(grandparent) === "node_modules"
}

const roots = [path.join(repoRoot, "node_modules"), path.join(extensionRoot, "node_modules")]
for (const root of roots) {
	if (fs.existsSync(root)) {
		// Scan the .bun store and the top-level links.
		walk(root)
	}
}

const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

const licenseCounts = new Map()
for (const entry of sorted) {
	const key = entry.license || "UNKNOWN"
	licenseCounts.set(key, (licenseCounts.get(key) ?? 0) + 1)
}
const summary = [...licenseCounts.entries()].sort((a, b) => b[1] - a[1])

const exceptionsPath = path.join(__dirname, "license-exceptions.json")
let exceptions = { allowedUnknown: {} }
if (fs.existsSync(exceptionsPath)) {
	try {
		exceptions = JSON.parse(fs.readFileSync(exceptionsPath, "utf8"))
	} catch {
		exceptions = { allowedUnknown: {} }
	}
}

const lines = []
lines.push("THIRD-PARTY NOTICES")
lines.push("===================")
lines.push("")
lines.push("Bytos is distributed under the Apache License, Version 2.0 (see LICENSE).")
lines.push("This file lists third-party software that may be included in the Bytos")
lines.push("VS Code extension, its webview, or its bundled plugin runtime, together")
lines.push("with the license declared by each package.")
lines.push("")
lines.push("The inventory is generated from the installed dependency tree. It is a")
lines.push("superset of the production bundle: packages that are only used for")
lines.push("development or testing are included for transparency. If a package is not")
lines.push("actually distributed, its notice is still provided here.")
lines.push("")
lines.push("This file is not a legal opinion. See LICENSE-COMPLIANCE-REPORT.md for")
lines.push("verified obligations and remaining uncertainties.")
lines.push("")
lines.push(`Generated: ${new Date().toISOString()}`)
lines.push(`Packages: ${sorted.length}`)
lines.push("")
lines.push("License summary")
lines.push("---------------")
for (const [license, count] of summary) {
	lines.push(`${license}\t${count}`)
}
lines.push("")
lines.push("Package inventory")
lines.push("-----------------")
lines.push("Name\tVersion\tLicense\tRepository\tCopyright")
for (const entry of sorted) {
	lines.push(
		[entry.name, entry.version, entry.license, entry.repository, entry.copyright]
			.map((value) => String(value ?? "").replace(/\t/g, " "))
			.join("\t"),
	)
}
lines.push("")
lines.push("License texts")
lines.push("-------------")
lines.push("")
lines.push("MIT License")
lines.push("-----------")
lines.push(`Copyright (c) the respective contributors.
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`)
lines.push("")
lines.push("ISC License")
lines.push("-----------")
lines.push(`Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`)
lines.push("")
lines.push("BSD 2-Clause and BSD 3-Clause")
lines.push("-----------------------------")
lines.push(`Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

For the 3-Clause variant, the following additional condition applies:
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.`)
lines.push("")
lines.push("Apache License 2.0")
lines.push("------------------")
lines.push("The complete Apache License 2.0 text is included in the LICENSE file at")
lines.push("the root of this package. Apache-2.0 packages listed above are covered by")
lines.push("that text. If a package includes its own NOTICE file, its attribution is")
lines.push("reproduced in the package's repository and is acknowledged here.")
lines.push("")
lines.push("MPL-2.0 / LGPL / GPL family")
lines.push("--------------------------")
lines.push("Packages under the Mozilla Public License 2.0, GNU Lesser General Public")
lines.push("License, or GNU General Public License are identified in the inventory")
lines.push("above. If any such package is actually distributed, additional obligations")
lines.push("may apply (source availability, relinking, or notice requirements).")
lines.push("See LICENSE-COMPLIANCE-REPORT.md for the current assessment.")
lines.push("")
lines.push("OFL-1.1 (fonts)")
lines.push("---------------")
lines.push("The Geist and Geist Mono fonts are licensed under the SIL Open Font")
lines.push("License 1.1. The license text is available at")
lines.push("https://openfontlicense.org/open-font-license-official-text/ and is")
lines.push("included here by reference. The font names are not trademarks of Bytos.")
lines.push("")
lines.push("CC-BY-4.0 (icons and data)")
lines.push("---------------------------")
lines.push("@vscode/codicons 0.0.36 is licensed under Creative Commons Attribution")
lines.push("4.0. Copyright (c) Microsoft Corporation. Source:")
lines.push("https://github.com/microsoft/vscode-codicons. License:")
lines.push("https://creativecommons.org/licenses/by/4.0/legalcode")
lines.push("Bytos packages the codicon.ttf font from that package; no Bytos")
lines.push("modification to the font file is recorded.")
lines.push("")
lines.push("caniuse-lite is listed in the inventory for transparency but is not")
lines.push("present in the packaged extension bundle. If it is ever distributed,")
lines.push("credit the caniuse.com contributors and the Can I Use data project:")
lines.push("https://github.com/browserslist/caniuse-lite (CC-BY-4.0).")
lines.push("")
lines.push("Unlicense / public domain")
lines.push("-------------------------")
lines.push(`This is free and unencumbered software released into the public domain.
Anyone is free to copy, modify, publish, use, compile, sell, or distribute
this software, either in source code form or as a compiled binary, for any
purpose, commercial or non-commercial, and by any means.`)
lines.push("")
lines.push("Native binaries")
lines.push("---------------")
lines.push("Bytos Voice ships native binaries that are not npm packages:")
lines.push("")
lines.push("- bv-os-audio-helper.exe (0.1.0) - Bytos-authored WASAPI capture helper.")
lines.push("  Licensed under the Apache License 2.0, same as Bytos. Contains no")
lines.push("  third-party code.")
lines.push("- whisper.cpp (release b5454) - MIT License,")
lines.push("  Copyright (c) 2023-2026 The ggml authors.")
lines.push("  Project: https://github.com/ggml-org/whisper.cpp")
lines.push("  Files: whisper-cli.exe, whisper.dll, ggml.dll, ggml-base.dll, llama.dll,")
lines.push("  ggml-cpu-*.dll. The MIT license text above applies. The full license text")
lines.push("  is also bundled at assets/voice/whisper/LICENSE.whisper.cpp.txt.")
lines.push("")
lines.push("Unresolved licenses")
lines.push("-------------------")
if (unresolved.length === 0) {
	lines.push("None.")
} else {
	for (const entry of unresolved) {
		const reason = exceptions.allowedUnknown?.[`${entry.name}@${entry.version}`]
		lines.push(`${entry.name}@${entry.version}: ${reason ?? "UNRESOLVED - legal review required"}`)
	}
}
lines.push("")
lines.push("End of third-party notices.")

const inventory = {
	generatedAt: new Date().toISOString(),
	total: sorted.length,
	summary: summary.map(([license, count]) => ({ license, count })),
	unresolved,
	exceptions,
	packages: sorted,
}

fs.writeFileSync(path.join(extensionRoot, "THIRD-PARTY-NOTICES.txt"), `${lines.join("\n")}\n`, "utf8")
fs.writeFileSync(path.join(extensionRoot, "THIRD-PARTY-NOTICES.json"), `${JSON.stringify(inventory, null, 2)}\n`, "utf8")

const rootNotice = path.join(repoRoot, "NOTICE")
if (fs.existsSync(rootNotice)) {
	fs.copyFileSync(rootNotice, path.join(extensionRoot, "NOTICE"))
}

const rootChangelog = path.join(repoRoot, "CHANGELOG.md")
if (fs.existsSync(rootChangelog)) {
	fs.copyFileSync(rootChangelog, path.join(extensionRoot, "CHANGELOG.md"))
}

const rootPrivacy = path.join(repoRoot, "PRIVACY.md")
if (fs.existsSync(rootPrivacy)) {
	fs.copyFileSync(rootPrivacy, path.join(extensionRoot, "PRIVACY.md"))
}

console.log(
	`[licenses] wrote ${path.join(extensionRoot, "THIRD-PARTY-NOTICES.txt")} (${sorted.length} packages, ${unresolved.length} unresolved)`,
)
