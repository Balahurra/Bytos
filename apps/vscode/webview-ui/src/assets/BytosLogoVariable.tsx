import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * BytosLogoVariable renders the Bytos mark with automatic theme adaptation and
 * environment-based color indicators.
 *
 * - Local: yellow/orange (development/experimental)
 * - Staging: blue (stable testing)
 * - Production: theme foreground (default)
 */
const BytosLogoVariable = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg fill="none" height="50" role="img" viewBox="148 104 262 320" width="50" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<title>Bytos</title>
			<g fill="none" stroke={fillColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth={56}>
				<path d="M176 132 V396" />
				<path d="M176 156 H282 C332 156 362 184 362 216 C362 248 332 276 282 276 H176" />
				<path d="M176 276 H300 C352 276 382 306 382 342 C382 378 352 396 300 396 H176" />
			</g>
		</svg>
	)
}
export default BytosLogoVariable
