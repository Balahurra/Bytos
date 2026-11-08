// Voice F1 smoke runner (real VS Code extension host).
//
// Launches a REAL VS Code window with the extension loaded
// (--extensionDevelopmentPath), sets the env hooks that make the extension run
// the `bytos.voice.f1.smoke` cycle on activation, waits for the run to finish,
// copies the counter log out, then closes the window.
//
// Audio never leaves the extension host: the log contains only counters, byte
// totals, durations and typed error codes.
//
//   bun scripts/voice-f1-smoke.ts
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const extensionPath = path.resolve(import.meta.dir, "..")
const userDataDir = path.join(os.tmpdir(), "bytos-voice-f1-userdata")
const workspaceDir = path.join(os.tmpdir(), "bytos-voice-f1-workspace")
const evidencePath = path.join(extensionPath, "voice-f1-smoke-evidence.txt")
fs.mkdirSync(workspaceDir, { recursive: true })
fs.rmSync(evidencePath, { force: true })

const codeCmd =
	process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe") : "code"
if (process.platform === "win32" && !fs.existsSync(codeCmd)) {
	throw new Error(`VS Code not found at ${codeCmd}`)
}

console.log(`[runner] extensionPath=${extensionPath}`)
console.log(`[runner] evidence=${evidencePath}`)
console.log("[runner] launching a real VS Code window…")

const child = spawn(
	codeCmd,
	[
		"--new-window",
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${path.join(userDataDir, "extensions")}`,
		`--extensionDevelopmentPath=${extensionPath}`,
		"--disable-workspace-trust",
		"--disable-extensions",
		workspaceDir,
	],
	{
		stdio: "ignore",
		detached: true,
		env: {
			...process.env,
			BYTOS_VOICE_F1_SMOKE_AUTORUN: "1",
			BYTOS_VOICE_F1_SMOKE_LOG: evidencePath,
			// `IS_DEV=true` makes the extension set `bytos.isDevMode` and register
			// the reload watcher, which asserts DEV_WORKSPACE_FOLDER — so point that
			// at the extension source root. The window itself opens in a temp folder.
			IS_DEV: "true",
			DEV_WORKSPACE_FOLDER: extensionPath,
		},
	},
)
child.unref()
console.log(`[runner] pid=${child.pid}`)

const started = Date.now()
const deadline = Date.now() + 180_000
let done = false
while (Date.now() < deadline) {
	await new Promise((resolve) => setTimeout(resolve, 3000))
	try {
		const text = fs.readFileSync(evidencePath, "utf8")
		if (text.includes("── done")) {
			done = true
			break
		}
	} catch {
		// log not created yet
	}
	if ((Date.now() - started) % 30000 < 3000) {
		console.log(`[runner] still waiting… ${Math.round((Date.now() - started) / 1000)}s`)
	}
}

// Shut the test window down so no capture helper can be left behind. Only the
// PID we launched is targeted — the user's own VS Code windows are untouched.
if (process.platform === "win32") {
	spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
} else {
	try {
		process.kill(-child.pid!, "SIGTERM")
	} catch {
		// already gone
	}
}

console.log(`[runner] finished=${done}`)
if (fs.existsSync(evidencePath)) {
	console.log("=== EVIDENCE ===")
	console.log(fs.readFileSync(evidencePath, "utf8"))
} else {
	console.log("[runner] NO EVIDENCE FILE — the extension host did not reach the smoke run")
}
process.exit(done ? 0 : 1)
