import { promises as fs } from "node:fs"
import path from "node:path"
import type { BytosMessage } from "@shared/ExtensionMessage"

export type AutoPhaseOutcomeStatus =
	| "completed"
	| "completed_with_warnings"
	| "failed"
	| "blocked"
	| "timeout"
	| "cancelled"
	| "skipped"

export interface AutoPhaseOutcome {
	phaseNumber: number
	phaseId: string
	prompt: string
	provider: string
	modelId: string
	status: AutoPhaseOutcomeStatus
	error?: string
	report: string
	taskId?: string
	startedAt: number
	finishedAt: number
	/** What the runner did after a non-completed phase. */
	decision?: "continued" | "stopped" | "cancelled"
}

export interface AutoPhaseReportInput {
	runId: string
	startedAt: number
	finishedAt?: number
	outcomes: AutoPhaseOutcome[]
	aiSummary?: string
	cancelled?: boolean
	workspaceRoot?: string
}

export const AUTO_PHASE_REPORT_DIR = ".bytos/auto-phase-reports"
export const AUTO_PHASE_REPORT_FILE = "report.md"
const MAX_CONTEXT_REPORT_CHARS = 4000
const MAX_PHASE_PROMPT_CHARS = 2000

/** Unique, filesystem-safe identifier for one Auto Phase run. */
export function createAutoPhaseRunId(date = new Date()): string {
	const stamp = date.toISOString().replace(/[:.]/g, "-")
	const suffix = Math.random().toString(36).slice(2, 8)
	return `${stamp}-${suffix}`
}

/** Workspace-relative path to the detailed report for a run. */
export function getAutoPhaseReportRelativePath(runId: string): string {
	return `${AUTO_PHASE_REPORT_DIR}/${runId}/${AUTO_PHASE_REPORT_FILE}`
}

/**
 * Prevent the injected previous-phase report from being parsed as an @mention by
 * the task-start context resolver. A zero-width space after @ keeps the text
 * readable for the model while breaking the mention regex.
 */
export function escapeContextMentions(text: string): string {
	return text.replace(/@/g, "@\u200b")
}

export function truncateText(text: string, maxChars: number): string {
	const trimmed = text.trim()
	if (trimmed.length <= maxChars) {
		return trimmed
	}
	return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

/**
 * Read the short report a phase produced. The completion tool's summary is the
 * canonical report; a plain final text row is the fallback for turns that ended
 * without the completion tool.
 */
export function extractPhaseReport(messages: BytosMessage[]): string {
	if (!Array.isArray(messages) || messages.length === 0) {
		return ""
	}

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (
			message?.type === "say" &&
			(message.say === "completion_result" || message.say === "plan_completion_result") &&
			message.text?.trim()
		) {
			return message.text.trim()
		}
	}

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (message?.type === "say" && message.say === "text" && message.text?.trim()) {
			return message.text.trim()
		}
	}

	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (message?.type === "ask" && message.ask === "completion_result" && message.text?.trim()) {
			return message.text.trim()
		}
	}

	return ""
}

/** Parse the optional `STATUS: DONE | PARTIAL | BLOCKED | FAILED` line. */
export function parsePhaseReportStatus(report: string): "done" | "partial" | "blocked" | "failed" | undefined {
	if (!report) {
		return undefined
	}
	const matches = [...report.matchAll(/^\s*STATUS\s*:\s*(DONE|PARTIAL|BLOCKED|FAILED)\b/gim)]
	const last = matches.at(-1)?.[1]?.toLowerCase()
	if (last === "done" || last === "partial" || last === "blocked" || last === "failed") {
		return last
	}
	return undefined
}

export function formatDuration(startedAt: number, finishedAt: number): string {
	const totalSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000))
	if (totalSeconds < 60) {
		return `${totalSeconds}s`
	}
	const minutes = Math.floor(totalSeconds / 60)
	const seconds = totalSeconds % 60
	if (minutes < 60) {
		return `${minutes}m ${seconds}s`
	}
	const hours = Math.floor(minutes / 60)
	return `${hours}h ${minutes % 60}m`
}

/** The instruction appended to every phase prompt so the runner can classify its result. */
export function buildAutoPhaseReportInstruction(): string {
	return [
		"---",
		"AUTO PHASE REPORTING",
		"End your completion summary with a single line:",
		"STATUS: DONE | PARTIAL | BLOCKED | FAILED",
		"Use BLOCKED or FAILED when you could not complete this phase.",
		"This line is used by the Auto Phase runner and the Markdown report.",
		"---",
	].join("\n")
}

