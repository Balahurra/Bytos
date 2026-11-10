#!/usr/bin/env node
/**
 * Local release security gate.
 *
 * Usage:
 *   node scripts/security/release-gate.mjs [path/to/extension.vsix] [--skip-deps]
 *
 * Fails on high/critical dependency advisories in every shipped/independent
 * dependency graph and runs the independent VSIX content/secret scan.
 */

import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const args = process.argv.slice(2)
const skipDeps = args.includes("--skip-deps")
const vsixPath = args.find((value) => value.toLowerCase().endsWith(".vsix"))

function run(command, commandArgs, cwd, options = {}) {
	console.log(`\n$ ${command} ${commandArgs.join(" ")}`)
	const result = spawnSync(command, commandArgs, {
		cwd,
		stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
		encoding: "utf8",
		env: process.env,
		shell: process.platform === "win32",
	})
	if (result.status !== 0 && !options.allowNonZero) {
		console.error(`\nRelease security gate: FAILED (${path.basename(cwd)}: ${command})`)
		process.exit(result.status ?? 1)
	}
	return result
}

/**
 * `npm audit` has no `--audit-level` flag and exits 1 for any severity, so
 * parse its JSON and only fail on high/critical advisories.
 */
function npmAuditGate(cwd) {
	console.log(`\n$ npm audit (high/critical gate) [${path.basename(cwd)}]`)
	const result = run("npm", ["audit", "--json"], cwd, {
		capture: true,
		allowNonZero: true,
	})
	let report
	try {
		report = JSON.parse(result.stdout || "{}")
	} catch (error) {
		console.error(`Could not parse npm audit output in ${cwd}: ${error.message}`)
		process.exit(1)
	}
	const blocking = Object.entries(report.vulnerabilities ?? {}).filter(
		([, value]) => value.severity === "high" || value.severity === "critical",
	)
	if (blocking.length > 0) {
		for (const [name, value] of blocking) {
			console.error(`  ${value.severity.toUpperCase()} ${name}`)
		}
		console.error(`\nRelease security gate: FAILED (${cwd})`)
		process.exit(1)
	}
	const counts = report.metadata?.vulnerabilities ?? {}
	console.log(
		`  no high/critical advisories (low=${counts.low ?? 0}, moderate=${counts.moderate ?? 0})`,
	)
}

if (!skipDeps) {
	run("bun", ["audit", "--audit-level=high"], repoRoot)
	npmAuditGate(path.join(repoRoot, "docs"))
	npmAuditGate(path.join(repoRoot, "evals", "analysis"))
	npmAuditGate(path.join(repoRoot, "evals"))
	npmAuditGate(path.join(repoRoot, "apps", "vscode", "standalone", "runtime-files"))
}

run(
	"node",
	[path.join(repoRoot, "scripts", "security", "check-vsix.mjs"), ...(vsixPath ? [vsixPath] : [])],
	repoRoot,
)

console.log("\nRelease security gate: PASSED")
