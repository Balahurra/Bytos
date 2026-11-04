import { BooleanRequest } from "@shared/proto/bytos/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo, useEffect, useState } from "react"
import BytosLogoWhite from "@/assets/BytosLogoWhite"
import ApiOptions from "@/components/settings/ApiOptions"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { validateApiConfiguration } from "@/utils/validate"

/**
 * Free BYOK onboarding.
 *
 * There is no Bytos account, subscription, credits, or cloud gate. The user
 * configures a provider and an API key; the key is stored by the VS Code host
 * in SecretStorage and never sent to this webview.
 */
const WelcomeView = memo(() => {
	const { apiConfiguration, mode } = useExtensionState()
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [isLoading, setIsLoading] = useState(false)

	const disableLetsGoButton = apiErrorMessage != null

	const handleSubmit = async () => {
		setIsLoading(true)
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to complete the welcome view:", error)
		} finally {
			setIsLoading(false)
		}
	}

	useEffect(() => {
		setApiErrorMessage(validateApiConfiguration(mode, apiConfiguration))
	}, [apiConfiguration, mode])

	return (
		<div className="fixed inset-0 p-0 flex flex-col">
			<div className="h-full px-5 overflow-auto flex flex-col gap-2.5">
				<h2 className="text-lg font-semibold">Welcome to Bytos</h2>
				<div className="flex justify-center my-5">
					<BytosLogoWhite className="size-16" />
				</div>
				<p>
					Bytos is a free, bring-your-own-key coding agent. It can create and edit files, explore projects, use a
					browser, and run terminal commands <i>with your permission</i>.
				</p>

				<p className="text-(--vscode-descriptionForeground)">
					Choose a provider and enter your own API key. Your key is stored in VS Code SecretStorage, is never written to
					a plaintext settings file, and is sent only to the provider you select. You pay that provider directly for
					model usage.
				</p>

				<div className="mt-4.5">
					<ApiOptions currentMode={mode} showModelOptions={false} />
					<VSCodeButton className="mt-0.75" disabled={disableLetsGoButton || isLoading} onClick={handleSubmit}>
						{isLoading ? "Saving..." : "Start using Bytos"}
					</VSCodeButton>
					{apiErrorMessage && <p className="text-(--vscode-errorForeground) text-sm mt-2">{apiErrorMessage}</p>}
				</div>
			</div>
		</div>
	)
})

export default WelcomeView
