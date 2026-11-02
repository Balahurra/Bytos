import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useBytosAuth } from "@/context/BytosAuthContext"

const ORG_BYTOS_PASS_RESTRICTION_MESSAGE = "Organization accounts cannot use BytosPass subscriptions."

const OrgBytosPassRestrictionError = () => {
	const { accountSwitch, switchOrganization } = useBytosAuth()
	const isSwitching = !!accountSwitch
	const [didSwitch, setDidSwitch] = useState(false)
	const [error, setError] = useState<string | undefined>()

	const handleSwitchToPersonalAccount = async () => {
		setError(undefined)
		try {
			if (!(await switchOrganization())) throw new Error("Account switch not confirmed")
			setDidSwitch(true)
		} catch (error) {
			console.error("Failed to switch to personal Bytos account:", error)
			setError("Failed to switch account. Use /accounts to switch to your personal account.")
		}
	}

	return (
		<div
			className="p-2 border-none rounded-md mb-2 bg-(--vscode-textBlockQuote-background)"
			data-testid="org-bytos-pass-restriction-error">
			<div className="text-error mb-2">Organization account cannot use BytosPass</div>
			<div className="text-(--vscode-descriptionForeground) text-xs wrap-anywhere">
				{ORG_BYTOS_PASS_RESTRICTION_MESSAGE}
			</div>
			<VSCodeButton className="w-full mt-3" disabled={isSwitching || didSwitch} onClick={handleSwitchToPersonalAccount}>
				{isSwitching ? "Switching..." : didSwitch ? "Switched to personal account" : "Switch to personal account"}
			</VSCodeButton>
			{didSwitch && (
				<div className="text-(--vscode-descriptionForeground) text-xs mt-2">Retry the request after switching.</div>
			)}
			{error && <div className="text-error text-xs mt-2">{error}</div>}
		</div>
	)
}

export { ORG_BYTOS_PASS_RESTRICTION_MESSAGE }
export default OrgBytosPassRestrictionError
