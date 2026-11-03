import { EmptyRequest } from "@shared/proto/bytos/common"
import { AutoPhasePlan, AutoPhasePlanPhase } from "@shared/proto/bytos/state"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * Shown in Customize → MCP while an Auto Phase phase is the selection target.
 * Selected servers are written to that phase's allowlist only; global MCP
 * enable/disable state is never changed here.
 */
const AutoPhaseMcpSelection = () => {
	const { autoPhaseMcpTarget, setAutoPhaseMcpTarget, navigateToSettings, mcpServers } = useExtensionState()
	const [plan, setPlan] = useState<AutoPhasePlan | undefined>(undefined)
	const [selected, setSelected] = useState<string[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [status, setStatus] = useState<string | undefined>(undefined)

	const phaseId = autoPhaseMcpTarget?.phaseId
	const phaseNumber = autoPhaseMcpTarget?.phaseNumber

	useEffect(() => {
		if (!phaseId) {
			setPlan(undefined)
			setSelected([])
			setLoading(false)
			setStatus(undefined)
			return
		}
		let cancelled = false
		setLoading(true)
		setStatus(undefined)
		StateServiceClient.getAutoPhasePlan(EmptyRequest.create({}))
			.then((loaded) => {
				if (cancelled) {
					return
				}
				const phase = loaded.phases.find((entry) => entry.id === phaseId)
				if (!phase) {
					setStatus("This phase is no longer in the saved plan. Save the plan again from Auto Phase Plan.")
					return
				}
				setPlan(loaded)
				setSelected(
					phase.mcpServersExplicit
						? phase.mcpServers
						: mcpServers.filter((server) => !server.disabled).map((server) => server.name),
				)
			})
			.catch((error) => {
				if (!cancelled) {
					setStatus(error instanceof Error ? error.message : "Could not load the Auto Phase Plan.")
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false)
				}
			})
		return () => {
			cancelled = true
		}
	}, [mcpServers, phaseId])

	const persistSelection = useCallback(
		async (next: string[]) => {
			if (!plan || !phaseId) {
				return
			}
			const previous = selected
			setSelected(next)
			setSaving(true)
			setStatus(undefined)
			try {
				const updated = AutoPhasePlan.create({
					phases: plan.phases.map((phase) =>
						phase.id === phaseId
							? AutoPhasePlanPhase.create({
									...phase,
									mcpServers: next,
									mcpServersExplicit: true,
								})
							: phase,
					),
				})
				await StateServiceClient.saveAutoPhasePlan(updated)
				setPlan(updated)
				setStatus(`Saved for Phase ${phaseNumber ?? ""}. Other phases are unchanged.`)
			} catch (error) {
				setSelected(previous)
				setStatus(error instanceof Error ? error.message : "Could not save the phase MCP selection.")
			} finally {
				setSaving(false)
			}
		},
		[phaseId, phaseNumber, plan, selected],
	)

	const backToPlan = () => {
		setAutoPhaseMcpTarget(undefined)
		navigateToSettings("auto-phase-plan")
	}

	if (!autoPhaseMcpTarget) {
		return null
	}

	const enabledServers = mcpServers.filter((server) => !server.disabled)
	const toggle = (name: string) => {
		if (!plan || saving) {
			return
		}
		const next = selected.includes(name) ? selected.filter((entry) => entry !== name) : [...selected, name]
		void persistSelection(next)
	}

	return (
		<section
			className="marketplace-section"
			style={{
				border: "1px solid var(--vscode-focusBorder)",
				borderRadius: 4,
				padding: 12,
				marginBottom: 12,
			}}>
			<div className="marketplace-section-header">
				<h3 className="marketplace-section-title">MCP for Auto Phase — Phase {phaseNumber}</h3>
			</div>
			<p className="text-xs text-description" style={{ marginTop: 0 }}>
				Selected servers apply only to this phase. Other phases keep their own selection; a phase with no selection has no
				MCP tools.
			</p>

			{loading ? (
				<div className="text-xs text-description">Loading phase selection…</div>
			) : mcpServers.length === 0 ? (
				<div className="text-xs text-description">
					No MCP servers installed. Add one below, then select it for this phase.
				</div>
			) : (
				<div className="flex flex-col gap-1">
					{mcpServers.map((server) => (
						<label className="flex items-center gap-2 text-xs" key={server.name}>
							<input
								checked={selected.includes(server.name)}
								disabled={server.disabled || saving}
								onChange={() => toggle(server.name)}
								type="checkbox"
							/>
							<span className={server.disabled ? "text-description" : ""}>
								{server.name}
								{server.disabled ? " (disabled)" : ""}
							</span>
						</label>
					))}
				</div>
			)}

			<div className="flex items-center gap-3 mt-3">
				<VSCodeButton
					appearance="secondary"
					disabled={loading || saving || selected.length === enabledServers.length}
					onClick={() => void persistSelection(enabledServers.map((server) => server.name))}>
					Select all enabled
				</VSCodeButton>
				<VSCodeButton
					appearance="secondary"
					disabled={loading || saving || selected.length === 0}
					onClick={() => void persistSelection([])}>
					Clear
				</VSCodeButton>
				<VSCodeButton appearance="primary" onClick={backToPlan}>
					Back to Auto Phase Plan
				</VSCodeButton>
			</div>
			{status && (
				<div className="text-xs text-description mt-2" role="status">
					{status}
				</div>
			)}
		</section>
	)
}

export default AutoPhaseMcpSelection
