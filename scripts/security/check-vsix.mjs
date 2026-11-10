#!/usr/bin/env node
/**
 * Independent VSIX security/content gate.
 *
 * Usage:
 *   node scripts/security/check-vsix.mjs [path/to/extension.vsix]
 *
 * The script does not trust the packaging configuration. It opens the actual
 * archive, validates required runtime files, rejects development/test/unexpected
 * payloads, and scans text members for common credential shapes.
 */

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const requireFromExtension = createRequire(
	pathToFileURL(path.join(repoRoot, "apps", "vscode", "package.json")),
)
const JSZip = requireFromExtension("jszip")

// Each entry is a list of accepted names (vsce normalizes LICENSE -> LICENSE.txt).
const REQUIRED_MEMBERS = [
	["package.json"],
	["dist/extension.js"],
	["webview-ui/build/index.html"],
	["LICENSE", "LICENSE.txt"],
	["NOTICE", "NOTICE.txt"],
	["THIRD-PARTY-NOTICES.txt"],
]

// Development/test/agent-tooling payloads that must never ship. Runtime
// workspace packages inside dist/plugin-runtime are intentionally allowed.
const FORBIDDEN_PATTERNS = [
	{ pattern: /(^|\/)\.env(\.|$)/i, reason: "environment file" },
	{ pattern: /(^|\/)\.git(\/|$)/i, reason: "git metadata" },
	{ pattern: /\.map$/i, reason: "source map" },
	{ pattern: /\.(pem|key|p12|pfx|crt)$/i, reason: "private key or certificate" },
	{ pattern: /(^|\/)(tests?|__tests__|coverage|test-assets|test-results|\.vscode-test)(\/|$)/i, reason: "test tooling/assets" },
	{ pattern: /(^|\/)(docs|evals|examples)(\/|$)/i, reason: "documentation/evals/examples" },
	{ pattern: /(^|\/)tmp(\/|$)/i, reason: "temporary/debug files" },
	{ pattern: /(^|\/)(src|proto|scripts|testing-platform|standalone)(\/|$)/i, reason: "development source/tooling" },
	{ pattern: /(^|\/)(package-lock\.json|bun\.lock|bun\.lockb|yarn\.lock|pnpm-lock\.yaml)$/i, reason: "lockfile" },
	{ pattern: /\.(test|spec)\.[cm]?[jt]sx?$/i, reason: "test file" },
	{ pattern: /(^|\/)(esbuild\.mjs|knip\.json|biome\.jsonc?|vite\.config\..*|vitest\.config\..*|playwright\.config\..*|tsconfig.*\.json)$/i, reason: "build/test configuration" },
	{ pattern: /(^|\/)README\.marketplace\.md$/i, reason: "marketplace-only source file" },
]

const TEXT_EXTENSIONS = new Set([
	".js",
	".cjs",
	".mjs",
	".json",
	".txt",
	".md",
	".html",
	".css",
	".yml",
	".yaml",
])

const SECRET_PATTERNS = [
	{ name: "RSA/EC/OpenSSH private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
	{ name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
	{ name: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
	{ name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36,}\b/ },
	{ name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
	{ name: "OpenAI-style key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
	{ name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
	{ name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
	{ name: "Stripe live key", pattern: /\bsk_live_[0-9A-Za-z]{20,}\b/ },
]

function fail(message) {
	console.error(`✗ ${message}`)
	process.exitCode = 1
}

function pickVsixPath() {
	const arg = process.argv[2]
	if (arg) {
		return path.resolve(arg)
	}
	const candidates = fs
		.readdirSync(repoRoot)
		.filter((name) => name.toLowerCase().endsWith(".vsix"))
		.map((name) => path.join(repoRoot, name))
		.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
	if (candidates.length === 0) {
		throw new Error("No .vsix found in the repository root; pass a path explicitly.")
	}
	return candidates[0]
}

function isTextMember(name, size) {
	if (size > 2_000_000) return false
	return TEXT_EXTENSIONS.has(path.extname(name).toLowerCase())
}

function scanSecrets(name, text) {
	const findings = []
	for (const rule of SECRET_PATTERNS) {
		if (rule.pattern.test(text)) {
			findings.push(`${name}: ${rule.name}`)
		}
	}
	return findings
}

const vsixPath = pickVsixPath()
if (!fs.existsSync(vsixPath)) {
	throw new Error(`VSIX not found: ${vsixPath}`)
}

const buffer = fs.readFileSync(vsixPath)
const sha256 = createHash("sha256").update(buffer).digest("hex")
const zip = await JSZip.loadAsync(buffer)
// vsce stores extension payload under `extension/`; normalize so checks and
// required-member assertions are independent of the packaging layout.
const entries = Object.values(zip.files).filter((entry) => !entry.dir)
const memberName = (entry) => entry.name.replace(/^extension\//, "")

const names = entries.map(memberName)
console.log(`VSIX: ${vsixPath}`)
console.log(`Size: ${buffer.length} bytes`)
console.log(`SHA-256: ${sha256}`)
console.log(`Files: ${names.length}`)

for (const alternatives of REQUIRED_MEMBERS) {
	if (!alternatives.some((member) => names.includes(member))) {
		fail(`missing required member: ${alternatives.join(" or ")}`)
	}
}

for (const name of names) {
	for (const rule of FORBIDDEN_PATTERNS) {
		if (rule.pattern.test(name)) {
			fail(`forbidden member (${rule.reason}): ${name}`)
		}
	}
	// node_modules is only legitimate for the extension's bundled plugin
	// runtime; anything else means vsce walked workspace dependencies.
	if (name.includes("node_modules/") && !name.startsWith("dist/plugin-runtime/")) {
		fail(`unexpected node_modules payload: ${name}`)
	}
}

const manifestEntry = zip.file("extension/package.json") ?? zip.file("package.json")
if (!manifestEntry) {
	fail("cannot read package.json from the VSIX")
} else {
	const manifest = JSON.parse(await manifestEntry.async("string"))
	console.log(
		`Manifest: ${manifest.publisher ?? "?"}.${manifest.name ?? "?"}@${manifest.version ?? "?"} (vscode ${manifest.engines?.vscode ?? "?"})`,
	)
	if (!manifest.publisher || !manifest.name || !manifest.version) {
		fail("package.json is missing publisher/name/version")
	}
	if (!manifest.engines?.vscode) {
		fail("package.json is missing engines.vscode")
	}
}

const secretFindings = []
for (const entry of entries) {
	if (!isTextMember(memberName(entry), entry._data?.uncompressedSize ?? 0)) {
		continue
	}
	try {
		const text = await entry.async("string")
		secretFindings.push(...scanSecrets(memberName(entry), text))
	} catch {
		// Binary or unreadable member: skip content scan.
	}
}
for (const finding of secretFindings) {
	fail(`possible credential in package: ${finding}`)
}

const executables = names.filter((name) => /\.(exe|dll|node|so|dylib)$/i.test(name))
console.log(`Native/executable members: ${executables.length}`)
for (const name of executables) {
	console.log(`  - ${name}`)
}

if (process.exitCode) {
	console.error("\nVSIX security gate: FAILED")
} else {
	console.log("\nVSIX security gate: PASSED")
}
