#!/usr/bin/env node
// Packages the extension into a .vsix and inspects the archive.
//
// `vsce package` runs the `vscode:prepublish` script, which ends in
// `bun run lint` -> `lint:proto` -> `bash ./scripts/proto-lint.sh`. That Bash
// step does not exist on Windows, so packaging fails on this host even though
// the extension bundle and the webview are already built. This helper:
//
//   1. runs every prepublish step except the Bash proto lint (typecheck, Biome
//      lint, production webview build, esbuild bundle, notice generation, and
//      the licensing gate),
//   2. swaps README.marketplace.md into README.md the same way
//      scripts/publish-marketplace.mjs does, so the packaged README is the one
//      the Marketplace will render,
//   3. packages with `vsce package --no-dependencies`, skipping prepublish
//      because this script already ran it,
//   4. restores README.md and prints the packaged file list plus a check that
//      source, tests, and local configuration stayed out of the archive.
//
// Order matters: the licensing gate runs after `vsce package` has produced the
// archive, so the archive is inspected as built. Note that `vsce package` does
// not write `__metadata`; that block is written by `vsce publish` when it
// resolves the publisher from the Marketplace token. Until the release publish
// has run, the gate reports the missing `__metadata` as its only failure, which
// is the intended "publishable but not yet published" signal. Pass
// BYTOS_PUBLISHER to assert the publisher identity once that block exists.
//
// Usage:
//   node scripts/package-release.mjs              # writes bytos-<version>.vsix in the repo root
//   node scripts/package-release.mjs --out x.vsix # write somewhere else
//
// This never publishes anything.

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { restore, swapIn } from "./marketplace-readme.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const extensionRoot = path.resolve(__dirname, "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")

const outIndex = process.argv.indexOf("--out")
const pkg = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"))
const outFile =
	outIndex !== -1 && process.argv[outIndex + 1]
		? path.resolve(process.argv[outIndex + 1])
		: path.join(repoRoot, `bytos-${pkg.version}.vsix`)

function run(command, args, options = {}) {
	console.log(`\n$ ${command} ${args.join(" ")}`)
	// Windows resolves `bunx`/`vsce` only through their .cmd shims, which
	// spawnSync cannot find without a shell.
	execFileSync(command, args, { stdio: "inherit", cwd: extensionRoot, shell: process.platform === "win32", ...options })
}

// Step 1: the prepublish pipeline without the Bash-only proto lint.
run("bunx", ["tsc", "--noEmit"])
run("bunx", ["tsc", "--project", "tsconfig.vscode-compat.json", "--noEmit"])
run("bunx", [
	"biome",
	"lint",
	"--config-path",
	"./biome.jsonc",
	"--no-errors-on-unmatched",
	"--files-ignore-unknown=true",
	"--diagnostic-level=error",
])
run("bun", ["run", "build:webview"])
run("bun", ["esbuild.mjs", "--production"])
run("node", ["scripts/generate-third-party-notices.mjs"])

// Step 2 + 3: package with the marketplace README in place.
//
// `vsce package` always runs vscode:prepublish, and that script ends in a
// Bash-only proto lint that cannot run on Windows. Swap in a no-op prepublish
// for the duration of the package call, restore the manifest afterwards, and run
// the real prepublish steps explicitly above.
const manifestPath = path.join(extensionRoot, "package.json")
const originalManifest = fs.readFileSync(manifestPath, "utf8")
const stagedManifest = JSON.parse(originalManifest)
stagedManifest.scripts = { ...stagedManifest.scripts, "vscode:prepublish": 'node -e "process.exit(0)"' }
fs.writeFileSync(manifestPath, `${JSON.stringify(stagedManifest, null, "\t")}\n`, "utf8")

const swap = swapIn()
let packagingFailed = false
try {
	run("bunx", ["--bun", "@vscode/vsce", "package", "--no-dependencies", "--out", outFile])
} catch (error) {
	packagingFailed = true
	throw error
} finally {
	if (!swap.skipped) restore()
	fs.writeFileSync(manifestPath, originalManifest, "utf8")
	if (packagingFailed) {
		console.error("\nPackaging failed. README.md and package.json were restored.")
	} else {
		console.log("\nRestored README.md and package.json after packaging.")
	}
}

if (!fs.existsSync(outFile)) {
	console.error(`[fail] vsce did not produce ${outFile}`)
	process.exit(1)
}

// Step 3b: the licensing gate, now that packaging has produced the archive.
//
// `vsce package` does not add `__metadata` (that block is written by
// `vsce publish`, which resolves the publisher from the Marketplace PAT). Until
// the release publish has run, the gate reports the missing `__metadata` as its
// only failure; that is the intended signal that the tree is ready to package but
// the publisher identity is not yet recorded. `apps/vscode/package.json` is
// restored to its source form in the finally block above, so packaging never
// leaves manifest churn behind.
run("node", ["scripts/check-licenses.mjs", "--vsix", outFile])

// Step 4: inspect the archive.
const listing = execFileSync("bunx", ["--bun", "@vscode/vsce", "ls", "--no-dependencies"], {
	cwd: extensionRoot,
	encoding: "utf8",
	shell: process.platform === "win32",
})
const files = listing.split(/\r?\n/).filter((line) => line.trim().length > 0)
const forbidden = [/^src\//, /^node_modules\//, /^scripts\//, /^tests\//, /^proto\//, /^\.github\//, /^\.env/, /\.map$/]
const leaked = files.filter((file) => forbidden.some((pattern) => pattern.test(file)))
const required = [
	"LICENSE",
	"NOTICE",
	"THIRD-PARTY-NOTICES.txt",
	"CHANGELOG.md",
	"PRIVACY.md",
	"README.md",
	"package.json",
	"dist/extension.js",
	"dist/plugin-runtime/plugin-sandbox-bootstrap.js",
	"webview-ui/build/index.html",
	"assets/icons/icon.png",
]
const missing = required.filter((file) => !files.includes(file))

fs.writeFileSync(`${outFile}.files.txt`, `${files.join("\n")}\n`, "utf8")
const size = fs.statSync(outFile).size

console.log(`\nVSIX: ${outFile} (${(size / (1024 * 1024)).toFixed(1)} MB, ${files.length} files)`)
console.log(`File list: ${outFile}.files.txt`)
console.log(`Required files present: ${missing.length === 0 ? "yes" : `NO -> ${missing.join(", ")}`}`)
console.log(`Unexpected files: ${leaked.length === 0 ? "none" : leaked.join(", ")}`)

if (missing.length > 0 || leaked.length > 0) {
	process.exit(1)
}
console.log("Archive inspection passed.")
