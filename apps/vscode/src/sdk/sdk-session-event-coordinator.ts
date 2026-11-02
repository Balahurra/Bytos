import type { AgentEvent, CoreSessionEvent } from "@bytos/core"
import { refreshBytosRecommendedModels } from "@/core/controller/models/refreshBytosRecommendedModels"
import type { StateManager } from "@/core/storage/StateManager"
import { BYTOS_RECOMMENDED_MODELS_FALLBACK } from "@/shared/bytos/recommended-models"
import type { BytosApiReqInfo, TurnPhase } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { isBytosManagedProvider } from "@/shared/utils/bytos"
import type { MessageTranslatorState, TranslationResult } from "./message-translator"
import { translateSessionEvent } from "./message-translator"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE, type ProviderFailureTelemetry } from "./provider-failure-telemetry"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkTaskHistory } from "./sdk-task-history"
import type { TaskProxy } from "./task-proxy"

function normalizeModelId(modelId: string): string {
	return modelId.trim().toLowerCase()
}

type AgentFailureTelemetry = Pick<ProviderFailureTelemetry, "sessionId" | "error" | "errorType"> | undefined

export interface SdkSessionEventCoordinatorOptions {
	messageTranslatorState: MessageTranslatorState
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	getTask: () => TaskProxy | undefined
	postStateToWebview: () => Promise<void>
	stateManager?: StateManager
	translateSessionEvent?: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult
	isBytosFreeModel?: () => Promise<boolean>
	/**
	 * Set the authoritative UI turn phase. Called as the agent streams (streaming), on a
	 * completed turn (completed if attempt_completion was used, else awaiting_followup), and on
	 * error. Optional for tests.
	 */
	setTurnPhase?: (phase: TurnPhase, anchorTs?: number) => void
	/** Current authoritative UI turn phase, from the controller's TurnStateTracker. */
	getTurnPhase?: () => TurnPhase
	captureProviderApiError?: (event: ProviderFailureTelemetry) => void
	beginProviderFailureTelemetryTurn?: () => void
}

export class SdkSessionEventCoordinator {
	private readonly translateSessionEvent: (event: CoreSessionEvent, state: MessageTranslatorState) => TranslationResult

	constructor(private readonly options: SdkSessionEventCoordinatorOptions) {
		this.translateSessionEvent = options.translateSessionEvent ?? translateSessionEvent
	}

