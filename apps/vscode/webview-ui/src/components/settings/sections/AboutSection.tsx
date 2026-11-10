import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import Section from "../Section"

interface AboutSectionProps {
	version: string
	extensionVariant?: "legacy" | "next"
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const VARIANT_LABELS: Record<"legacy" | "next", string> = {
	legacy: "Legacy",
	next: "Next",
}

const AboutSection = ({ version, extensionVariant, renderSectionHeader }: AboutSectionProps) => {
	return (
		<div>
			{renderSectionHeader("about")}
			<Section>
				<div className="flex px-4 flex-col gap-2">
					<h2 className="text-lg font-semibold">
						Bytos v{version}
						{extensionVariant && (
							<span className="ml-2 text-sm font-normal text-description">
								({VARIANT_LABELS[extensionVariant]})
							</span>
						)}
					</h2>
					<p>
						An AI assistant that can use your CLI and Editor. Bytos can handle complex software development tasks
						step-by-step with tools that let him create & edit files, explore large projects, use the browser, and
						execute terminal commands (after you grant permission).
					</p>

					<h3 className="text-md font-semibold">Community & Support</h3>
					<p>
						<VSCodeLink href="https://discord.gg/2hSFZY9Bs">Discord</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/Balahurra/Bytos">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/Balahurra/Bytos/issues">Report an Issue</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://bytos.dev/">Website</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://marketplace.visualstudio.com/items?itemName=Bytos.bytos">
							VS Code Marketplace
						</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/Balahurra/Bytos/tree/main/docs">Documentation</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
