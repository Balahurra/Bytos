// T1 real-flow evidence (S7): runs the F1 smoke cycle inside a real VS Code
// extension host with the gRPC recorder ENABLED, then inspects the recorder JSON
// the extension wrote and asserts it contains no voice entry and no audio bytes.
//
//   bun scripts/voice-recorder-isolation-check.ts
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const extensionPath = path.resolve(import.meta.dir, "..")
const userDataDir = path.join(os.tmpdir(), "bytos-voice-recorder-userdata")
const workspaceDir = path.join(os.tmpdir(), "bytos-voice-recorder-workspace")
// The recorder writes into `<DEV_WORKSPACE_FOLDER>/tests/specs`.
const specsDir = path.join(workspaceDir, "tests", "specs")
const evidencePath = path.join(extensionPath, "voice-f1-recorder-evidence.txt")
fs.mkdirSync(specsDir, { recursive: true })
fs.rmSync(evidencePath, { force: true })

const recorderFileName = `voice-f1-isolation-${Date.now()}`
const recorderFile = path.join(specsDir, `grpc_recorded_session_${recorderFileName}.json`)

const codeExe = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Microsoft VS Code", "Code.exe")
if (!fs.existsSync(codeExe)) {
	throw new Error(`VS Code not found at ${codeExe}`)
}

console.log(`[recorder-check] recorderFile=${recorderFile}`)
console.log("[recorder-check] launching a real VS Code window with the recorder ENABLED…")

const child = spawn(
	codeExe,
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
			GRPC_RECORDER_ENABLED: "true",
			BYTOS_ENVIRONMENT: "local",
			GRPC_RECORDER_FILE_NAME: recorderFileName,
			// The recorder derives its folder from DEV_WORKSPACE_FOLDER.
			DEV_WORKSPACE_FOLDER: workspaceDir,
		},
	},
)
child.unref()

const deadline = Date.now() + 180_000
let done = false
while (Date.now() < deadline) {
	await new Promise((resolve) => setTimeout(resolve, 3000))
	try {
		if (fs.readFileSync(evidencePath, "utf8").includes("── done")) {
			done = true
			break
		}
	} catch {
		// not started yet
	}
}

if (process.platform === "win32") {
	spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
} else {
	try {
		process.kill(-child.pid!, "SIGTERM")
	} catch {
		// gone
	}
}

console.log(`[recorder-check] smokeFinished=${done}`)
if (!fs.existsSync(recorderFile)) {
	console.log(`[recorder-check] NO RECORDER FILE at ${recorderFile}`)
	process.exit(1)
}

const raw = fs.readFileSync(recorderFile, "utf8")
const log = JSON.parse(raw) as { entries?: Array<{ service?: string; method?: string; request?: { message?: unknown } }> }
const entries = Array.isArray(log.entries) ? log.entries : []
const voiceEntries = entries.filter(
	(entry) => entry.service === "bytos.VoiceService" || /voice/i.test(String(entry.method ?? "")),
)
const audioTokenMatch = /"(audio|pcm|wav|samples|utterance)"\s*:/i.test(raw)
const voiceServiceMatch = raw.includes("bytos.VoiceService")
const base64Blob = /"[A-Za-z0-9+/]{512,}={0,2}"/.test(raw)

const result = {
	recorderFile,
	entries: entries.length,
	services: [...new Set(entries.map((entry) => entry.service))].slice(0, 20),
	voiceEntries: voiceEntries.length,
	voiceServiceMatch,
	audioTokenMatch,
	base64Blob,
	bytes: raw.length,
}
console.log(JSON.stringify(result, null, 2))

const pass = voiceEntries.length === 0 && !voiceServiceMatch && !audioTokenMatch && !base64Blob && entries.length > 0
console.log(
	pass
		? "[recorder-check] PASS — recorder wrote non-voice traffic and no voice entry / no audio"
		: "[recorder-check] FAIL — see counters above",
)
process.exit(pass ? 0 : 1)
