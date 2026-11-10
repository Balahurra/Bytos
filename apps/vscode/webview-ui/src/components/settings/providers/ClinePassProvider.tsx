import type { ModelInfo } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { useEffect } from "react"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"
import { CLINE_PASS_DEFAULT_MODEL_ID, CLINE_PASS_MODELS, clinePassFallbackModelInfo } from "./clinePassModels"
import { ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

/**
 * ClinePass compatibility provider.
 *
 * This keeps the door open for people who already have a Cline API key. It
 * deliberately uses Cline's hosted endpoint rather than the (not yet live)
 * Bytos endpoint, so an existing Cline key can be pasted here and used as-is.
 * Cline's pricing and terms apply; this is an interoperability surface, not a
 * Bytos subscription.
 */
const PROVIDER_ID = "cline-pass" as const
const CLINE_API_BASE_URL = "https://api.cline.bot/api/v1"

interface ClinePassProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const ClinePassProvider = ({ showModelOptions, isPopup, currentMode }: ClinePassProviderProps) => {
	const { config, write, commitSelection } = useProviderConfig(PROVIDER_ID)
	const { selectedModel, commitModelSelection } = useProviderModelSelection(PROVIDER_ID, currentMode, {
		models: CLINE_PASS_MODELS,
		defaultModelId: CLINE_PASS_DEFAULT_MODEL_ID,
		config,
		commitSelection,
		customModelInfo: clinePassFallbackModelInfo,
	})

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "ClinePass",
		write: (patch) => write({ ...patch, accessToken: "", refreshToken: "" }),
	})

	// Cline's API is the compatibility endpoint for this provider. Only write
	// the default when the user has not set a base URL, so an advanced user can
	// still point it elsewhere.
	useEffect(() => {
		if (config && !config.baseUrl) {
			void write({ baseUrl: CLINE_API_BASE_URL }).catch((error) =>
				console.error("Failed to set ClinePass base URL:", error),
			)
		}
	}, [config, write])

	// If this machine previously stored a Bytos OAuth token for the same
	// provider slot, clear it so the pasted Cline API key is actually used.
	useEffect(() => {
		if (config?.hasAccessToken || config?.hasRefreshToken) {
			void write({ accessToken: "", refreshToken: "" }).catch((error) =>
				console.error("Failed to clear stale ClinePass tokens:", error),
			)
		}
	}, [config?.hasAccessToken, config?.hasRefreshToken, write])

	const handleBaseUrlChange = (value: string) => {
		void write({ baseUrl: value }).catch((error) => console.error("Failed to update ClinePass base URL:", error))
	}

	const handleBaseUrlClear = async () => {
		await write({ baseUrl: CLINE_API_BASE_URL })
	}

	const handleModelSelect = (selection: { modelId: string; modelInfo: ModelInfo }) => {
		void commitModelSelection(selection).catch((error) => console.error("Failed to commit ClinePass model selection:", error))
	}

	return (
		<div>
			<ApiKeyField
				helpText="Compatibility provider: uses your Cline API key against Cline's hosted API. Cline's pricing and terms apply."
				initialValue={savedApiKeyMask}
				onChange={handleApiKeyChange}
				providerName="ClinePass"
				signupUrl="https://app.cline.bot"
			/>

			<BaseUrlField
				initialValue={config?.baseUrl}
				label="Cline API base URL"
				onChange={handleBaseUrlChange}
				onClear={handleBaseUrlClear}
				placeholder={`Default: ${CLINE_API_BASE_URL}`}
			/>

			{showModelOptions && (
				<>
					<ModelPickerWithManualEntry
						allowsCustomIds={true}
						isLoading={false}
						isStale={false}
						models={CLINE_PASS_MODELS}
						onSelect={(selection) => handleModelSelect(selection)}
						selectedModel={selectedModel}
					/>
					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}
