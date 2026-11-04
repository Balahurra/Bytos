#!/usr/bin/env node

/**
 * Download ripgrep binaries for all target platforms
 * This script downloads official ripgrep binaries from GitHub releases
 * and extracts them to dist-standalone/ripgrep-binaries/
 */

import { exec, execFile } from "child_process"
import fs from "fs"
import https from "https"
import path from "path"
import { pipeline } from "stream/promises"
import * as tar from "tar"
import { promisify } from "util"
import { createGunzip } from "zlib"

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

const RIPGREP_VERSION = "14.1.1"
const OUTPUT_DIR = "dist-standalone/ripgrep-binaries"

// Platform configurations
const PLATFORMS = [
	{
		name: "darwin-x64",
		archiveName: `ripgrep-${RIPGREP_VERSION}-x86_64-apple-darwin.tar.gz`,
		url: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-apple-darwin.tar.gz`,
		binaryPath: "rg",
		isZip: false,
	},
	{
		name: "darwin-arm64",
		archiveName: `ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`,
		url: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-aarch64-apple-darwin.tar.gz`,
		binaryPath: "rg",
		isZip: false,
	},
	{
		name: "linux-x64",
		archiveName: `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
		url: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
		binaryPath: "rg",
		isZip: false,
	},
	{
		name: "linux-aarch64",
		archiveName: `ripgrep-${RIPGREP_VERSION}-aarch64-unknown-linux-gnu.tar.gz`,
		url: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-aarch64-unknown-linux-gnu.tar.gz`,
		binaryPath: "rg",
		isZip: false,
	},
	{
		name: "win-x64",
		archiveName: `ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`,
		url: `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/ripgrep-${RIPGREP_VERSION}-x86_64-pc-windows-msvc.zip`,
		binaryPath: "rg.exe",
		isZip: true,
	},
]

/**
 * Download a file from a URL
 */
