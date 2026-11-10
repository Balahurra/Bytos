import { updateSettings } from "@core/controller/state/updateSettings"
import { UpdateSettingsRequest } from "@shared/proto/bytos/state"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * F3 — Settings persistence for the Voice section.
 *
 * The test drives the real `updateSettings` handler with a fake state manager, so
 * what is asserted is exactly what the extension writes to global state (and
 * therefore what survives a restart). Validation of the language and model ids
 * is asserted too: the recogniser must never be handed a value it cannot honour.
 */

const { loggedWarnings } = vi.hoisted(() => ({ loggedWarnings: [] as unknown[] }))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: (...args: unknown[]) => loggedWarnings.push(args),
		warn: () => {},
		log: () => {},
		debug: () => {},
		info: () => {},
	},
}))

vi.mock("@bytos/core", () => ({
	setCompactionStrategyGlobally: () => {},
	setModelToolEnabledGlobally: () => {},
}))

vi.mock("@/config", () => ({ BytosEnv: { setEnvironment: () => {} } }))
vi.mock("@/services/telemetry", () => ({ telemetryService: { captureFeatureToggle: () => {} } }))
vi.mock("@core/controller/account/accountLogoutClicked", () => ({ accountLogoutClicked: async () => {} }))
vi.mock("@shared/proto-conversions/models/api-configuration-conversion", () => ({
	convertProtoToApiProvider: (value: unknown) => value,
}))

interface Harness {
	controller: unknown
	global: Map<string, unknown>
	posted: number
}

function makeHarness(initial: Record<string, unknown> = {}): Harness {
	const global = new Map<string, unknown>(Object.entries(initial))
	const harness: Harness = {
		global,
		posted: 0,
		controller: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => global.get(key),
				getGlobalStateKey: (key: string) => global.get(key),
				setGlobalState: (key: string, value: unknown) => {
					global.set(key, value)
				},
				getApiConfiguration: () => undefined,
				setApiConfiguration: () => {},
				getRemoteConfigSettings: () => undefined,
			},
			postStateToWebview: async () => {
				harness.posted++
			},
			handleApiConfigurationChanged: () => {},
			getProviderConfigStore: () => ({}),
			updateTelemetrySetting: async () => {},
			task: undefined,
		},
	}
	return harness
}

async function applyPatch(harness: Harness, patch: Record<string, unknown>): Promise<void> {
	await updateSettings(harness.controller as never, UpdateSettingsRequest.create(patch as never))
}

describe("updateSettings — voice recognition preferences (F3)", () => {
	beforeEach(() => {
		loggedWarnings.length = 0
	})

	it("persists the enabled flag", async () => {
		const harness = makeHarness({ voiceEnabled: false })
		await applyPatch(harness, { voiceEnabled: true })
		expect(harness.global.get("voiceEnabled")).toBe(true)
	})

	it("persists the selected microphone id, and an empty string clears the pin", async () => {
		const harness = makeHarness()
		await applyPatch(harness, { voiceMicrophoneId: "{0.0.1.00000000}.{device-a}" })
		expect(harness.global.get("voiceMicrophoneId")).toBe("{0.0.1.00000000}.{device-a}")
		await applyPatch(harness, { voiceMicrophoneId: "" })
		expect(harness.global.get("voiceMicrophoneId")).toBeUndefined()
	})

	it.each(["auto", "tr", "en", "de"])("persists the supported language %s", async (language) => {
		const harness = makeHarness()
		await applyPatch(harness, { voiceLanguage: language })
		expect(harness.global.get("voiceLanguage")).toBe(language)
	})

	it("rejects an unsupported language instead of forwarding it to the recogniser", async () => {
		const harness = makeHarness({ voiceLanguage: "en" })
		await expect(applyPatch(harness, { voiceLanguage: "es" })).rejects.toThrow(/Invalid voice language/)
		// The previous value is untouched.
		expect(harness.global.get("voiceLanguage")).toBe("en")
	})

	it.each(["tiny", "base"])("persists the supported model %s", async (modelId) => {
		const harness = makeHarness()
		await applyPatch(harness, { voiceModelId: modelId })
		expect(harness.global.get("voiceModelId")).toBe(modelId)
	})

	it("rejects a model that is not pinned", async () => {
		const harness = makeHarness({ voiceModelId: "base" })
		await expect(applyPatch(harness, { voiceModelId: "medium" })).rejects.toThrow(/Invalid voice model/)
		expect(harness.global.get("voiceModelId")).toBe("base")
	})

	it("ignores an empty string rather than storing it", async () => {
		const harness = makeHarness({ voiceLanguage: "tr", voiceModelId: "tiny" })
		await applyPatch(harness, { voiceLanguage: "", voiceModelId: "" })
		expect(harness.global.get("voiceLanguage")).toBe("tr")
		expect(harness.global.get("voiceModelId")).toBe("tiny")
	})

	it("pushes the new state to the webview after a write", async () => {
		const harness = makeHarness()
		await applyPatch(harness, { voiceEnabled: true, voiceLanguage: "de", voiceModelId: "tiny" })
		expect(harness.posted).toBe(1)
	})
})
