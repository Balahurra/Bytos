import type { ModelInfo } from "@shared/api"
import { openAiModelInfoSafeDefaults } from "@shared/api"
import { BYTOS_RECOMMENDED_MODELS_FALLBACK } from "@shared/bytos/recommended-models"
import { EmptyRequest } from "@shared/proto/bytos/common"
import { type BytosRecommendedModel, BytosRecommendedModelsResponse } from "@shared/proto/bytos/models"
import { Mode } from "@shared/storage/types"
import { useEffect, useMemo, useState } from "react"
import styled from "styled-components"
import { buildBytosPassSubscriptionPageUrl } from "@/components/onboarding/bytosPassSubscribe"
import { useBytosAuth } from "@/context/BytosAuthContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { ModelsServiceClient } from "@/services/grpc-client"
import { BytosAccountInfoCard } from "../BytosAccountInfoCard"
import { ModelInfoView } from "../common/ModelInfoView"
import FeaturedModelCard from "../FeaturedModelCard"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

interface BytosPassProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const BYTOS_PASS_PROVIDER_ID = "bytos-pass"
const BYTOS_PASS_MODEL_ID_PREFIX = "bytos-pass/"
const FREE_TAB_DESCRIPTION = "Try with limited usage, separate from BytosPass quota."

interface FeaturedTabEntry {
	id: string
	displayName: string
	description: string
	label: string
}

function bytosPassFallbackModelInfo(modelId: string): ModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
		inputPrice: 0,
		outputPrice: 0,
		cacheReadsPrice: 0,
		cacheWritesPrice: 0,
	}
}

// Names arrive display-ready from the recommended-models RPC (the extension
// host resolves them against the model catalog in fetchBytosRecommendedModels)

function toSubscribedEntry(model: Pick<BytosRecommendedModel, "id" | "name" | "description">): FeaturedTabEntry | null {
	if (!model.id) {
		return null
	}
	// The whole list is included with the plan, so no per-card label chip
	return {
		id: model.id,
		displayName: model.name || model.id.replace(BYTOS_PASS_MODEL_ID_PREFIX, ""),
		description: model.description || "",
		label: "",
	}
}

function toFreeEntry(model: Pick<BytosRecommendedModel, "id" | "name" | "description" | "tags">): FeaturedTabEntry | null {
	if (!model.id) {
		return null
	}
	const firstTag = model.tags?.[0]
	return {
		id: model.id,
		displayName: model.name || model.id,
		description: model.description || "",
		label: typeof firstTag === "string" && firstTag.length > 0 ? firstTag.toUpperCase() : "FREE",
	}
}

/**
 * BytosPass is a first-class SDK provider whose credentials are backed by the
 * user's Bytos OAuth account. Keep the UX close to the Bytos provider (account
 * card + model selection), but resolve and persist selections through the SDK
 * provider catalog under providerId="bytos-pass".
 *
 * The featured section splits the catalog into Subscribed (the plan's models)
 * and Free (Bytos free models, selectable here because both providers hit the
 * same Bytos API — free models simply ride usage billing at $0).
 */
