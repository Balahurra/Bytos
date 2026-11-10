import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

// `vsce package` requires a README and copies the packaged one to README.md
// inside the VSIX. scripts/marketplace-readme.mjs swaps README.marketplace.md
// into README.md before packaging, so these assertions describe the exact text
// the Marketplace listing shows. They also pin the packaging rules that keep
// source, tests, and local configuration out of the VSIX.

const extensionRoot = path.resolve(__dirname, "..", "..")
const repoRoot = path.resolve(extensionRoot, "..", "..")
const packageReadme = path.join(__dirname, "README.package.md")
const marketplaceReadme = path.join(extensionRoot, "README.marketplace.md")

const read = (file: string) => fs.readFileSync(file, "utf8")

describe("packaged README", () => {
	const text = read(packageReadme)
	const packageJson = JSON.parse(read(path.join(extensionRoot, "package.json")))
	const engines = packageJson.engines.vscode

	it("stays in sync with README.marketplace.md", () => {
		expect(text).toBe(read(marketplaceReadme))
	})

	it("states the supported VS Code range from package.json", () => {
		expect(text).toContain(`\`engines.vscode\` is \`${engines}\``)
	})

	it("explains that the build is bring-your-own-key with no Bytos backend", () => {
		expect(text).toMatch(/bring-your-own-key/i)
		expect(text).toMatch(/no Bytos backend/i)
	})

	it("documents where API keys are stored and that telemetry is opt-in", () => {
		expect(text).toMatch(/SecretStorage/)
		expect(text).toMatch(/Telemetry is off by default/i)
		expect(text).toContain("PRIVACY.md")
	})

	it("carries the Apache-2.0 license, the Cline attribution, and third-party notices", () => {
		expect(text).toMatch(/Apache License 2\.0/)
		expect(text).toContain("https://github.com/cline/cline")
		expect(text).toContain("Copyright 2026 Cline Bot Inc.")
		expect(text).toContain("THIRD-PARTY-NOTICES.txt")
		expect(text).toContain("TRADEMARKS.md")
		expect(text).toMatch(/not endorsed by, sponsored by, or affiliated/)
	})

	it("gives users a contact channel for bugs and vulnerabilities", () => {
		expect(text).toContain("https://github.com/Balahurra/Bytos/issues")
		expect(text).toContain("security/advisories/new")
	})

	it("links to the published Marketplace listing and the official community channels", () => {
		expect(text).toContain("marketplace.visualstudio.com/items?itemName=Bytos.bytos")
		expect(text).toContain("https://bytos.dev/")
		expect(text).toContain("https://github.com/Balahurra/Bytos")
		expect(text).toContain("https://discord.gg/2hSFZY9Bs")
	})

	it("does not claim a provider integration or compliance status that is not implemented", () => {
		expect(text).not.toMatch(/GDPR compliant/i)
		expect(text).not.toMatch(/SOC ?2 certified/i)
	})

	it("has no mojibake from an earlier encoding round-trip", () => {
		expect(text).not.toMatch(/[\u00c2\u00e2\u0080]/)
	})
})

describe("packaging rules", () => {
	const vsCodeIgnore = fs
		.readFileSync(path.join(extensionRoot, ".vscodeignore"), "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))

	const ignored = (pattern: string) => vsCodeIgnore.includes(pattern)

	it("keeps source, tests, and build scripts out of the VSIX", () => {
		for (const pattern of ["src/**", "tests/**", "scripts/**", "esbuild.mjs", "tsconfig*.json"]) {
			expect(ignored(pattern), `${pattern} must be in .vscodeignore`).toBe(true)
		}
	})

	it("keeps local configuration and secrets out of the VSIX", () => {
		for (const pattern of [".env", ".env.example", ".vscode-test/**", ".github/**"]) {
			expect(ignored(pattern), `${pattern} must be in .vscodeignore`).toBe(true)
		}
	})

	it("ships the licensing and notice files", () => {
		for (const file of ["LICENSE", "NOTICE", "CHANGELOG.md", "PRIVACY.md", "THIRD-PARTY-NOTICES.txt"]) {
			expect(fs.existsSync(path.join(extensionRoot, file)), `${file} must exist in apps/vscode`).toBe(true)
		}
		const ignoredFiles = ["LICENSE", "NOTICE", "CHANGELOG.md", "PRIVACY.md", "THIRD-PARTY-NOTICES.txt"]
		for (const file of ignoredFiles) {
			expect(ignored(file), `${file} must not be excluded from the VSIX`).toBe(false)
		}
	})

	it("keeps the webview build and the bundled plugin runtime", () => {
		expect(ignored("webview-ui/src/**")).toBe(true)
		expect(ignored("dist")).toBe(false)
		expect(ignored("dist/**")).toBe(false)
	})

	it("keeps the repository-local reports out of every package", () => {
		const gitignore = read(path.join(repoRoot, ".gitignore"))
		expect(gitignore).toMatch(/^\*\.vsix$/m)
	})
})
