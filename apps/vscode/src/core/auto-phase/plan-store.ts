import { AutoPhaseAttachment, AutoPhaseErrorPolicy, AutoPhasePlan } from "@shared/proto/bytos/state"
import type { StateManager } from "@/core/storage/StateManager"

const PLAN_KEY = "autoPhasePlan"
const API_KEYS_SECRET = "autoPhaseApiKeys"
export const MAX_AUTO_PHASES = 10
const MAX_PHASE_ATTACHMENTS = 20

interface StoredAttachment {
	kind: string
	name: string
	mimeType?: string
	path?: string
	data?: string
	size: number
}

interface StoredPhase {
	id: string
	prompt: string
	provider: string
	modelId: string
	mcpServers: string[]
	mcpServersExplicit: boolean
	attachments: StoredAttachment[]
}

interface StoredPlan {
	phases: StoredPhase[]
	onPhaseError: AutoPhaseErrorPolicy
	writeReport: boolean
	aiSummary: boolean
	passPhaseReports: boolean
}

export interface AutoPhasePrompt {
	id: string
	prompt: string
	provider: string
	modelId: string
	apiKey?: string
	mcpServers: string[]
	mcpServersExplicit: boolean
	attachments: StoredAttachment[]
}

/** The full plan, including run-level settings, for the Auto Phase runner. */
export interface AutoPhaseRunPlan {
	phases: AutoPhasePrompt[]
	onPhaseError: AutoPhaseErrorPolicy
	writeReport: boolean
	aiSummary: boolean
	passPhaseReports: boolean
}

const DEFAULT_PLAN: Omit<StoredPlan, "phases"> = {
	onPhaseError: AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_ASK,
	writeReport: true,
	aiSummary: false,
	passPhaseReports: true,
}

function normalizeErrorPolicy(value: unknown): AutoPhaseErrorPolicy {
	if (value === AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_CONTINUE) {
		return AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_CONTINUE
	}
	if (value === AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_STOP) {
		return AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_STOP
	}
	return AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_ASK
}

function readStoredPlan(stateManager: StateManager): StoredPlan {
	const raw = stateManager.getGlobalStateKey(PLAN_KEY)
	if (!raw) {
		return { phases: [], ...DEFAULT_PLAN }
	}
	try {
		const parsed = JSON.parse(raw) as Partial<StoredPlan>
		const phases = Array.isArray(parsed.phases)
			? parsed.phases.map((phase) => ({
					...phase,
					mcpServers: Array.isArray(phase.mcpServers) ? phase.mcpServers.filter(Boolean) : [],
					mcpServersExplicit: phase.mcpServersExplicit === true,
					attachments: Array.isArray(phase.attachments) ? phase.attachments : [],
				}))
			: []
		return {
			phases,
			onPhaseError: normalizeErrorPolicy(parsed.onPhaseError),
			// Old plans predate reporting. They default to writing a report.
			writeReport: parsed.writeReport !== false,
			aiSummary: parsed.aiSummary === true,
			passPhaseReports: parsed.passPhaseReports !== false,
		}
	} catch {
		return { phases: [], ...DEFAULT_PLAN }
	}
}

function readApiKeys(stateManager: StateManager): Record<string, string> {
	const raw = stateManager.getSecretKey(API_KEYS_SECRET)
	if (!raw) {
		return {}
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, string>
		return parsed && typeof parsed === "object" ? parsed : {}
	} catch {
		return {}
	}
}

function writeApiKeys(stateManager: StateManager, keys: Record<string, string>): void {
	stateManager.setSecret(API_KEYS_SECRET, Object.keys(keys).length > 0 ? JSON.stringify(keys) : undefined)
}

function normalizeId(id: string | undefined, index: number): string {
	const trimmed = id?.trim()
	return trimmed || `auto-phase-${index + 1}-${Date.now().toString(36)}`
}