/** Context block passed to the next phase. */
export function buildPreviousPhaseContext(outcome: AutoPhaseOutcome, maxReportChars = MAX_CONTEXT_REPORT_CHARS): string {
	const report = outcome.report.trim()
	const truncated = report ? truncateText(escapeContextMentions(report), maxReportChars) : "(no report was produced)"
	const succeeded = outcome.status === "completed" || outcome.status === "completed_with_warnings"
	const guidance = succeeded
		? "The previous phase completed. Use its report as context; do not repeat work that is already finished."
		: "The previous phase did not complete successfully. Do not assume its output exists. Continue with your own phase and account for the gap."
	const lines = ["---", "AUTO PHASE CONTEXT — PREVIOUS PHASE", `Phase: ${outcome.phaseNumber}`, `Status: ${outcome.status}`]
	if (outcome.error) {
		lines.push(`Error: ${truncateText(escapeContextMentions(outcome.error), 1200)}`)
	}
	lines.push("Report:", truncated, "", guidance, "---")
	return lines.join("\n")
}

function firstPromptLine(prompt: string): string {
	const line = prompt
		.split(/\r?\n/)
		.map((entry) => entry.replace(/^#+\s*/, "").trim())
		.find(Boolean)
	return line ? truncateText(line, 90) : ""
}

function phaseTitle(outcome: AutoPhaseOutcome): string {
	const title = firstPromptLine(outcome.prompt)
	return `Phase ${outcome.phaseNumber}${title ? ` — ${title}` : ""}`
}

function tableCell(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function countStatus(outcomes: AutoPhaseOutcome[], statuses: AutoPhaseOutcomeStatus[]): number {
	return outcomes.filter((outcome) => statuses.includes(outcome.status)).length
}

function formatStatusLabel(status: AutoPhaseOutcomeStatus): string {
	switch (status) {
		case "completed":
			return "completed"
		case "completed_with_warnings":
			return "completed with warnings"
		case "failed":
			return "failed"
		case "blocked":
			return "blocked"
		case "timeout":
			return "timed out"
		case "cancelled":
			return "cancelled"
		case "skipped":
			return "skipped"
	}
}

/** Full deterministic Markdown report for one run. */
export function formatAutoPhaseReportMarkdown(run: AutoPhaseReportInput): string {
	const outcomes = run.outcomes
	const completed = countStatus(outcomes, ["completed", "completed_with_warnings"])
	const failed = countStatus(outcomes, ["failed", "blocked", "timeout"])
	const skipped = countStatus(outcomes, ["skipped"])
	const cancelled = countStatus(outcomes, ["cancelled"])
	const lines: string[] = [
		"# Auto Phase Report",
		"",
		`- Run: \`${run.runId}\``,
		`- Started: ${new Date(run.startedAt).toISOString()}`,
	]
	if (run.finishedAt) {
		lines.push(`- Finished: ${new Date(run.finishedAt).toISOString()}`)
	}
	if (run.workspaceRoot) {
		lines.push(`- Workspace: \`${run.workspaceRoot}\``)
	}
	lines.push(
		`- Plan: ${outcomes.length} phase${outcomes.length === 1 ? "" : "s"}`,
		`- Result: ${completed} completed, ${failed} failed/blocked, ${skipped} skipped${
			cancelled > 0 ? `, ${cancelled} cancelled` : ""
		}`,
		"",
	)

	if (run.cancelled) {
		lines.push("> The run was stopped before every phase finished. This report contains the phases that ran.", "")
	}

	lines.push("## Run summary", "", "| # | Phase | Status | Provider / Model | Duration | Task |", "|---|---|---|---|---|---|")
	for (const outcome of outcomes) {
		lines.push(
			`| ${outcome.phaseNumber} | ${tableCell(phaseTitle(outcome))} | ${formatStatusLabel(outcome.status)} | ${tableCell(
				`${outcome.provider} / ${outcome.modelId}`,
			)} | ${formatDuration(outcome.startedAt, outcome.finishedAt)} | ${outcome.taskId ? `\`${outcome.taskId}\`` : "—"} |`,
		)
	}
	lines.push("")

	for (const outcome of outcomes) {
		lines.push(`## ${phaseTitle(outcome)}`, "")
		lines.push(`- Status: **${formatStatusLabel(outcome.status)}**`)
		lines.push(`- Started: ${new Date(outcome.startedAt).toISOString()}`)
		lines.push(`- Finished: ${new Date(outcome.finishedAt).toISOString()}`)
		lines.push(`- Duration: ${formatDuration(outcome.startedAt, outcome.finishedAt)}`)
		lines.push(`- Provider / Model: \`${outcome.provider} / ${outcome.modelId}\``)
		if (outcome.taskId) {
			lines.push(`- Task: \`${outcome.taskId}\``)
		}
		if (outcome.decision) {
			lines.push(`- Runner decision: ${outcome.decision}`)
		}
		if (outcome.error) {
			lines.push(`- Error: ${outcome.error}`)
		}
		lines.push("", "**Prompt**", "")
		lines.push("```text")
		lines.push(truncateText(outcome.prompt, MAX_PHASE_PROMPT_CHARS))
		lines.push("```", "", "**Report**", "")
		if (outcome.report.trim()) {
			lines.push(outcome.report.trim())
		} else {
			lines.push("_No completion report was produced for this phase._")
		}
		lines.push("", "---", "")
	}

	if (run.aiSummary?.trim()) {
		lines.push("## Overall assessment", "", run.aiSummary.trim(), "")
	}

	lines.push("_Generated by Bytos Auto Phase Plan._", "")
	return lines.join("\n")
}

export interface AutoPhaseReportWriteResult {
	absolutePath: string
	relativePath: string
}

/** Write the detailed report into the workspace and return both path forms. */
export async function writeAutoPhaseReport(
	workspaceRoot: string,
	run: AutoPhaseReportInput,
): Promise<AutoPhaseReportWriteResult> {
	const relativePath = getAutoPhaseReportRelativePath(run.runId)
	const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"))
	await fs.mkdir(path.dirname(absolutePath), { recursive: true })
	await fs.writeFile(absolutePath, formatAutoPhaseReportMarkdown(run), "utf8")
	return { absolutePath, relativePath }
}

export interface AutoPhaseSummaryInput {
	outcomes: AutoPhaseOutcome[]
	reportRelativePath?: string
	writeReport: boolean
	cancelled?: boolean
}

/** Short deterministic chat summary used when the AI summary is disabled or fails. */
export function buildDeterministicSummary(input: AutoPhaseSummaryInput): string {
	const outcomes = input.outcomes
	const completed = countStatus(outcomes, ["completed", "completed_with_warnings"])
	const failed = countStatus(outcomes, ["failed", "blocked", "timeout"])
	const skipped = countStatus(outcomes, ["skipped"])
	const cancelled = countStatus(outcomes, ["cancelled"])
	const total = outcomes.length
	const headline = input.cancelled
		? `Auto Phase stopped: ${completed}/${total} phases completed.`
		: `Auto Phase finished: ${completed}/${total} phases completed.`
	const lines = [`**${headline}**`, ""]
	if (failed > 0) {
		lines.push(`- Failed / blocked: ${failed}`)
	}
	if (skipped > 0) {
		lines.push(`- Skipped: ${skipped}`)
	}
	if (cancelled > 0) {
		lines.push(`- Cancelled: ${cancelled}`)
	}
	const failedPhases = outcomes.filter((outcome) => ["failed", "blocked", "timeout"].includes(outcome.status))
	for (const outcome of failedPhases) {
		lines.push(`- Phase ${outcome.phaseNumber}: ${outcome.error ?? formatStatusLabel(outcome.status)}`)
	}
	lines.push("")
	if (input.writeReport) {
		if (input.reportRelativePath) {
			lines.push(`Detailed report: \`${input.reportRelativePath}\``)
			lines.push("")
			lines.push("The detailed report contains every phase's prompt, status, error, and completion report.")
		} else {
			lines.push("Detailed report could not be written. Check the Bytos logs for the write error.")
		}
	} else {
		lines.push("Detailed Markdown report was disabled in Auto Phase settings.")
	}
	return lines.join("\n")
}

/** Prompt for the optional final AI summary task. */
export function buildAutoPhaseSummaryPrompt(input: {
	outcomes: AutoPhaseOutcome[]
	reportRelativePath?: string
	maxReportChars?: number
}): string {
	const maxReportChars = input.maxReportChars ?? 4000
	const lines = [
		"You are writing the final summary for an Auto Phase Plan run.",
		"Do not use tools and do not modify any files.",
		"Write a short summary for the chat (maximum 12 lines). Include:",
		"- the overall result (completed / failed / skipped counts),",
		"- the most important outcomes,",
		"- any failures, blockers, or risks,",
		"- one line pointing to the detailed Markdown report.",
		"",
	]
	if (input.reportRelativePath) {
		lines.push(
			`The detailed report was written to: \`${input.reportRelativePath}\``,
			"End your summary with exactly this line:",
			`Detailed report: \`${input.reportRelativePath}\``,
			"Say that the detailed per-phase information lives in that file.",
			"",
		)
	} else {
		lines.push("No Markdown report was written; summarize from the phase outcomes below.", "")
	}
	lines.push("Phase outcomes:")
	for (const outcome of input.outcomes) {
		lines.push(
			"",
			`### Phase ${outcome.phaseNumber} — ${formatStatusLabel(outcome.status)}`,
			`Provider / Model: ${outcome.provider} / ${outcome.modelId}`,
		)
		if (outcome.error) {
			lines.push(`Error: ${outcome.error}`)
		}
		lines.push("Report:", truncateText(outcome.report || "(no report)", maxReportChars))
	}
	return lines.join("\n")
}