export const BytosPassProvider = ({ showModelOptions, isPopup, currentMode }: BytosPassProviderProps) => {
	const { models, defaultModelId, isLoading, isStale, error } = useProviderModels(BYTOS_PASS_PROVIDER_ID)
	const { config, write, commitSelection } = useProviderConfig(BYTOS_PASS_PROVIDER_ID)
	const { selectedModel, commitModelSelection } = useProviderModelSelection(BYTOS_PASS_PROVIDER_ID, currentMode, {
		models,
		defaultModelId,
		config,
		commitSelection,
		customModelInfo: bytosPassFallbackModelInfo,
	})
	const { bytosUser } = useBytosAuth()
	const [subscribedModels, setSubscribedModels] = useState<BytosRecommendedModel[]>([])
	const [freeModels, setFreeModels] = useState<BytosRecommendedModel[]>([])
	const [activeTab, setActiveTab] = useState<"subscribed" | "free">("subscribed")

	useEffect(() => {
		let cancelled = false
		const fetchRecommendedModels = async () => {
			try {
				const response = await ModelsServiceClient.makeUnaryRequest(
					"refreshBytosRecommendedModelsRpc",
					EmptyRequest.create({}),
					EmptyRequest.toJSON,
					BytosRecommendedModelsResponse.fromJSON,
				)
				if (cancelled) {
					return
				}
				setSubscribedModels(response.bytosPass ?? [])
				setFreeModels(response.free ?? [])
			} catch (err) {
				console.error("Failed to refresh BytosPass recommended models:", err)
			}
		}
		void fetchRecommendedModels()
		return () => {
			cancelled = true
		}
	}, [])

	// Fall back to the provider catalog (subscribed) and the bundled free list
	// until the endpoint responds
	const subscribedCards = useMemo(() => {
		if (subscribedModels.length > 0) {
			return subscribedModels.map(toSubscribedEntry).filter((entry): entry is FeaturedTabEntry => entry !== null)
		}
		return Object.keys(models ?? {})
			.filter((id) => id.startsWith(BYTOS_PASS_MODEL_ID_PREFIX))
			.map((id) => toSubscribedEntry({ id, name: models[id]?.name ?? "", description: models[id]?.description ?? "" }))
			.filter((entry): entry is FeaturedTabEntry => entry !== null)
	}, [subscribedModels, models])

	const freeCards = useMemo(() => {
		const source = freeModels.length > 0 ? freeModels : BYTOS_RECOMMENDED_MODELS_FALLBACK.free
		return source.map(toFreeEntry).filter((entry): entry is FeaturedTabEntry => entry !== null)
	}, [freeModels])

	// Land on the tab containing the configured model
	useEffect(() => {
		if (freeCards.some((entry) => entry.id === selectedModel.modelId)) {
			setActiveTab("free")
		} else if (subscribedCards.some((entry) => entry.id === selectedModel.modelId)) {
			setActiveTab("subscribed")
		}
	}, [selectedModel.modelId, freeCards, subscribedCards])

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitModelSelection(selection).catch((err) => console.error("Failed to commit BytosPass model selection:", err))
	}

	const handleFeaturedModelSelect = (modelId: string) => {
		handleModelSelect({
			providerId: BYTOS_PASS_PROVIDER_ID,
			modelId,
			modelInfo: models?.[modelId] ?? bytosPassFallbackModelInfo(modelId),
		})
	}

	const activeCards = activeTab === "free" ? freeCards : subscribedCards

	return (
		<div>
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<BytosAccountInfoCard usageLink={buildBytosPassSubscriptionPageUrl(bytosUser?.appBaseUrl)} />
			</div>

			{showModelOptions && (
				<>
					{/* Tabs */}
					<TabsContainer style={{ marginTop: 4 }}>
						<Tab active={activeTab === "subscribed"} onClick={() => setActiveTab("subscribed")}>
							Subscribed
						</Tab>
						{freeCards.length > 0 && (
							<Tab active={activeTab === "free"} onClick={() => setActiveTab("free")}>
								Free
							</Tab>
						)}
					</TabsContainer>

					{/* Tab description */}
					{activeTab === "free" && <TabDescription>{FREE_TAB_DESCRIPTION}</TabDescription>}

					{/* Model Cards */}
					<div style={{ marginBottom: "6px" }}>
						{activeCards.map((entry) => (
							<FeaturedModelCard
								description={entry.description}
								displayName={entry.displayName}
								isSelected={selectedModel.modelId === entry.id}
								key={entry.id}
								label={entry.label}
								onClick={() => handleFeaturedModelSelect(entry.id)}
							/>
						))}
					</div>

					<ModelPickerWithManualEntry
						allowsCustomIds={false}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={models}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					{selectedModel.modelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							onEffortChange={(effort) => {
								void write({
									reasoning: {
										enabled: effort !== "none",
										effort: effort !== "none" ? effort : undefined,
									},
								}).catch((err) => console.error("Failed to update BytosPass reasoning effort:", err))
							}}
						/>
					)}

					<ModelInfoView
						hideUsageCost={true}
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}

const TabsContainer = styled.div`
	display: flex;
	gap: 0;
	margin-bottom: 12px;
	border-bottom: 1px solid var(--vscode-panel-border);
`

const Tab = styled.div<{ active: boolean }>`
	padding: 8px 16px;
	cursor: pointer;
	font-size: 12px;
	font-weight: 500;
	color: ${({ active }) => (active ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	border-bottom: 2px solid ${({ active }) => (active ? "var(--vscode-textLink-foreground)" : "transparent")};
	transition: all 0.15s ease;

	&:hover {
		color: var(--vscode-foreground);
	}
`

const TabDescription = styled.p`
	font-size: 11px;
	margin: -6px 0 6px 0;
	color: var(--vscode-descriptionForeground);
`