/** Read the plan for the settings UI. API keys are represented by length only. */
export function readAutoPhasePlan(stateManager: StateManager): AutoPhasePlan {
	const stored = readStoredPlan(stateManager)
	const keys = readApiKeys(stateManager)
	return AutoPhasePlan.create({
		phases: stored.phases.map((phase) => ({
			id: phase.id,
			prompt: phase.prompt,
			provider: phase.provider,
			modelId: phase.modelId,
			apiKeyLength: keys[phase.id]?.length ?? 0,
			mcpServers: phase.mcpServers,
			mcpServersExplicit: phase.mcpServersExplicit,
			attachments: phase.attachments.map((attachment) =>
				AutoPhaseAttachment.create({
					kind: attachment.kind,
					name: attachment.name,
					mimeType: attachment.mimeType,
					path: attachment.path,
					data: attachment.data,
					size: attachment.size,
				}),
			),
		})),
		onPhaseError: stored.onPhaseError,
		writeReport: stored.writeReport,
		aiSummary: stored.aiSummary,
		passPhaseReports: stored.passPhaseReports,
	})
}

/** Read the full plan, including plaintext keys and run-level settings, for the runner. */
export function readAutoPhaseRunPlan(stateManager: StateManager): AutoPhaseRunPlan {
	const stored = readStoredPlan(stateManager)
	const keys = readApiKeys(stateManager)
	return {
		phases: stored.phases.map((phase) => ({
			...phase,
			apiKey: keys[phase.id],
		})),
		onPhaseError: stored.onPhaseError,
		writeReport: stored.writeReport,
		aiSummary: stored.aiSummary,
		passPhaseReports: stored.passPhaseReports,
	}
}

/** Read just the phases, including plaintext keys. Kept for existing callers/tests. */
export function readAutoPhasePlanWithKeys(stateManager: StateManager): AutoPhasePrompt[] {
	return readAutoPhaseRunPlan(stateManager).phases
}

/** Persist plan metadata and any edited API keys. */
export function saveAutoPhasePlan(stateManager: StateManager, plan: AutoPhasePlan): AutoPhasePlan {
	const incoming = Array.isArray(plan.phases) ? plan.phases.slice(0, MAX_AUTO_PHASES) : []
	const onPhaseError = normalizeErrorPolicy(plan.onPhaseError)
	const writeReport = plan.writeReport !== false
	const aiSummary = plan.aiSummary === true
	const passPhaseReports = plan.passPhaseReports !== false
	const existingKeys = readApiKeys(stateManager)
	const nextKeys: Record<string, string> = { ...existingKeys }
	const phases: StoredPhase[] = incoming.map((phase, index) => {
		const id = normalizeId(phase.id, index)
		const trimmedPrompt = phase.prompt?.trim() ?? ""
		const provider = phase.provider?.trim() ?? ""
		const modelId = phase.modelId?.trim() ?? ""

		if (phase.apiKey !== undefined) {
			if (phase.apiKey.length === 0) {
				delete nextKeys[id]
			} else {
				nextKeys[id] = phase.apiKey
			}
		}

		const mcpServers = Array.isArray(phase.mcpServers)
			? [...new Set(phase.mcpServers.map((name) => name.trim()).filter(Boolean))]
			: []
		const attachments: StoredAttachment[] = Array.isArray(phase.attachments)
			? phase.attachments.slice(0, MAX_PHASE_ATTACHMENTS).map((attachment) => ({
					kind: attachment.kind?.trim() || "text",
					name: attachment.name?.trim() || "attachment",
					mimeType: attachment.mimeType?.trim() || undefined,
					path: attachment.path?.trim() || undefined,
					data: attachment.data,
					size: Number.isFinite(attachment.size) ? attachment.size : 0,
				}))
			: []

		return {
			id,
			prompt: trimmedPrompt,
			provider,
			modelId,
			mcpServers,
			mcpServersExplicit: phase.mcpServersExplicit === true,
			attachments,
		}
	})

	const activeIds = new Set(phases.map((phase) => phase.id))
	for (const id of Object.keys(nextKeys)) {
		if (!activeIds.has(id)) {
			delete nextKeys[id]
		}
	}

	stateManager.setGlobalState(PLAN_KEY, JSON.stringify({ phases, onPhaseError, writeReport, aiSummary, passPhaseReports }))
	writeApiKeys(stateManager, nextKeys)
	return readAutoPhasePlan(stateManager)
}
