import type { Mode } from "@shared/storage/types"
import { Sparkles, XIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { BYTOS_PASS_PROVIDER_ID, useBytosPassPromo } from "@/hooks/useBytosPassPromo"
import { StateServiceClient } from "@/services/grpc-client"
import { isBannerDismissedForSession, markBannerDismissedForSession } from "@/utils/sessionBannerDismissals"
import { useApiConfigurationHandlers } from "./utils/useApiConfigurationHandlers"

const BYTOS_PASS_SETTINGS_HINT_ID = "bytos-pass-settings-hint-v1"

interface BytosPassHintProps {
	selectedProvider: string
	currentMode: Mode
}

/**
 * Compact, dismissible callout under the API provider dropdown that lets users
 * of any provider discover BytosPass. Selecting it swaps the provider in place
 * so its settings render right below.
 */
export const BytosPassHint = ({ selectedProvider, currentMode }: BytosPassHintProps) => {
	// Covers self-hosted mode and org-managed provider allowlists.
	const { isBytosPassEnabled } = useBytosPassPromo()
	const { dismissedBanners } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	// Seeded from the session-scoped record so the dismissal survives unmounts.
	const [locallyDismissed, setLocallyDismissed] = useState(() => isBannerDismissedForSession(BYTOS_PASS_SETTINGS_HINT_ID))

	const isDismissed =
		locallyDismissed || (dismissedBanners ?? []).some((dismissed) => dismissed.bannerId === BYTOS_PASS_SETTINGS_HINT_ID)

	if (!isBytosPassEnabled || selectedProvider === BYTOS_PASS_PROVIDER_ID || isDismissed) {
		return null
	}

	const handleDismiss = () => {
		markBannerDismissedForSession(BYTOS_PASS_SETTINGS_HINT_ID)
		setLocallyDismissed(true)
		StateServiceClient.dismissBanner({ value: BYTOS_PASS_SETTINGS_HINT_ID }).catch(console.error)
	}

	// Mirror the provider dropdown: only touch the current mode's provider when
	// plan/act use separate models, otherwise update both.
	const handleTryIt = () => {
		handleModeFieldChange(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			BYTOS_PASS_PROVIDER_ID,
			currentMode,
		).catch((error) => console.error("Failed to switch to BytosPass provider:", error))
	}

	return (
		<div
			className="flex items-start gap-2 rounded-sm bg-[var(--vscode-textBlockQuote-background)] px-2.5 py-2 mt-1"
			data-testid="bytos-pass-settings-hint">
			<Sparkles className="size-3.5 shrink-0 mt-0.5 text-[var(--vscode-charts-yellow)]" />
			<div className="grow text-xs text-description">
				<span className="font-semibold text-foreground">BytosPass</span> — a low-cost subscription for the latest
				open-weights models.{" "}
				<button
					className="cursor-pointer border-0 bg-transparent p-0 text-xs text-[var(--vscode-textLink-foreground)] underline hover:text-[var(--vscode-textLink-activeForeground,var(--vscode-textLink-foreground))]"
					onClick={handleTryIt}
					type="button">
					Try it
				</button>
			</div>
			<Button
				aria-label="Dismiss BytosPass hint"
				className="shrink-0 -mt-0.5 -mr-1"
				onClick={handleDismiss}
				size="icon"
				variant="icon">
				<XIcon className="size-3.5" />
			</Button>
		</div>
	)
}
