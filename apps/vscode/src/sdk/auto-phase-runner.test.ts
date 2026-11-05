import { AutoPhaseErrorPolicy } from "@shared/proto/bytos/state"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { AutoPhasePrompt } from "@/core/auto-phase/plan-store"
import type { AutoPhaseOutcome } from "@/core/auto-phase/report"
import { HostProvider } from "@/hosts/host-provider"
import { Controller } from "./SdkController"

const showMessage = vi.fn()

beforeAll(() => {
	HostProvider.initialize(
		(() => {}) as never,
		(() => {}) as never,
		(() => {}) as never,
		{ windowClient: { showMessage } } as never,
		(() => {}) as never,
		async () => "",
		async () => "",
		"",
		"",
	)
})

afterAll(() => {
	HostProvider.reset()
})

type TestWait = { status: "completed" | "failed" | "timeout" | "cancelled"; error?: string }
type TestRun = {
	cancelled: boolean
	stage: "phase" | "waiting" | "report" | "summary"
	onPhaseError: AutoPhaseErrorPolicy
	resolveFailureDecision?: (decision: "continue" | "continue-and-dont-ask" | "stop") => void
	outcomes: AutoPhaseOutcome[]
}

interface AutoPhaseTestController {
	composeAutoPhasePrompt: (prompt: string, previousContext?: string) => string
	buildAutoPhaseOutcome: (args: {
		phase: AutoPhasePrompt
		index: number
		startedAt: number
		wait: TestWait
		report: string
		taskId?: string
	}) => AutoPhaseOutcome
	recordSkippedAutoPhaseOutcomes: (phases: AutoPhasePrompt[], startIndex: number, run: TestRun) => void
	decideAfterAutoPhaseFailure: (run: TestRun, outcome: AutoPhaseOutcome) => Promise<string>
	extractAutoPhaseErrorText: (text: string) => string
	isAutoPhaseBlockingError: (error?: string) => boolean
	isAutoPhaseSuccess: (status: AutoPhaseOutcome["status"]) => boolean
	postStateToWebview: () => Promise<void>
}

function createController(): AutoPhaseTestController {
	return Object.assign(Object.create(Controller.prototype), {
		postStateToWebview: async () => {},
	}) as unknown as AutoPhaseTestController
}

function phase(patch: Partial<AutoPhasePrompt> = {}): AutoPhasePrompt {
	return {
		id: "phase-1",
		prompt: "Do the thing",
		provider: "anthropic",
		modelId: "claude-sonnet-4-6",
		mcpServers: [],
		mcpServersExplicit: true,
		attachments: [],
		...patch,
	}
}

function run(patch: Partial<TestRun> = {}): TestRun {
	return {
		cancelled: false,
		stage: "phase",
		onPhaseError: AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_ASK,
		outcomes: [],
		...patch,
	}
}

function outcome(patch: Partial<AutoPhaseOutcome> = {}): AutoPhaseOutcome {
	return {
		phaseNumber: 1,
		phaseId: "phase-1",
		prompt: "Do the thing",
		provider: "anthropic",
		modelId: "claude-sonnet-4-6",
		status: "failed",
		error: "boom",
		report: "",
		startedAt: 0,
		finishedAt: 1,
		...patch,
	}
}

