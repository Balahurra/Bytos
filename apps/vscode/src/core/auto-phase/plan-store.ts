import { AutoPhasePlan } from "@shared/proto/bytos/state"
import type { StateManager } from "@/core/storage/StateManager"

const PLAN_KEY = "autoPhasePlan"
const API_KEYS_SECRET = "autoPhaseApiKeys"
export const MAX_AUTO_PHASES = 10

interface StoredPhase {
	id: string
	prompt: string
	provider: string
	modelId: string
}

interface StoredPlan {
	phases: StoredPhase[]
}

export interface AutoPhasePrompt {
	id: string
	prompt: string
	provider: string
	modelId: string
	apiKey?: string
}

function readStoredPlan(stateManager: StateManager): StoredPlan {
	const raw = stateManager.getGlobalStateKey(PLAN_KEY)
	if (!raw) {
		return { phases: [] }
	}
	try {
		const parsed = JSON.parse(raw) as StoredPlan
		return { phases: Array.isArray(parsed.phases) ? parsed.phases : [] }
	} catch {
		return { phases: [] }
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
		})),
	})
}

/** Read the full plan, including plaintext keys, for the runner. */
export function readAutoPhasePlanWithKeys(stateManager: StateManager): AutoPhasePrompt[] {
	const stored = readStoredPlan(stateManager)
	const keys = readApiKeys(stateManager)
	return stored.phases.map((phase) => ({
		...phase,
		apiKey: keys[phase.id],
	}))
}

/** Persist plan metadata and any edited API keys. */
export function saveAutoPhasePlan(stateManager: StateManager, plan: AutoPhasePlan): AutoPhasePlan {
	const incoming = Array.isArray(plan.phases) ? plan.phases.slice(0, MAX_AUTO_PHASES) : []
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
		return { id, prompt: trimmedPrompt, provider, modelId }
	})

	const activeIds = new Set(phases.map((phase) => phase.id))
	for (const id of Object.keys(nextKeys)) {
		if (!activeIds.has(id)) {
			delete nextKeys[id]
		}
	}

	stateManager.setGlobalState(PLAN_KEY, JSON.stringify({ phases }))
	writeApiKeys(stateManager, nextKeys)
	return readAutoPhasePlan(stateManager)
}
