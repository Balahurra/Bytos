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
						<VSCodeLink href="https://github.com/bytos/bytos">X</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/bytos/bytos/discussions">Discord</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/bytos/bytos/discussions"> Discussions</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Development</h3>
					<p>
						<VSCodeLink href="https://github.com/bytos/bytos">GitHub</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/bytos/bytos/issues"> Issues</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://github.com/bytos/bytos/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop">
							{" "}
							Feature Requests
						</VSCodeLink>
					</p>

					<h3 className="text-md font-semibold">Resources</h3>
					<p>
						<VSCodeLink href="https://docs.bytos.dev/">Documentation</VSCodeLink>
						{" • "}
						<VSCodeLink href="https://bytos.dev/">https://bytos.dev</VSCodeLink>
					</p>
				</div>
			</Section>
		</div>
	)
}

export default AboutSection