describe("Auto Phase runner helpers", () => {
	it("keeps the original prompt first and appends the reporting instruction", () => {
		const prompt = createController().composeAutoPhasePrompt("Do the thing", "PREVIOUS PHASE CONTEXT")

		expect(prompt.startsWith("Do the thing")).toBe(true)
		expect(prompt).toContain("PREVIOUS PHASE CONTEXT")
		expect(prompt).toContain("STATUS: DONE | PARTIAL | BLOCKED | FAILED")
	})

	it("maps a BLOCKED status marker to a blocked outcome", () => {
		const result = createController().buildAutoPhaseOutcome({
			phase: phase(),
			index: 0,
			startedAt: 0,
			wait: { status: "completed" },
			report: "I could not continue.\nSTATUS: BLOCKED",
			taskId: "task-1",
		})

		expect(result.status).toBe("blocked")
		expect(result.report).toContain("STATUS: BLOCKED")
		expect(result.taskId).toBe("task-1")
	})

	it("maps FAILED and PARTIAL status markers", () => {
		const controller = createController()
		const failed = controller.buildAutoPhaseOutcome({
			phase: phase(),
			index: 0,
			startedAt: 0,
			wait: { status: "completed" },
			report: "STATUS: FAILED",
		})
		const partial = controller.buildAutoPhaseOutcome({
			phase: phase(),
			index: 0,
			startedAt: 0,
			wait: { status: "completed" },
			report: "STATUS: PARTIAL",
		})

		expect(failed.status).toBe("failed")
		expect(partial.status).toBe("completed_with_warnings")
	})

	it("records skipped outcomes without overwriting existing phases", () => {
		const phases = [phase({ id: "a", prompt: "A" }), phase({ id: "b", prompt: "B" }), phase({ id: "c", prompt: "C" })]
		const state = run({ outcomes: [outcome({ phaseNumber: 1 })] })

		createController().recordSkippedAutoPhaseOutcomes(phases, 1, state)

		expect(state.outcomes.map((entry) => [entry.phaseNumber, entry.status])).toEqual([
			[1, "failed"],
			[2, "skipped"],
			[3, "skipped"],
		])
	})

	it("stops or continues immediately according to the saved policy", async () => {
		const controller = createController()
		const failed = outcome()
		showMessage.mockClear()

		await expect(
			controller.decideAfterAutoPhaseFailure(run({ onPhaseError: AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_STOP }), failed),
		).resolves.toBe("stop")
		await expect(
			controller.decideAfterAutoPhaseFailure(run({ onPhaseError: AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_CONTINUE }), failed),
		).resolves.toBe("continue")
		expect(showMessage).not.toHaveBeenCalled()
	})

	it("asks instead of auto-continuing when the failure will repeat for the remaining phases", async () => {
		const controller = createController()
		const failed = outcome({ error: "401 Unauthorized: Invalid API key" })
		showMessage.mockResolvedValueOnce({ selectedOption: "Continue with next phase" })

		await expect(
			controller.decideAfterAutoPhaseFailure(run({ onPhaseError: AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_CONTINUE }), failed),
		).resolves.toBe("continue")
		expect(showMessage).toHaveBeenCalled()
	})

	it("recognises auth, credit, and quota failures as blocking", () => {
		const controller = createController()
		expect(controller.isAutoPhaseBlockingError("Invalid API key")).toBe(true)
		expect(controller.isAutoPhaseBlockingError("403 Forbidden")).toBe(true)
		expect(controller.isAutoPhaseBlockingError("Insufficient credits for this request")).toBe(true)
		expect(controller.isAutoPhaseBlockingError("quota exceeded")).toBe(true)
		expect(controller.isAutoPhaseBlockingError("TypeError: cannot read properties of undefined")).toBe(false)
		expect(controller.isAutoPhaseBlockingError(undefined)).toBe(false)
	})

	it("asks the user in ASK mode and honours the selected action", async () => {
		const controller = createController()
		const failed = outcome()

		showMessage.mockResolvedValueOnce({ selectedOption: "Continue with next phase" })
		await expect(controller.decideAfterAutoPhaseFailure(run(), failed)).resolves.toBe("continue")

		showMessage.mockResolvedValueOnce({ selectedOption: "Continue and don't ask again" })
		await expect(controller.decideAfterAutoPhaseFailure(run(), failed)).resolves.toBe("continue-and-dont-ask")

		showMessage.mockResolvedValueOnce({ selectedOption: "Stop the plan" })
		await expect(controller.decideAfterAutoPhaseFailure(run(), failed)).resolves.toBe("stop")

		showMessage.mockResolvedValueOnce({ selectedOption: undefined })
		await expect(controller.decideAfterAutoPhaseFailure(run(), failed)).resolves.toBe("stop")
	})

	it("treats closing the failure prompt as stop", async () => {
		showMessage.mockResolvedValueOnce(undefined)
		await expect(createController().decideAfterAutoPhaseFailure(run(), outcome())).resolves.toBe("stop")
	})

	it("extracts a readable message from serialized provider errors", () => {
		const controller = createController()
		expect(controller.extractAutoPhaseErrorText('{"message":"Invalid API key"}')).toBe("Invalid API key")
		expect(controller.extractAutoPhaseErrorText('{"error":"Rate limited"}')).toBe("Rate limited")
		expect(controller.extractAutoPhaseErrorText("plain failure")).toBe("plain failure")
	})

	it("classifies completed and warning outcomes as successful", () => {
		const controller = createController()
		expect(controller.isAutoPhaseSuccess("completed")).toBe(true)
		expect(controller.isAutoPhaseSuccess("completed_with_warnings")).toBe(true)
		expect(controller.isAutoPhaseSuccess("failed")).toBe(false)
		expect(controller.isAutoPhaseSuccess("blocked")).toBe(false)
		expect(controller.isAutoPhaseSuccess("skipped")).toBe(false)
	})
})
