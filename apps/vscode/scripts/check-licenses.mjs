#!/usr/bin/env node

// Release gate for Apache-2.0 and third-party licensing.
//
// Checks:
//  - LICENSE preserves the upstream Cline copyright, names the Bytos
//    modifications, and carries the Apache-2.0 text.
//  - NOTICE exists at the repository root and in the extension package, is
//    byte-identical between the two, and keeps the required attribution.
//  - THIRD-PARTY-NOTICES.txt exists and contains the required license families.
//  - Every UNKNOWN package is explicitly listed in license-exceptions.json.
//  - The extension package declares Apache-2.0, an author, a publisher, an
//    version reachable from package.json, and the files the Marketplace needs.
//  - The VS Code manifest carries the Microsoft-required `publisher` field and a
//    `__metadata` block for the publisher that will make the release.
//  - Optionally, the generated VSIX contains LICENSE.txt, NOTICE,
//    THIRD-PARTY-NOTICES.txt, CHANGELOG.md, package.json and dist/extension.js.
//
// Set BYTOS_PUBLISHER to the Marketplace publisher ID that will sign the
// release (for example `bytos` for bytos.bytos). The gate fails when the
// manifest's `__metadata.publisherId` does not match it, so a stale or
// placeholder identity can never be packaged by accident.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")

const failures = []
const notes = []

function fail(message) {
	failures.push(message)
}

function ok(message) {
	notes.push(message)
}

function read(filePath) {
	return fs.readFileSync(filePath, "utf8")
}

// 1. LICENSE
const licensePath = path.join(repoRoot, "LICENSE")
if (!fs.existsSync(licensePath)) {
	fail("LICENSE is missing at the repository root.")
} else {
	const license = read(licensePath)
	if (!/Apache License\s+Version 2\.0/i.test(license)) {
		fail("LICENSE does not contain the Apache License 2.0 text.")
	}
	if (!/Copyright\s+2026\s+Cline Bot Inc\./i.test(license)) {
		fail("LICENSE does not preserve the upstream Cline copyright notice.")
	}
	if (!/Bytos contributors/i.test(license)) {
		fail("LICENSE does not include a separate Bytos copyright notice.")
	}
	if (!/Bytos modifications/i.test(license)) {
		fail("LICENSE does not state that the file contains Bytos modifications (Apache-2.0 Section 4(b)).")
	}
	if (!/includes software developed as part of the Cline project|github\.com\/cline\/cline/i.test(license)) {
		fail("LICENSE does not identify the upstream Cline project (Apache-2.0 Section 4(c)).")
	}
	ok("LICENSE preserves the upstream Cline copyright and the Apache-2.0 text.")
}

// 2. NOTICE
const rootNotice = path.join(repoRoot, "NOTICE")
const packageNotice = path.join(extensionRoot, "NOTICE")
if (!fs.existsSync(rootNotice)) {
	fail("NOTICE is missing at the repository root.")
} else {
	const notice = read(rootNotice)
	if (!/Cline/i.test(notice)) fail("NOTICE does not mention Cline.")
	if (!/Apache License 2\.0/i.test(notice)) fail("NOTICE does not mention Apache License 2.0.")
	if (!/not endorsed by|not affiliated/i.test(notice)) {
		fail("NOTICE does not disclaim endorsement/affiliation.")
	}
	if (!fs.existsSync(packageNotice)) {
		fail("apps/vscode/NOTICE is missing; the VSIX would not contain the NOTICE.")
	} else if (read(rootNotice) !== read(packageNotice)) {
		fail("apps/vscode/NOTICE is out of sync with the root NOTICE.")
	}
	ok("NOTICE exists, contains the required attribution, and is packaged.")
}

// 3. Third-party notices
const thirdPartyPath = path.join(extensionRoot, "THIRD-PARTY-NOTICES.txt")
const inventoryPath = path.join(extensionRoot, "THIRD-PARTY-NOTICES.json")
if (!fs.existsSync(thirdPartyPath)) {
	fail("apps/vscode/THIRD-PARTY-NOTICES.txt is missing.")
} else {
	const text = read(thirdPartyPath)
	for (const marker of ["@vscode/codicons", "OFL-1.1", "CC-BY-4.0", "MIT", "Apache-2.0"]) {
		if (!text.includes(marker)) fail(`THIRD-PARTY-NOTICES.txt is missing the "${marker}" marker.`)
	}
	ok("THIRD-PARTY-NOTICES.txt exists and covers the required license families.")
}

