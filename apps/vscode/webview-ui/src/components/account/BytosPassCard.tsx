import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import { Sparkles } from "lucide-react"
import { useBytosPassPromo } from "@/hooks/useBytosPassPromo"
import VSCodeButtonLink from "../common/VSCodeButtonLink"

/**
 * BytosPass section for the signed-in account view. Promotes the subscription
 * to users who aren't on the BytosPass provider, and links to subscription
 * management for those who are.
 */
export const BytosPassCard = () => {
	const { isBytosPassEnabled, isUsingBytosPass, subscribeUrl, manageSubscriptionUrl, switchToBytosPassProvider } =
		useBytosPassPromo()

	if (!isBytosPassEnabled) {
		return null
	}

	return (
		<div className="flex flex-col gap-2" data-testid="bytos-pass-card">
			<VSCodeDivider className="w-full mt-6 mb-3" />
			<div className="flex items-center gap-2">
				<Sparkles className="size-4 shrink-0 text-[var(--vscode-charts-yellow)]" />
				<span className="text-base font-semibold">BytosPass</span>
			</div>

			{isUsingBytosPass ? (
				<>
					<p className="m-0 text-sm text-description">
						You're using the BytosPass provider. Manage your subscription and view usage from your dashboard.
					</p>
					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink appearance="secondary" className="w-full" href={manageSubscriptionUrl}>
								Manage Subscription
							</VSCodeButtonLink>
						</div>
					</div>
				</>
			) : (
				<>
					<p className="m-0 text-sm text-description">
						A monthly subscription for the latest open-weights models, at much lower cost than paying for direct API
						access.
					</p>
					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<div className="w-full min-[225px]:w-1/2">
							<VSCodeButtonLink appearance="primary" className="w-full" href={subscribeUrl}>
								Get BytosPass
							</VSCodeButtonLink>
						</div>
						<VSCodeButton
							appearance="secondary"
							className="w-full min-[225px]:w-1/2"
							onClick={() => void switchToBytosPassProvider()}>
							Use BytosPass Provider
						</VSCodeButton>
					</div>
				</>
			)}
		</div>
	)
}

/**
 * Compact BytosPass callout for the signed-out account welcome view.
 */
export const BytosPassWelcomeCallout = () => {
	const { isBytosPassEnabled } = useBytosPassPromo()

	if (!isBytosPassEnabled) {
		return null
	}

	return (
		<div
			className="w-full flex items-start gap-2 rounded-sm bg-[var(--vscode-textBlockQuote-background)] p-3 mb-2"
			data-testid="bytos-pass-welcome-callout">
			<Sparkles className="size-4 shrink-0 mt-0.5 text-[var(--vscode-charts-yellow)]" />
			<p className="m-0 text-xs text-description">
				<span className="font-semibold text-foreground">BytosPass</span> — a low-cost monthly subscription for the latest
				open-weights models, much cheaper than direct API access. Sign up to subscribe from your dashboard.
			</p>
		</div>
	)
}
