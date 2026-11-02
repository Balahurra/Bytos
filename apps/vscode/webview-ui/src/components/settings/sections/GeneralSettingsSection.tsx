import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Sparkles } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"
import TerminalSettingsSection from "./TerminalSettingsSection"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				<PreferredLanguageSetting />

				<div className="mb-[5px]">
					<Tooltip>
						<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
							This setting is managed by your organization's remote configuration
						</TooltipContent>
						<TooltipTrigger asChild>
							<div className="flex items-center gap-2 mb-[5px]">
								<VSCodeCheckbox
									checked={telemetrySetting !== "disabled"}
									disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
									}}>
									Allow error and usage reporting
								</VSCodeCheckbox>
								{!!remoteConfigSettings?.telemetrySetting && (
									<i className="codicon codicon-lock text-description text-sm" />
								)}
							</div>
						</TooltipTrigger>
					</Tooltip>

					<p className="text-sm mt-[5px] text-description">
						Help improve Bytos by sending usage data and error reports. Reports don't include your code or prompts.
						See our{" "}
						<VSCodeLink
							className="text-inherit"
							href="https://docs.bytos.dev/more-info/telemetry"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							telemetry overview
						</VSCodeLink>{" "}
						and{" "}
						<VSCodeLink
							className="text-inherit"
							href="https://bytos.dev/privacy"
							style={{ fontSize: "inherit", textDecoration: "underline" }}>
							privacy policy
						</VSCodeLink>{" "}
						for more details.
					</p>
				</div>
			</Section>

			{/* Terminal settings live inside General; there is no separate Terminal tab. */}
			<TerminalSettingsSection renderSectionHeader={() => null} />

			{/* Auto Phase Plan settings are intentionally empty for now. */}
			<Section>
				<div className="flex items-center gap-2" id="auto-phase-plan-section">
					<span
						className="flex items-center justify-center w-5 h-5 rounded-[3px]"
						style={{
							backgroundColor: "color-mix(in srgb, var(--vscode-textLink-foreground) 12%, transparent)",
						}}>
						<Sparkles className="w-3.5 h-3.5 text-[var(--vscode-textLink-foreground)]" />
					</span>
					<h3 className="m-0 text-base font-semibold">Auto Phase Plan</h3>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection
