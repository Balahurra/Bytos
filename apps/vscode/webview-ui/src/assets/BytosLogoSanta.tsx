import { SVGProps } from "react"
import type { Environment } from "../../../src/shared/config-types"
import { getEnvironmentColor } from "../utils/environmentColors"

/**
 * BytosLogoSanta renders the Bytos mark with a festive Santa hat while keeping
 * the same theme and environment color system as BytosLogoVariable.
 */
const BytosLogoSanta = (props: SVGProps<SVGSVGElement> & { environment?: Environment }) => {
	const { environment, ...svgProps } = props
	const fillColor = environment ? getEnvironmentColor(environment) : "var(--vscode-icon-foreground)"

	return (
		<svg height="50" role="img" viewBox="0 0 140 150" width="47" xmlns="http://www.w3.org/2000/svg" {...svgProps}>
			<title>Bytos wearing a Santa hat</title>
			<g transform="translate(20 45) scale(0.28)" fill="none" stroke={fillColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth={56}>
				<path d="M176 132 V396" />
				<path d="M176 156 H282 C332 156 362 184 362 216 C362 248 332 276 282 276 H176" />
				<path d="M176 276 H300 C352 276 382 306 382 342 C382 378 352 396 300 396 H176" />
			</g>
			<path d="M42 48 C44 18 78 4 100 18 C108 24 112 32 112 40 L104 48 Z" fill="#E5484D" />
			<rect fill="#FFFFFF" height="12" rx="6" width="70" x="38" y="44" />
			<circle cx="112" cy="18" fill="#FFFFFF" r="8" />
		</svg>
	)
}
export default BytosLogoSanta
