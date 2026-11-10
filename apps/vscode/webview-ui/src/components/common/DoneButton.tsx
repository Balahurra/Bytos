import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type { ComponentProps, CSSProperties } from "react"

// Keep the toolkit button's own colors, but two shades darker for Done actions.
const doneButtonStyle = {
	"--vscode-button-background": "var(--color-done-button-background)",
	"--vscode-button-hoverBackground": "var(--color-done-button-hover)",
} as CSSProperties

type DoneButtonProps = ComponentProps<typeof VSCodeButton>

/**
 * Primary VSCode toolkit button used for "Done" actions, with the darkened
 * Done palette applied through the toolkit's theme variables.
 */
const DoneButton = ({ style, ...props }: DoneButtonProps) => <VSCodeButton {...props} style={{ ...doneButtonStyle, ...style }} />

export default DoneButton
