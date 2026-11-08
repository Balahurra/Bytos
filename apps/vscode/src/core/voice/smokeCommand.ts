/**
 * Developer-facing Voice F1 smoke run.
 *
 * F1 has no UI (the composer and Settings panels are F4/F3), so this is the only
 * user-reachable entry point in this phase. It runs the whole capture lifecycle —
 * capability check, real helper spawn, start, live counters, stop, cancel,
 * dispose — from inside a real VS Code extension host.
 *
 * It never reads, prints or writes audio samples: every line it emits is a
 * counter, a duration, a byte count or a typed error code. Registration happens
 * in `extension.ts` (the command host), and only outside Production.
 *
 * Evidence hooks (used by `scripts/voice-f1-smoke.ts` and
 * `scripts/voice-recorder-isolation-check.ts`):
 *  - `BYTOS_VOICE_F1_SMOKE_AUTORUN=1` runs the cycle on activation;
 *  - `BYTOS_VOICE_F1_SMOKE_LOG=<path>` appends the counter lines to a file.
 * Both carry counters/typed codes only — never audio.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { createSmokeRuntime, logVoiceSmoke as logBase, newFileReport, notifySmokeResult, snapshotDirs } from "./smoke"

const SMOKE_LOG_ENV = "BYTOS_VOICE_F1_SMOKE_LOG"

function log(line: string): void {
	logBase(line)
	const target = process.env[SMOKE_LOG_ENV]
	if (!target) return
	try {
		fs.appendFileSync(target, `[Bytos Voice F1] ${line}\n`, "utf8")
	} catch {
		// The log file is best-effort evidence only; never fail the run for it.
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Drives real ProtoBus traffic through the extension's own gRPC handler.
 *
 * The recorder is a singleton created by `GrpcRecorderBuilder.getRecorder()`,
 * which only runs when `handleGrpcRequest` dispatches a request. The smoke cycle
 * itself spawns the helper directly (no RPC), so this step dispatches genuine
 * requests to make the isolation claim testable in the real product path:
 *  - non-voice requests MUST be recorded,
 *  - every `bytos.VoiceService` request MUST NOT be recorded.
 */
async function exerciseProtobusTraffic(): Promise<{ recorded: number; voiceCalls: number }> {
	const { handleGrpcRequest } = await import("@core/controller/grpc-handler")
	const { GrpcRecorderBuilder } = await import("@core/controller/grpc-recorder/grpc-recorder.builder")
	const controller = {
		stateManager: { getGlobalSettingsKey: () => undefined },
		postStateToWebview: async () => {},
	} as never
	const postMessage = async () => true

	let voiceCalls = 0
	const dispatch = async (service: string, method: string, message: Record<string, unknown>) => {
		voiceCalls++
		await handleGrpcRequest(
			controller,
			postMessage as never,
			{
				request_id: `voice-f1-${service}-${method}-${voiceCalls}`,
				service,
				method,
				message,
				is_streaming: false,
			} as never,
		)
	}
	try {
		for (const method of ["getVoiceStatus", "listCaptureDevices"]) {
			await dispatch("bytos.VoiceService", method, {})
		}
		log(`protobus: dispatched ${voiceCalls} bytos.VoiceService request(s)`)
	} catch (error) {
		log(`protobus: voice dispatch failed (${error instanceof Error ? error.message : String(error)})`)
	}
	const recorded = GrpcRecorderBuilder.getRecorder(controller).getSessionLog().entries.length
	log(`protobus: recorder sessionLog entries after voice traffic=${recorded}`)
	return { recorded, voiceCalls }
}

export async function runVoiceSmoke(context: vscode.ExtensionContext): Promise<unknown> {
	const root = context.extensionUri.fsPath
	const storageRoot = context.globalStorageUri?.fsPath ?? path.join(os.tmpdir(), "bytos-voice-smoke")
	let workspaceRoot: string | undefined
	try {
		const paths = await HostProvider.workspace.getWorkspacePaths({})
		workspaceRoot = paths.paths?.[0]
	} catch {
		workspaceRoot = undefined
	}
	const scanRoots = [os.tmpdir(), storageRoot, ...(workspaceRoot ? [workspaceRoot] : [])]

	log("═══════════════════════════════════════════════════════")
	log(`extensionRoot=${root}`)
	log(`extensionMode=${context.extensionMode} (Production 1, Development 2, Test 3)`)

	const { VoiceSessionRegistry, capability, runtime } = await createSmokeRuntime(root)
	log("── capability ─────────────────────────────────────────")
	log(`canCapture=${capability.canCapture} backend=${capability.backend} reason=${capability.reason || "(none)"}`)
	log(`osLabel=${capability.osLabel}`)
	log(`helper=${capability.helperPath ?? "(missing)"}`)

	const before = snapshotDirs(scanRoots)

	// 1. REAL capture through the native helper.
	log("── start (real WASAPI helper) ─────────────────────────")
	const started = await runtime.startCapture({ captureMethod: "auto" })
	log(`session=${started.sessionId} rate=${started.sampleRate} channels=${started.channels}`)

	await sleep(1500)
	const live = runtime.snapshot()
	log(
		`live: state=${live.state} frames=${live.framesReceived} bytes=${live.bytesReceived} durationMs=${Math.round(live.durationMs)}`,
	)

	// 2. Stop → the utterance is complete and stays in host memory.
	log("── stop ───────────────────────────────────────────────")
	const stopped = await runtime.stopCapture({ reason: "stopped" })
	log(
		`stopped: samples=${stopped.samples.length} durationMs=${Math.round(stopped.durationMs)} bytes=${stopped.counters.bytes} truncated=${stopped.truncated} reason=${stopped.reason}`,
	)

	// 3. Start + cancel from `capturing`.
	log("── second capture (for cancel) ────────────────────────")
	const second = await runtime.startCapture({ captureMethod: "auto" })
	await sleep(700)
	const beforeCancel = runtime.snapshot()
	log(`live: frames=${beforeCancel.framesReceived} bytes=${beforeCancel.bytesReceived} session=${second.sessionId}`)
	await runtime.cancelCapture()
	const afterCancel = runtime.snapshot()
	log(`cancelled: state=${afterCancel.state} frames=${afterCancel.framesReceived}`)
	log(`helpersStillRegistered=${VoiceSessionRegistry.getActiveCount()}`)

	// 4. Dispose (teardown path) and idempotency.
	log("── dispose ────────────────────────────────────────────")
	await runtime.dispose()
	log(`afterDispose state=${runtime.captureState} helpers=${VoiceSessionRegistry.getActiveCount()}`)
	await runtime.dispose()
	log(`secondDispose helpers=${VoiceSessionRegistry.getActiveCount()} (idempotent)`)

	const report = newFileReport(before, snapshotDirs(scanRoots))
	log("── file isolation ─────────────────────────────────────")
	log(`newFiles=${report.total} newAudioFiles=${report.audio.length}`)

	// 5. Recorder isolation (T1): dispatch real ProtoBus traffic, voice included.
	log("── recorder isolation ─────────────────────────────────")
	const protobus = await exerciseProtobusTraffic()
	log(`recorder entries=${protobus.recorded} voiceRequestsDispatched=${protobus.voiceCalls}`)
	log("── done ───────────────────────────────────────────────")

	await notifySmokeResult(
		`Bytos Voice F1: samples=${stopped.samples.length} bytes=${stopped.counters.bytes} newFiles=${report.total} newAudioFiles=${report.audio.length}`,
	)
	return { started, stopped: { samples: stopped.samples.length, bytes: stopped.counters.bytes }, report, protobus }
}
