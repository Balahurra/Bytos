import { toProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModels } from "@/hooks/useProviderModels"
import BytosModelPicker from "./BytosModelPicker"

const mocks = vi.hoisted(() => ({
	commitSelection: vi.fn(async () => undefined),
	writeProviderConfig: vi.fn(async () => undefined),
	updateApiConfigurationProto: vi.fn(async () => undefined),
	makeUnaryRequest: vi.fn(async () => ({
		recommended: [
			{
				id: "bytos-next",
				name: "Bytos Next",
				description: "Next Bytos model",
				tags: ["recommended"],
			},
		],
		free: [],
	})),
	toggleFavoriteModel: vi.fn(async () => undefined),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/hooks/useDynamicProviderSelection", () => ({
	useDynamicProviderSelection: vi.fn(),
}))

vi.mock("@/hooks/useProviderModels", () => ({
	useProviderModels: vi.fn(),
}))

vi.mock("@/hooks/useProviderConfig", () => ({
	useProviderConfig: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		makeUnaryRequest: mocks.makeUnaryRequest,
		updateApiConfigurationProto: mocks.updateApiConfigurationProto,
		updateApiConfigurationPartial: vi.fn(async () => undefined),
	},
	StateServiceClient: {
		toggleFavoriteModel: mocks.toggleFavoriteModel,
	},
}))

describe("BytosModelPicker", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {
				actModeBytosModelId: "bytos-default",
				actModeBytosModelInfo: {
					name: "Bytos Default",
					supportsPromptCache: true,
				},
			},
			favoritedModelIds: [],
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)

		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"bytos-default": { name: "Bytos Default", supportsPromptCache: true },
				"bytos-next": {
					name: "Bytos Next",
					supportsPromptCache: true,
					contextWindow: 128_000,
				},
			},
			defaultModelId: "bytos-default",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})

		vi.mocked(useProviderConfig).mockReturnValue({
			config: undefined,
			write: mocks.writeProviderConfig,
			commitSelection: mocks.commitSelection,
		})

		vi.mocked(useDynamicProviderSelection).mockReturnValue({
			selectedModelId: "bytos-default",
			selectedModelInfo: { name: "Bytos Default", supportsPromptCache: true },
			hideUsageCost: false,
		})
	})

	it("commits Bytos model selections through provider config so providers.json is updated", async () => {
		render(<BytosModelPicker currentMode="act" />)

		// Featured cards render the display name from the RPC, but selection
		// still commits the underlying model id.
		fireEvent.click(await screen.findByText("Bytos Next"))

		await waitFor(() => expect(mocks.commitSelection).toHaveBeenCalledTimes(1))
		expect(mocks.commitSelection).toHaveBeenCalledWith("act", {
			providerId: "bytos",
			modelId: "bytos-next",
		})
	})

	it("renders RPC-provided display names on featured cards, falling back to ids", async () => {
		// Names arrive display-ready: the extension host resolves them against
		// the model catalog in fetchBytosRecommendedModels.
		mocks.makeUnaryRequest.mockResolvedValueOnce({
			recommended: [{ id: "anthropic/claude-opus-5", name: "Claude Opus 5", description: "Frontier model", tags: ["NEW"] }],
			free: [
				{ id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", description: "Fast and efficient", tags: [] },
				{ id: "unknown/mystery-model", name: "", description: "No display name", tags: [] },
			],
		})

		render(<BytosModelPicker currentMode="act" />)

		expect(await screen.findByText("Claude Opus 5")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Free"))

		expect(await screen.findByText("DeepSeek V4 Flash")).toBeInTheDocument()
		// A missing display name degrades to the raw id
		expect(screen.getByText("unknown/mystery-model")).toBeInTheDocument()
	})

	it("hydrates the selected Bytos model from provider config when legacy settings are empty", () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {},
			favoritedModelIds: [],
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				providerId: "bytos",
				actSelection: {
					providerId: "bytos",
					modelId: "bytos-next",
					modelInfo: toProtobufModelInfo({
						name: "Bytos Next",
						supportsPromptCache: true,
						contextWindow: 128_000,
					}),
				},
			},
			write: mocks.writeProviderConfig,
			commitSelection: mocks.commitSelection,
		})

		render(<BytosModelPicker currentMode="act" />)

		expect(screen.getByRole("combobox")).toHaveValue("bytos-next")
	})

	it("uses live catalog reasoning support when the saved Bytos model snapshot is stale", () => {
		vi.mocked(useExtensionState).mockReturnValue({
			apiConfiguration: {
				actModeBytosModelId: "glm-5.2",
				actModeBytosModelInfo: {
					name: "GLM 5.2",
					supportsPromptCache: true,
				},
			},
			favoritedModelIds: [],
			planActSeparateModelsSetting: true,
		} as ReturnType<typeof useExtensionState>)
		vi.mocked(useProviderModels).mockReturnValue({
			models: {
				"glm-5.2": {
					name: "GLM 5.2",
					supportsPromptCache: true,
					contextWindow: 1_048_576,
					supportsReasoning: true,
				},
			},
			defaultModelId: "glm-5.2",
			isLoading: false,
			isStale: false,
			error: undefined,
			refresh: vi.fn(),
			fingerprint: "fingerprint",
		})
		vi.mocked(useProviderConfig).mockReturnValue({
			config: {
				providerId: "bytos",
				actSelection: {
					providerId: "bytos",
					modelId: "glm-5.2",
					modelInfo: toProtobufModelInfo({
						name: "GLM 5.2",
						supportsPromptCache: true,
					}),
				},
			},
			write: mocks.writeProviderConfig,
			commitSelection: mocks.commitSelection,
		})
		vi.mocked(useDynamicProviderSelection).mockReturnValue({
			selectedModelId: "glm-5.2",
			selectedModelInfo: { name: "GLM 5.2", supportsPromptCache: true },
			hideUsageCost: false,
		})

		render(<BytosModelPicker currentMode="act" />)

		expect(screen.getByText("Reasoning Effort")).toBeInTheDocument()
	})
})
