import { AskResponseRequest } from "@shared/proto/bytos/task"
import { useState } from "react"
import styled from "styled-components"
import { TaskServiceClient } from "@/services/grpc-client"

const OptionButton = styled.button<{ $isSelected?: boolean; $isNotSelectable?: boolean }>`
	padding: 9px 12px;
	background: ${(props) =>
		props.$isSelected ? "linear-gradient(90deg, var(--bytos-blue), var(--bytos-cyan))" : "var(--bytos-panel)"};
	color: ${(props) => (props.$isSelected ? "#ffffff" : "var(--bytos-text)")};
	border: 1px solid
		${(props) => (props.$isSelected ? "transparent" : "var(--bytos-border)")};
	border-radius: var(--bytos-radius-sm);
	cursor: ${(props) => (props.$isNotSelectable ? "default" : "pointer")};
	text-align: left;
	font-family: var(--bytos-font-ui);
	font-size: calc(var(--vscode-font-size, 13px) * 0.92);
	font-weight: 560;
	line-height: 1.35;
	transition:
		border-color var(--bytos-duration) var(--bytos-ease),
		background var(--bytos-duration) var(--bytos-ease),
		transform var(--bytos-duration) var(--bytos-ease);

	${(props) =>
		!props.$isNotSelectable &&
		`
		&:hover {
			background: var(--bytos-panel-hover);
			border-color: var(--bytos-border-accent);
			color: var(--bytos-text);
			transform: translateY(-1px);
		}
	`}
`

export const OptionsButtons = ({
	options,
	selected,
	isActive,
	inputValue,
}: {
	options?: string[]
	selected?: string
	isActive?: boolean
	inputValue?: string
}) => {
	const optionItems = options ?? []
	const optionsKey = optionItems.join("\u0000")
	const optimisticSelectionKey = `${selected ?? ""}\u0001${optionsKey}`
	const [optimisticSelection, setOptimisticSelection] = useState<{ key: string; option: string }>()

	if (!optionItems.length) {
		return null
	}

	const selectedOption =
		selected !== undefined && optionItems.includes(selected)
			? selected
			: optimisticSelection?.key === optimisticSelectionKey
				? optimisticSelection.option
				: undefined
	const hasSelected = selectedOption !== undefined && optionItems.includes(selectedOption)

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "8px",
			}}>
			{/* <div style={{ color: "var(--vscode-descriptionForeground)", fontSize: "11px", textTransform: "uppercase" }}>
				SELECT ONE:
			</div> */}
			{optionItems.map((option, index) => (
				<OptionButton
					$isNotSelectable={hasSelected || !isActive}
					$isSelected={option === selectedOption}
					className="options-button"
					disabled={hasSelected || !isActive}
					id={`options-button-${index}`}
					key={option}
					onClick={async () => {
						if (hasSelected || !isActive) {
							return
						}
						setOptimisticSelection({ key: optimisticSelectionKey, option })
						try {
							await TaskServiceClient.askResponse(
								AskResponseRequest.create({
									responseType: "messageResponse",
									text: option + (inputValue ? `: ${inputValue?.trim()}` : ""),
									images: [],
								}),
							)
						} catch (error) {
							setOptimisticSelection(undefined)
							console.error("Error sending option response:", error)
						}
					}}>
					<span className="ph-no-capture">{option}</span>
				</OptionButton>
			))}
		</div>
	)
}
