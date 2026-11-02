import React from "react"
import styled from "styled-components"

interface FeaturedModelCardProps {
	displayName: string
	description: string
	onClick: () => void
	isSelected: boolean
	label: string
}

const CardContainer = styled.div<{ isSelected: boolean }>`
	padding: 9px 11px;
	margin-bottom: 5px;
	border-radius: var(--bytos-radius-sm);
	border: 1px solid
		${(props) => (props.isSelected ? "color-mix(in oklab, var(--bytos-cyan) 48%, transparent)" : "var(--bytos-border)")};
	background: ${(props) =>
		props.isSelected ? "color-mix(in oklab, var(--bytos-canvas) 90%, var(--bytos-cyan) 10%)" : "var(--bytos-panel)"};
	cursor: pointer;
	transition:
		border-color var(--bytos-duration) var(--bytos-ease),
		background var(--bytos-duration) var(--bytos-ease),
		transform var(--bytos-duration) var(--bytos-ease);

	&:hover {
		border-color: var(--bytos-border-accent);
		background: var(--bytos-panel-hover);
		transform: translateY(-1px);
	}
`

const ModelHeader = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
`

const ModelName = styled.div`
	font-family: var(--bytos-font-display);
	font-weight: 600;
	font-size: calc(var(--vscode-font-size, 13px) * 0.98);
	letter-spacing: -0.005em;
	line-height: 1.3;
`

const Label = styled.span`
	font-family: var(--bytos-font-mono);
	font-size: calc(var(--vscode-font-size, 13px) * 0.7);
	color: color-mix(in oklab, var(--bytos-cyan) 76%, var(--bytos-text) 24%);
	text-transform: uppercase;
	letter-spacing: 0.05em;
	font-weight: 500;
	white-space: nowrap;
`

const Description = styled.div`
	margin-top: 3px;
	font-family: var(--bytos-font-ui);
	font-size: calc(var(--vscode-font-size, 13px) * 0.84);
	color: var(--bytos-muted);
	line-height: 1.45;
`

const FeaturedModelCard: React.FC<FeaturedModelCardProps> = ({ displayName, description, onClick, isSelected, label }) => {
	return (
		<CardContainer className="bytos-model-card" data-selected={isSelected} isSelected={isSelected} onClick={onClick}>
			<ModelHeader>
				<ModelName>{displayName}</ModelName>
				<Label>{label}</Label>
			</ModelHeader>
			<Description>{description}</Description>
		</CardContainer>
	)
}

export default FeaturedModelCard