async function downloadFile(url, destPath) {
	return new Promise((resolve, reject) => {
		console.log(`  Downloading: ${url}`)

		https
			.get(url, (response) => {
				if (response.statusCode === 302 || response.statusCode === 301) {
					// Handle redirect before opening the destination: opening a
					// stream here would leave an unclosed handle on the same path
					// while the redirect target downloads into it. On Windows that
					// lock makes the archive unreadable to the extractor.
					response.resume()
					downloadFile(response.headers.location, destPath).then(resolve).catch(reject)
					return
				}

				if (response.statusCode !== 200) {
					response.resume()
					reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`))
					return
				}

				const file = fs.createWriteStream(destPath)
				pipeline(response, file)
					.then(resolve)
					.catch((err) => {
						fs.unlink(destPath, () => {}) // Delete the file on error
						reject(err)
					})
			})
			.on("error", (err) => {
				fs.unlink(destPath, () => {}) // Delete the file on error
				reject(err)
			})
	})
}

/**
 * Extract a tar.gz file
 */
async function extractTarGz(tarPath, destDir) {
	console.log(`  Extracting tar.gz to: ${destDir}`)

	return pipeline(
		fs.createReadStream(tarPath),
		createGunzip(),
		tar.extract({
			cwd: destDir,
			strip: 1, // Remove the top-level directory from the archive
		}),
	)
}

/**
 * Extract a zip file using unzip command
 */
async function extractZip(zipPath, destDir) {
	console.log(`  Extracting zip to: ${destDir}`)

	try {
		// Work with absolute paths and a clean destination: a stale partial
		// extraction must never be mistaken for a successful one.
		const absoluteZip = path.resolve(zipPath)
		const absoluteDest = path.resolve(destDir)
		fs.rmSync(absoluteDest, { recursive: true, force: true })
		fs.mkdirSync(absoluteDest, { recursive: true })

		if (process.platform === "win32") {
			// Windows has no `unzip`; use the in-box Expand-Archive. Pass the
			// script as an argument array so paths never go through cmd quoting.
			const ps = (value) => `'${String(value).replace(/'/g, "''")}'`
			await execFileAsync("powershell", [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`Expand-Archive -LiteralPath ${ps(absoluteZip)} -DestinationPath ${ps(absoluteDest)} -Force`,
			])
		} else {
			// Use -o to overwrite existing files without prompting
			await execAsync(`unzip -o -q "${absoluteZip}" -d "${absoluteDest}"`)
		}
		// Find the extracted directory (usually ripgrep-VERSION-arch)
		const items = fs.readdirSync(destDir)
		const extractedDir = items.find((item) => item.startsWith("ripgrep-"))

		if (extractedDir) {
			// Move files from subdirectory to destDir
			const subDir = path.join(destDir, extractedDir)
			const files = fs.readdirSync(subDir)

			for (const file of files) {
				const srcPath = path.join(subDir, file)
				const destPath = path.join(destDir, file)

				// Remove destination if it exists (to avoid ENOTEMPTY error)
				if (fs.existsSync(destPath)) {
					const stats = fs.statSync(destPath)
					if (stats.isDirectory()) {
						fs.rmSync(destPath, { recursive: true, force: true })
					} else {
						fs.unlinkSync(destPath)
					}
				}

				fs.renameSync(srcPath, destPath)
			}

			// Remove the now-empty subdirectory
			fs.rmdirSync(subDir)
		}
	} catch (error) {
		throw new Error(`Failed to extract zip: ${error.message}`)
	}
}

/**
 * Download and extract ripgrep for a specific platform
 */
async function downloadRipgrepForPlatform(platform) {
	console.log(`\n📦 Processing ${platform.name}...`)

	const platformDir = path.join(OUTPUT_DIR, platform.name)
	const archivePath = path.join(OUTPUT_DIR, platform.archiveName)

	// Create output directory
	fs.mkdirSync(platformDir, { recursive: true })

	try {
		// Download
		await downloadFile(platform.url, archivePath)
		console.log(`  ✓ Downloaded`)

		// Extract
		if (platform.isZip) {
			await extractZip(archivePath, platformDir)
		} else {
			await extractTarGz(archivePath, platformDir)
		}
		console.log(`  ✓ Extracted`)

		// Verify the binary exists
		const binaryPath = path.join(platformDir, platform.binaryPath)
		if (!fs.existsSync(binaryPath)) {
			throw new Error(`Binary not found at ${binaryPath}`)
		}

		// Make binary executable (Unix only)
		if (!platform.isZip) {
			fs.chmodSync(binaryPath, 0o755)
		}
		console.log(`  ✓ Binary ready: ${binaryPath}`)

		// Clean up archive file
		fs.unlinkSync(archivePath)
		console.log(`  ✓ Cleaned up`)

		return true
	} catch (error) {
		console.error(`  ✗ Failed: ${error.message}`)
		throw error
	}
}

/**
 * Main function
 */
async function main() {
	console.log("🚀 Ripgrep Binary Downloader")
	console.log(`   Version: ${RIPGREP_VERSION}`)
	console.log(`   Output: ${OUTPUT_DIR}`)

	// Create output directory
	fs.mkdirSync(OUTPUT_DIR, { recursive: true })

	// Download for all platforms
	const results = []
	for (const platform of PLATFORMS) {
		try {
			await downloadRipgrepForPlatform(platform)
			results.push({ platform: platform.name, success: true })
		} catch (error) {
			results.push({ platform: platform.name, success: false, error: error.message })
		}
	}

	// Print summary
	console.log("\n" + "=".repeat(50))
	console.log("📊 Summary:")
	console.log("=".repeat(50))

	let successCount = 0
	for (const result of results) {
		const status = result.success ? "✅" : "❌"
		console.log(`${status} ${result.platform}`)
		if (result.success) {
			successCount++
		} else {
			console.log(`   Error: ${result.error}`)
		}
	}

	console.log("=".repeat(50))
	console.log(`✓ ${successCount}/${PLATFORMS.length} platforms successful`)

	if (successCount < PLATFORMS.length) {
		process.exit(1)
	}

	console.log("\n✅ All ripgrep binaries downloaded successfully!")
}

// Run the script
main().catch((error) => {
	console.error("\n❌ Fatal error:", error)
	process.exit(1)
})
