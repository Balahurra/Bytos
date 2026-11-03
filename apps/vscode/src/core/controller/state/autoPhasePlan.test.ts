import { AutoPhaseAttachment, AutoPhasePlan, AutoPhasePlanPhase } from "@shared/proto/bytos/state"
import { describe, expect, it } from "vitest"
import { MAX_AUTO_PHASES, readAutoPhasePlan, readAutoPhasePlanWithKeys, saveAutoPhasePlan } from "@/core/auto-phase/plan-store"
import type { StateManager } from "@/core/storage/StateManager"

function createFakeStateManager() {
	const global = new Map<string, unknown>()
	const secrets = new Map<string, string | undefined>()
	const stateManager = {
		getGlobalStateKey: (key: string) => global.get(key) as never,
		setGlobalState: (key: string, value: unknown) => {
			global.set(key, value)
		},
		getSecretKey: (key: string) => secrets.get(key) as never,
		setSecret: (key: string, value: string | undefined) => {
			if (value === undefined) {
				secrets.delete(key)
			} else {
				secrets.set(key, value)
			}
		},
	}
	return { stateManager: stateManager as unknown as StateManager, global, secrets }
}

function phase(id: string, patch: Partial<AutoPhasePlanPhase> = {}): AutoPhasePlanPhase {
	return AutoPhasePlanPhase.create({
		id,
		prompt: `prompt ${id}`,
		provider: "anthropic",
		modelId: "claude-sonnet-4-6",
		...patch,
	})
}

describe("auto phase plan store", () => {
	it("saves and reloads phases with their provider and model", () => {
		const { stateManager } = createFakeStateManager()

		saveAutoPhasePlan(
			stateManager,
			AutoPhasePlan.create({
				phases: [phase("a"), phase("b", { provider: "openai", modelId: "gpt-5.4" })],
			}),
		)

		const plan = readAutoPhasePlan(stateManager)
		expect(plan.phases.map((entry) => [entry.id, entry.provider, entry.modelId])).toEqual([
			["a", "anthropic", "claude-sonnet-4-6"],
			["b", "openai", "gpt-5.4"],
		])
	})

	it("keeps the API key of each phase independent and masks it on read", () => {
		const { stateManager, secrets } = createFakeStateManager()

		saveAutoPhasePlan(
			stateManager,
			AutoPhasePlan.create({
				phases: [phase("a", { apiKey: "key-a" }), phase("b", { apiKey: "key-bb" })],
			}),
		)

		const masked = readAutoPhasePlan(stateManager)
		expect(masked.phases.map((entry) => entry.apiKeyLength)).toEqual([5, 6])
		expect(masked.phases[0]?.apiKey).toBeUndefined()

		const withKeys = readAutoPhasePlanWithKeys(stateManager)
		expect(withKeys.map((entry) => entry.apiKey)).toEqual(["key-a", "key-bb"])
		expect(JSON.parse(secrets.get("autoPhaseApiKeys") ?? "{}")).toEqual({ a: "key-a", b: "key-bb" })
	})

	it("preserves a stored key when only the prompt is saved again", () => {
		const { stateManager } = createFakeStateManager()
		saveAutoPhasePlan(stateManager, AutoPhasePlan.create({ phases: [phase("a", { apiKey: "key-a" })] }))

		saveAutoPhasePlan(
			stateManager,
			AutoPhasePlan.create({ phases: [phase("a", { prompt: "edited prompt", apiKeyLength: 5 })] }),
		)

		expect(readAutoPhasePlanWithKeys(stateManager)[0]?.apiKey).toBe("key-a")
		expect(readAutoPhasePlanWithKeys(stateManager)[0]?.prompt).toBe("edited prompt")
	})

	it("deletes a phase's key when the phase is removed", () => {
		const { stateManager } = createFakeStateManager()
		saveAutoPhasePlan(
			stateManager,
			AutoPhasePlan.create({ phases: [phase("a", { apiKey: "key-a" }), phase("b", { apiKey: "key-b" })] }),
		)

		saveAutoPhasePlan(stateManager, AutoPhasePlan.create({ phases: [phase("a")] }))

		const withKeys = readAutoPhasePlanWithKeys(stateManager)
		expect(withKeys).toHaveLength(1)
		expect(withKeys[0]?.apiKey).toBe("key-a")
	})

	it("caps the plan at ten phases", () => {
		const { stateManager } = createFakeStateManager()
		const phases = Array.from({ length: MAX_AUTO_PHASES + 3 }, (_, index) => phase(`p${index}`))

		const saved = saveAutoPhasePlan(stateManager, AutoPhasePlan.create({ phases }))

		expect(saved.phases).toHaveLength(MAX_AUTO_PHASES)
		expect(saved.phases[MAX_AUTO_PHASES - 1]?.id).toBe(`p${MAX_AUTO_PHASES - 1}`)
	})

	it("keeps MCP allowlists and attachments per phase", () => {
		const { stateManager } = createFakeStateManager()

		saveAutoPhasePlan(
			stateManager,
			AutoPhasePlan.create({
				phases: [
					phase("a", {
						mcpServers: ["github"],
						mcpServersExplicit: true,
						attachments: [
							AutoPhaseAttachment.create({
								kind: "image",
								name: "shot.png",
								mimeType: "image/png",
								data: "data:image/png;base64,AAAA",
								size: 4,
							}),
							AutoPhaseAttachment.create({
								kind: "text",
								name: "notes.md",
								mimeType: "text/markdown",
								path: "/tmp/notes.md",
							}),
						],
					}),
					phase("b", { mcpServers: [], mcpServersExplicit: true }),
				],
			}),
		)

		const plan = readAutoPhasePlan(stateManager)
		expect(plan.phases[0]?.mcpServers).toEqual(["github"])
		expect(plan.phases[0]?.mcpServersExplicit).toBe(true)
		expect(plan.phases[0]?.attachments.map((attachment) => [attachment.kind, attachment.path])).toEqual([
			["image", undefined],
			["text", "/tmp/notes.md"],
		])
		expect(plan.phases[1]?.mcpServers).toEqual([])
		expect(plan.phases[1]?.mcpServersExplicit).toBe(true)

		const withKeys = readAutoPhasePlanWithKeys(stateManager)
		expect(withKeys[0]?.attachments).toHaveLength(2)
		expect(withKeys[1]?.attachments).toHaveLength(0)
	})
})
