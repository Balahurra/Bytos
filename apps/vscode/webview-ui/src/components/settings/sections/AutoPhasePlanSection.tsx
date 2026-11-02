import Section from "../Section"

interface AutoPhasePlanSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

/**
 * Dedicated Auto Phase Plan settings page.
 *
 * Intentionally empty for now: the page is the clean home for the Auto Phase
 * configuration that will be specified separately. Keeping it as its own tab
 * avoids burying those controls at the bottom of General.
 */
const AutoPhasePlanSection = ({ renderSectionHeader }: AutoPhasePlanSectionProps) => {
	return (
		<div id="auto-phase-plan-page">
			{renderSectionHeader("auto-phase-plan")}
			<Section>
				<div className="min-h-[120px]" />
			</Section>
		</div>
	)
}

export default AutoPhasePlanSection