if (!fs.existsSync(inventoryPath)) {
	fail("apps/vscode/THIRD-PARTY-NOTICES.json is missing; run licenses:generate.")
} else {
	let inventory
	try {
		inventory = JSON.parse(read(inventoryPath))
	} catch (error) {
		fail(`THIRD-PARTY-NOTICES.json is not valid JSON: ${error.message}`)
	}
	if (inventory) {
		const allowed = inventory.exceptions?.allowedUnknown ?? {}
		for (const entry of inventory.unresolved ?? []) {
			const key = `${entry.name}@${entry.version}`
			if (!allowed[key]) {
				fail(`Unresolved license for ${key}; add an explicit exception in license-exceptions.json.`)
			}
		}
		if ((inventory.total ?? 0) < 100) {
			fail(`Third-party inventory contains only ${inventory.total} packages; generation looks incomplete.`)
		}
		ok(
			`Third-party inventory contains ${inventory.total} packages and ${inventory.unresolved?.length ?? 0} unresolved entries.`,
		)
	}
}

// 4. Extension package metadata and changelog
const packageJsonPath = path.join(extensionRoot, "package.json")
if (!fs.existsSync(packageJsonPath)) {
	fail("apps/vscode/package.json is missing.")
} else {
	const pkg = JSON.parse(read(packageJsonPath))
	if (pkg.license !== "Apache-2.0") {
		fail(`apps/vscode/package.json declares license "${pkg.license}", expected Apache-2.0.`)
	}
	if (!fs.existsSync(path.join(extensionRoot, "CHANGELOG.md"))) {
		fail("apps/vscode/CHANGELOG.md is missing; the Marketplace changelog tab would be empty.")
	}
	if (!fs.existsSync(path.join(extensionRoot, "PRIVACY.md"))) {
		fail("apps/vscode/PRIVACY.md is missing from the package.")
	}
	if (!pkg.publisher || typeof pkg.publisher !== "string") {
		fail("apps/vscode/package.json is missing the Microsoft-required `publisher` field.")
	}
	if (!pkg.author || !(pkg.author.name || pkg.author)) {
		fail("apps/vscode/package.json is missing the `author` field.")
	}
	const metadata = pkg.__metadata
	if (!metadata || typeof metadata !== "object") {
		fail(
			"apps/vscode/package.json is missing `__metadata` (publisherId, publisherDisplayName). " +
				"Run `vsce package`/`vsce publish` with the release publisher to record it.",
		)
	} else {
		if (!metadata.publisherId) fail("apps/vscode/package.json `__metadata.publisherId` is missing.")
		if (metadata.publisherId && pkg.publisher && metadata.publisherId !== pkg.publisher) {
			fail(
				`apps/vscode/package.json \`__metadata.publisherId\` ("${metadata.publisherId}") does not match \`publisher\` ("${pkg.publisher}").`,
			)
		}
		if (!metadata.publisherDisplayName) {
			fail("apps/vscode/package.json `__metadata.publisherDisplayName` is missing.")
		}
		const expectedPublisher = process.env.BYTOS_PUBLISHER?.trim()
		if (expectedPublisher && metadata.publisherId && metadata.publisherId !== expectedPublisher) {
			fail(
				`apps/vscode/package.json \`__metadata.publisherId\` ("${metadata.publisherId}") does not match BYTOS_PUBLISHER ("${expectedPublisher}").`,
			)
		}
	}
	if (pkg.engines?.vscode !== "^1.101.0") {
		fail(
			`apps/vscode/package.json declares engines.vscode "${pkg.engines?.vscode}"; ` +
				"this build targets ^1.101.0. Update the documented support matrix before changing it.",
		)
	}
	ok("Extension package declares Apache-2.0, an author, a publisher, and ships a changelog and privacy notice.")
}

// 5. Optional VSIX inspection
const args = process.argv.slice(2)
const vsixArgIndex = args.indexOf("--vsix")
const requireVsix = args.includes("--require-vsix")
let vsixPath
if (vsixArgIndex >= 0 && args[vsixArgIndex + 1]) {
	vsixPath = path.resolve(args[vsixArgIndex + 1])
} else {
	const candidates = fs
		.readdirSync(repoRoot)
		.filter((name) => /^bytos-.*\.vsix$/i.test(name))
		.map((name) => path.join(repoRoot, name))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
	vsixPath = candidates[0]
}