	async handleSessionEvent(event: CoreSessionEvent): Promise<void> {
		this.logQueueEvents(event)

		const activeSession = this.options.sessions.getActiveSession()
		if (!activeSession || event.payload.sessionId !== activeSession.sessionId) {
			Logger.debug(
				`[SdkController] Ignoring stale SDK event for session ${event.payload.sessionId}; active=${activeSession?.sessionId ?? "none"}`,
			)
			return
		}

		if (event.type === "pending_prompts") {
			this.options.sessions.setQueuedPromptCount(event.payload.prompts.length)
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post pending-prompt state update:", err)
			})
		}

		const result = this.translateSessionEvent(event, this.options.messageTranslatorState)
		const agentFailure = this.getAgentFailureTelemetry(event)
		if (agentFailure && !this.options.messageTranslatorState.isSuppressedToolApprovalDenial(agentFailure.error)) {
			this.options.captureProviderApiError?.({
				sessionId: agentFailure.sessionId,
				error: agentFailure.error,
				errorType: agentFailure.errorType,
				failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
			})
		}
		if (event.type === "pending_prompt_submitted") {
			this.options.beginProviderFailureTelemetryTurn?.()
			this.options.messageTranslatorState.clearTurnOutcome()
			this.options.sessions.setRunning(true)
			this.options.setTurnPhase?.(PROVIDER_FAILURE_PHASE.STREAMING)
		}
		const zeroCostPromise = this.zeroCostForFreeBytosModel(result)
		if (zeroCostPromise) {
			await zeroCostPromise
		}

		if (!activeSession.isRunning && result.messages.length > 0) {
			result.messages = result.messages.filter(
				(m) => !(m.type === "ask" && (m.ask === "completion_result" || m.ask === "resume_completed_task")),
			)
		}

		if (result.messages.length > 0) {
			this.options.messages.appendAndEmit(result.messages, event)
		}

		if (activeSession) {
			if (result.sessionEnded || result.turnComplete) {
				// Authoritative UI phase at turn end. If the completion tool was used this turn
				// the phase is "completed" (green box + Start New Task); otherwise the agent
				// simply stopped and is waiting for the user ("awaiting_followup"). Error turns
				// are surfaced as the error phase. The webview reads this, not the array tail.
				//
				// EXCEPTION: a turn-complete from a turn that was cancelled (cancelTask set phase
				// "resumable" and aborted) is a straggler. Overwriting it here would clobber
				// "resumable" with "awaiting_followup"/"completed" and the footer would lose the
				// Resume Task button (showing the scroll-arrow default instead), so the cancel-set
				// phase is preserved. Check the phase itself, not just isRunning: when the SDK
				// drains a queued prompt at turn end, the PREVIOUS turn's send promise settles
				// after the new turn already started and its completion bookkeeping flips
				// isRunning back to false mid-turn (see fireAndForgetSend). Keying on isRunning
				// alone made the queued turn's real completion look like this straggler, leaving
				// the phase stuck on "streaming" (endless Thinking).
				if (!activeSession.isRunning && this.options.getTurnPhase?.() === "resumable") {
					Logger.debug("[SdkController] turn-complete straggler after cancel; preserving resumable phase")
				} else if (this.options.messageTranslatorState.wasErrorSeen()) {
					// The turn surfaced a provider error (ask:"api_req_failed" was emitted) —
					// offer error recovery (Retry / Start New Task), not the followup state.
					this.options.setTurnPhase?.("error")
				} else if (this.options.messageTranslatorState.wasAttemptCompletionSeen()) {
					this.options.setTurnPhase?.("completed")
				} else {
					this.options.setTurnPhase?.("awaiting_followup")
				}

				this.options.sessions.setRunning(false)
			}

			if (result.usage && activeSession.startResult) {
				Promise.resolve(
					this.options.taskHistory.updateTaskUsage(
						this.options.getTask()?.taskId ?? this.options.sessions.getActiveSession()?.sessionId,
						result.usage,
					),
				).catch((error) => {
					Logger.error("[SdkController] Failed to persist task usage:", error)
				})
			}
		}

		// Post state when there are messages to ship OR when the turn ended. A clean turn end's
		// `done` event carries no transcript message, yet the authoritative phase just changed to
		// completed/awaiting_followup/error above; without posting here the webview would stay on
		// the prior phase (footer stuck on the streaming/scroll state). The webview reducer gates
		// turnState by seq, so an extra no-message post is safe.
		if (
			result.messages.length > 0 ||
			result.sessionEnded ||
			result.turnComplete ||
			event.type === "pending_prompt_submitted"
		) {
			this.options.postStateToWebview().catch((err) => {
				Logger.error("[SdkController] Failed to post state after event:", err)
			})
		}
	}

	private getAgentFailureTelemetry(event: CoreSessionEvent): AgentFailureTelemetry {
		if (event.type !== "agent_event") {
			return undefined
		}

		const agentEvent: AgentEvent = event.payload.event
		if (agentEvent.type === "error") {
			if (agentEvent.error == null) {
				return undefined
			}
			// Only terminal failures are provider failures. `recoverable: true`
			// error events are in-run notices — the MistakeTracker emits one for
			// EVERY recorded mistake (with the tool/mistake details as the
			// message, e.g. "2 tool call(s) failed: [shell] ...") and hook
			// failures surface the same way. Counting those here misclassified
			// tool noise as provider API errors and inflated the SDK bundle's
			// error rate ~9x vs legacy in the A/B rollout dashboards. Genuine
			// run failures (run-failed) always carry `recoverable: false`.
			if (agentEvent.recoverable !== false) {
				return undefined
			}
			return {
				sessionId: event.payload.sessionId,
				error: agentEvent.error,
				errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_ERROR,
			}
		}
		if (agentEvent.type === "done" && agentEvent.reason === "error") {
			const errorMessage = agentEvent.text.trim() || "SDK agent finished with error"
			return {
				sessionId: event.payload.sessionId,
				error: errorMessage,
				errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR,
			}
		}
		return undefined
	}

	private zeroCostForFreeBytosModel(result: TranslationResult): Promise<void> | undefined {
		const hasUsageCost = typeof result.usage?.totalCost === "number" && result.usage.totalCost !== 0
		const hasMessageCost = result.messages.some((message) => {
			if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
				return false
			}
			try {
				const info = JSON.parse(message.text) as BytosApiReqInfo
				return typeof info.cost === "number" && info.cost !== 0
			} catch {
				return false
			}
		})

		if (!hasUsageCost && !hasMessageCost) {
			return undefined
		}

		return (async () => {
			if (!(await this.isCurrentBytosModelFree())) {
				return
			}

			if (result.usage) {
				result.usage = { ...result.usage, totalCost: 0 }
			}

			result.messages = result.messages.map((message) => {
				if (message.type !== "say" || message.say !== "api_req_started" || !message.text) {
					return message
				}
				try {
					const info = JSON.parse(message.text) as BytosApiReqInfo
					if (typeof info.cost !== "number") {
						return message
					}
					return {
						...message,
						text: JSON.stringify({ ...info, cost: 0 } satisfies BytosApiReqInfo),
					}
				} catch {
					return message
				}
			})
		})()
	}

	private async isCurrentBytosModelFree(): Promise<boolean> {
		if (this.options.isBytosFreeModel) {
			return this.options.isBytosFreeModel()
		}

		const stateManager = this.options.stateManager
		if (!stateManager) {
			return false
		}

		try {
			const apiConfig = stateManager.getApiConfiguration()
			const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
			const provider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
			// Free models are also selectable on BytosPass — they ride usage billing at $0
			if (!isBytosManagedProvider(provider)) {
				return false
			}

			const modelId = this.getCurrentBytosModelId()
			if (!modelId) {
				return false
			}

			const normalizedModelId = normalizeModelId(modelId)
			const models = await refreshBytosRecommendedModels()
			const freeIds = models.free.map((model) => normalizeModelId(model.id)).filter(Boolean)
			const resolvedFreeIds =
				freeIds.length > 0 ? freeIds : BYTOS_RECOMMENDED_MODELS_FALLBACK.free.map((model) => normalizeModelId(model.id))
			return resolvedFreeIds.includes(normalizedModelId)
		} catch (error) {
			Logger.error("[SdkController] Failed to check Bytos free model list:", error)
			const modelId = this.getCurrentBytosModelId()
			if (!modelId) {
				return false
			}
			const fallbackFreeIds = BYTOS_RECOMMENDED_MODELS_FALLBACK.free.map((model) => normalizeModelId(model.id))
			return fallbackFreeIds.includes(normalizeModelId(modelId))
		}
	}

	private getCurrentBytosModelId(): string | undefined {
		const stateManager = this.options.stateManager
		if (!stateManager) {
			return undefined
		}
		const apiConfig = stateManager.getApiConfiguration()
		const mode = stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
		const provider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		if (provider === "bytos-pass") {
			return mode === "plan" ? apiConfig.planModeBytosPassModelId : apiConfig.actModeBytosPassModelId
		}
		return mode === "plan" ? apiConfig.planModeBytosModelId : apiConfig.actModeBytosModelId
	}

	private logQueueEvents(event: CoreSessionEvent): void {
		if (event.type === "pending_prompts") {
			const count = event.payload.prompts.length
			Logger.log(
				`[SdkController] Pending prompts updated: ${count} prompt(s) in queue for session ${event.payload.sessionId}`,
			)
			return
		}

		if (event.type === "pending_prompt_submitted") {
			Logger.log(
				`[SdkController] Pending prompt submitted: "${event.payload.prompt.substring(0, 80)}" for session ${event.payload.sessionId}`,
			)
		}
	}
}
