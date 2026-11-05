import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { BytosMessage } from "@shared/ExtensionMessage"
import { afterEach, describe, expect, it } from "vitest"
import {
	type AutoPhaseOutcome,
	buildAutoPhaseSummaryPrompt,
	buildDeterministicSummary,
	buildPreviousPhaseContext,
	createAutoPhaseRunId,
	escapeContextMentions,
	extractPhaseReport,
	formatAutoPhaseReportMarkdown,
	formatDuration,
	getAutoPhaseReportRelativePath,
	parsePhaseReportStatus,
	writeAutoPhaseReport,
} from "./report"

function message(patch: Partial<BytosMessage>): BytosMessage {
	return { ts: 1, type: "say", ...patch } as BytosMessage
}

function outcome(patch: Partial<AutoPhaseOutcome> = {}): AutoPhaseOutcome {
	return {
		phaseNumber: 1,
		phaseId: "phase-1",
		prompt: "Implement the first phase",
		provider: "anthropic",
		modelId: "claude-sonnet-4-6",
		status: "completed",
		report: "Phase one is done.",
		taskId: "task-1",
		startedAt: 1_000,
		finishedAt: 61_000,
		...patch,
	}
}

const tempDirs: string[] = []

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("auto phase report helpers", () => {
	it("prefers the last completion result over plain text", () => {
		const messages = [
			message({ ts: 1, say: "text", text: "intermediate text" }),
			message({ ts: 2, say: "completion_result", text: "final report" }),
		]

		expect(extractPhaseReport(messages)).toBe("final report")
	})

	it("falls back to the last plain assistant text", () => {
		const messages = [
			message({ ts: 1, say: "text", text: "first" }),
			message({ ts: 2, say: "text", text: "last" }),
			message({ ts: 3, say: "api_req_started", text: "{}" }),
		]

		expect(extractPhaseReport(messages)).toBe("last")
	})

	it("returns an empty string when no report exists", () => {
		expect(extractPhaseReport([])).toBe("")
		expect(extractPhaseReport([message({ ts: 1, say: "tool", text: "tool" })])).toBe("")
	})

	it("parses the last STATUS marker", () => {
		expect(parsePhaseReportStatus("work done\nSTATUS: DONE")).toBe("done")
		expect(parsePhaseReportStatus("STATUS: PARTIAL\nSTATUS: BLOCKED")).toBe("blocked")
		expect(parsePhaseReportStatus("no marker")).toBeUndefined()
	})

	it("builds previous-phase context with status, error, and escaped mentions", () => {
		const context = buildPreviousPhaseContext(
			outcome({
				status: "failed",
				error: "Provider key invalid",
				report: "Tried @/src/app.ts but stopped.",
			}),
		)

		expect(context).toContain("Phase: 1")
		expect(context).toContain("Status: failed")
		expect(context).toContain("Error: Provider key invalid")
		expect(context).toContain("did not complete successfully")
		expect(context).not.toContain("@/src/app.ts")
		expect(context).toContain("@\u200b/src/app.ts")
	})

	it("writes a detailed markdown report with every phase and the AI summary", async () => {
		const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "bytos-auto-phase-"))
		tempDirs.push(workspaceRoot)
		const runId = createAutoPhaseRunId(new Date("2026-11-05T10:00:00.000Z"))

		const result = await writeAutoPhaseReport(workspaceRoot, {
			runId,
			startedAt: 1_000,
			finishedAt: 120_000,
			outcomes: [
				outcome({ phaseNumber: 1, report: "Phase one report" }),
				outcome({
					phaseNumber: 2,
					phaseId: "phase-2",
					status: "failed",
					error: "Something broke",
					report: "Could not finish",
					taskId: "task-2",
				}),
				outcome({ phaseNumber: 3, phaseId: "phase-3", status: "skipped", report: "" }),
			],
			aiSummary: "Overall the run is partially complete.",
			workspaceRoot,
		})

		expect(result.relativePath).toBe(getAutoPhaseReportRelativePath(runId))
		expect(result.absolutePath).toBe(path.join(workspaceRoot, ...result.relativePath.split("/")))
		const markdown = await readFile(result.absolutePath, "utf8")
		expect(markdown).toContain("# Auto Phase Report")
		expect(markdown).toContain("1 completed, 1 failed/blocked, 1 skipped")
		expect(markdown).toContain("Phase 1")
		expect(markdown).toContain("Phase 2")
		expect(markdown).toContain("Something broke")
		expect(markdown).toContain("Overall assessment")
		expect(markdown).toContain("Overall the run is partially complete.")
	})

	it("formats a deterministic chat summary with the report path", () => {
		const summary = buildDeterministicSummary({
			outcomes: [outcome({ phaseNumber: 1 }), outcome({ phaseNumber: 2, status: "failed", error: "Phase two failed" })],
			reportRelativePath: ".bytos/auto-phase-reports/run/report.md",
			writeReport: true,
		})

		expect(summary).toContain("1/2 phases completed")
		expect(summary).toContain("Phase 2: Phase two failed")
		expect(summary).toContain(".bytos/auto-phase-reports/run/report.md")
	})

	it("mentions that the report was disabled when writeReport is false", () => {
		const summary = buildDeterministicSummary({
			outcomes: [outcome()],
			writeReport: false,
		})

		expect(summary).toContain("disabled")
	})

	it("explains when the report was enabled but could not be written", () => {
		const summary = buildDeterministicSummary({
			outcomes: [outcome()],
			writeReport: true,
		})

		expect(summary).toContain("could not be written")
	})

	it("builds an AI summary prompt with the report path and phase reports", () => {
		const prompt = buildAutoPhaseSummaryPrompt({
			outcomes: [outcome({ phaseNumber: 1 }), outcome({ phaseNumber: 2, status: "blocked", error: "Blocked" })],
			reportRelativePath: ".bytos/auto-phase-reports/run/report.md",
		})

		expect(prompt).toContain("Do not use tools")
		expect(prompt).toContain(".bytos/auto-phase-reports/run/report.md")
		expect(prompt).toContain("Phase 1")
		expect(prompt).toContain("Phase 2")
		expect(prompt).toContain("Blocked")
	})

	it("escapes mentions and formats durations", () => {
		expect(escapeContextMentions("@/src/a.ts @terminal")).toBe("@\u200b/src/a.ts @\u200bterminal")
		expect(formatDuration(0, 30_000)).toBe("30s")
		expect(formatDuration(0, 90_000)).toBe("1m 30s")
		expect(formatDuration(0, 3_900_000)).toBe("1h 5m")
	})

	it("creates filesystem-safe run ids", () => {
		const runId = createAutoPhaseRunId(new Date("2026-11-05T10:11:12.000Z"))
		expect(runId).toMatch(/^2026-11-05T10-11-12-000Z-[a-z0-9]+$/)
		expect(getAutoPhaseReportRelativePath(runId)).toBe(`.bytos/auto-phase-reports/${runId}/report.md`)
	})

	it("renders markdown without requiring a report for skipped phases", () => {
		const markdown = formatAutoPhaseReportMarkdown({
			runId: "run-1",
			startedAt: 1_000,
			finishedAt: 2_000,
			outcomes: [outcome({ status: "skipped", report: "", taskId: undefined })],
		})
		expect(markdown).toContain("skipped")
		expect(markdown).toContain("No completion report was produced")
	})
})