function inspectVsix(filePath) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bytos-vsix-license-"))
	const zipPath = path.join(tempRoot, "package.zip")
	fs.copyFileSync(filePath, zipPath)
	const extractDir = path.join(tempRoot, "extracted")
	if (process.platform === "win32") {
		// Use .NET's ZipFile so extraction neither needs `unzip` nor floods the
		// console with Expand-Archive progress bars. Long paths inside
		// node_modules-style trees are not a concern: the VSIX is flat.
		const ps = (value) => `'${value.replace(/'/g, "''")}'`
		execFileSync(
			"powershell",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
					`[System.IO.Compression.ZipFile]::ExtractToDirectory(${ps(zipPath)}, ${ps(extractDir)})`,
			],
			{ stdio: "pipe", windowsHide: true },
		)
	} else {
		fs.mkdirSync(extractDir, { recursive: true })
		execFileSync("unzip", ["-q", zipPath, "-d", extractDir], { stdio: "pipe" })
	}

	const required = [
		"extension/LICENSE.txt",
		"extension/NOTICE",
		"extension/THIRD-PARTY-NOTICES.txt",
		"extension/CHANGELOG.md",
		"extension/PRIVACY.md",
		"extension/README.md",
		"extension/package.json",
		"extension/dist/extension.js",
		"extension/dist/plugin-runtime/plugin-sandbox-bootstrap.js",
		"extension/webview-ui/build/index.html",
		"extension/assets/icons/icon.png",
		// Voice capture helper: shipped so an installed build can enumerate the
		// microphone. It is a Bytos-authored binary, not a third-party package.
		"extension/assets/voice/bin/win32-x64/bv-os-audio-helper.exe",
		// Voice recognition engine: whisper.cpp (MIT). The licence text must
		// travel with the binary.
		"extension/assets/voice/whisper/b5454/whisper-cli.exe",
		"extension/assets/voice/whisper/LICENSE.whisper.cpp.txt",
	]
	for (const relative of required) {
		if (!fs.existsSync(path.join(extractDir, relative))) {
			fail(`VSIX is missing ${relative}.`)
		}
	}
	// Files that must never ship: source, tests, dev tooling, and secrets.
	// THIRD-PARTY-NOTICES.json is the generator's machine-readable inventory and
	// is intentionally packaged so the VSIX can be audited without the repo.
	const forbidden = [
		"extension/src",
		"extension/node_modules",
		"extension/scripts",
		"extension/tests",
		"extension/proto",
		"extension/.github",
		"extension/.env",
		"extension/.vscodeignore",
		"extension/README.marketplace.md",
		"extension/webview-ui/src",
	]
	for (const relative of forbidden) {
		if (fs.existsSync(path.join(extractDir, relative))) {
			fail(`VSIX unexpectedly contains ${relative}.`)
		}
	}
	const leakedSecrets = [
		"extension/.env.local",
		"extension/.env.production",
		"extension/secrets.json",
		"extension/.vscode-test",
	]
	for (const relative of leakedSecrets) {
		if (fs.existsSync(path.join(extractDir, relative))) {
			fail(`VSIX contains a local secret/config file: ${relative}.`)
		}
	}
	// The extension is the VS Code product: no CLI installer and no OpenCode
	// client/server code may be bundled. Documentation URLs of unrelated
	// providers are allowed; the markers below are integration-only.
	const bundlePath = path.join(extractDir, "extension/dist/extension.js")
	if (fs.existsSync(bundlePath)) {
		const bundle = fs.readFileSync(bundlePath, "utf8")
		const forbiddenBundleMarkers = [
			"@opencode-ai/",
			"ai-sdk-provider-opencode-sdk",
			"installBytosCli",
			"checkCliInstallation",
			"npm install -g bytos",
			"Bytos CLI Version",
		]
		for (const marker of forbiddenBundleMarkers) {
			if (bundle.includes(marker)) {
				fail(`extension bundle contains a forbidden CLI/OpenCode marker: ${marker}.`)
			}
		}
	}
	ok(`VSIX contains the required licensing and runtime files (${filePath}).`)
	fs.rmSync(tempRoot, { recursive: true, force: true })
}

if (vsixArgIndex >= 0 && vsixPath && fs.existsSync(vsixPath)) {
	try {
		inspectVsix(vsixPath)
	} catch (error) {
		fail(`VSIX inspection failed: ${error.message}`)
	}
} else if (requireVsix) {
	if (!vsixPath || !fs.existsSync(vsixPath)) {
		fail("No VSIX found for inspection.")
	} else {
		try {
			inspectVsix(vsixPath)
		} catch (error) {
			fail(`VSIX inspection failed: ${error.message}`)
		}
	}
} else {
	ok("Archive inspection skipped during build; run licenses:check:vsix after packaging.")
}

for (const note of notes) console.log(`[ok] ${note}`)
for (const message of failures) console.error(`[fail] ${message}`)

if (failures.length > 0) {
	console.error(`\nLicense gate failed with ${failures.length} error(s).`)
	process.exit(1)
}

console.log("\nLicense gate passed.")
