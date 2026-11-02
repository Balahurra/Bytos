import { EmptyRequest } from "@shared/proto/bytos/common"
import { AutoPhasePlan, AutoPhasePlanPhase } from "@shared/proto/bytos/state"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { Check, ChevronDown, ChevronRight, Copy, Eraser, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"
import { useProviderListings } from "@/hooks/useProviderListings"
import { useProviderModels } from "@/hooks/useProviderModels"
import { StateServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { CLINE_PASS_DEFAULT_MODEL_ID, CLINE_PASS_MODELS, clinePassFallbackModelInfo } from "../providers/clinePassModels"
import Section from "../Section"
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "../utils/apiKeyMasking"

const MAX_PHASES = 10
const CLINE_PASS_PROVIDER_ID = "bytos-pass"

interface AutoPhasePlanSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

interface PhaseDraft {
	id: string
	prompt: string
	provider: string
	modelId: string
	apiKey: string
	apiKeyTouched: boolean
	apiKeyLength: number
	expanded: boolean
}

interface StatusMessage {
	kind: "info" | "error"
	text: string
}

function createDraft(phase: AutoPhasePlanPhase, expanded = false): PhaseDraft {
	return {
		id: phase.id || `auto-phase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
		prompt: phase.prompt ?? "",
		provider: phase.provider ?? "",
		modelId: phase.modelId ?? "",
		apiKey: "",
		apiKeyTouched: false,
		apiKeyLength: phase.apiKeyLength ?? 0,
		expanded,
	}
}

function displayProviderName(id: string, name: string): string {
	return id === CLINE_PASS_PROVIDER_ID ? "ClinePass" : name
}

function toPlan(phases: PhaseDraft[]): AutoPhasePlan {
	return AutoPhasePlan.create({
		phases: phases.slice(0, MAX_PHASES).map((phase) =>
			AutoPhasePlanPhase.create({
				id: phase.id,
				prompt: phase.prompt,
				provider: phase.provider,
				modelId: phase.modelId,
				apiKey: phase.apiKeyTouched ? phase.apiKey : undefined,
				apiKeyLength: phase.apiKeyLength,
			}),
		),
	})
}

const PhaseModelSettings = ({ phase, onChange }: { phase: PhaseDraft; onChange: (patch: Partial<PhaseDraft>) => void }) => {
	const isClinePass = phase.provider === CLINE_PASS_PROVIDER_ID
	const { models, defaultModelId, isLoading, error } = useProviderModels(phase.provider as ProviderId)

	const modelEntries = useMemo(() => {
		if (isClinePass) {
			return Object.entries(CLINE_PASS_MODELS)
				.map(([id, info]) => ({ id, info }))
				.sort((a, b) => a.id.localeCompare(b.id))
		}
		return Object.entries(models ?? {})
			.map(([id, info]) => ({ id, info }))
			.sort((a, b) => a.id.localeCompare(b.id))
	}, [models, isClinePass])

	const defaultId = isClinePass ? CLINE_PASS_DEFAULT_MODEL_ID : defaultModelId
	const selectedModelId = phase.modelId || defaultId || modelEntries[0]?.id || ""
	const selectedModelInfo =
		modelEntries.find((entry) => entry.id === selectedModelId)?.info ??
		(isClinePass && selectedModelId ? clinePassFallbackModelInfo(selectedModelId) : undefined)

	useEffect(() => {
		if (!phase.modelId && selectedModelId) {
			onChange({ modelId: selectedModelId })
		}
	}, [phase.modelId, selectedModelId, onChange])

	return (
		<div className="flex flex-col gap-2 mt-3">
			<label className="font-medium" htmlFor={`auto-phase-model-${phase.id}`}>
				Model
			</label>
			<VSCodeDropdown
				className="w-full"
				id={`auto-phase-model-${phase.id}`}
				onChange={(event) => onChange({ modelId: (event.target as HTMLSelectElement).value })}
				value={selectedModelId}>
				{modelEntries.length === 0 && selectedModelId && (
					<VSCodeOption value={selectedModelId}>{selectedModelId}</VSCodeOption>
				)}
				{modelEntries.map((entry) => (
					<VSCodeOption className="break-words whitespace-normal max-w-full" key={entry.id} value={entry.id}>
						{entry.info.name || entry.id}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
			{isLoading && <span className="text-xs text-description">Loading models…</span>}
			{error && <span className="text-xs text-[var(--vscode-errorForeground)]">{error}</span>}
			{selectedModelInfo && <ModelInfoView isPopup modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />}
		</div>
	)
}

const AutoPhasePlanSection = ({ renderSectionHeader }: AutoPhasePlanSectionProps) => {
	const [phaseList, setPhaseList] = useState<PhaseDraft[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [status, setStatus] = useState<StatusMessage | null>(null)
	const { providers } = useProviderListings()

	const providerOptions = useMemo(() => {
		const options = (providers ?? [])
			.filter((provider) => provider.id !== "bytos")
			.map((provider) => ({
				value: provider.id,
				label: displayProviderName(provider.id, provider.name),
			}))
		if (!options.some((option) => option.value === "anthropic")) {
			options.unshift({ value: "anthropic", label: "Anthropic" })
		}
		return options
	}, [providers])

	const defaultProvider = providerOptions[0]?.value ?? "anthropic"

	const providerLabel = useCallback(
		(id: string) => providerOptions.find((option) => option.value === id)?.label ?? id,
		[providerOptions],
	)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		StateServiceClient.getAutoPhasePlan(EmptyRequest.create({}))
			.then((plan) => {
				if (cancelled) {
					return
				}
				setPhaseList((plan.phases ?? []).map((phase, index) => createDraft(phase, index === 0)))
			})
			.catch((error) => {
				if (!cancelled) {
					setStatus({ kind: "error", text: `Could not load Auto Phase Plan: ${error.message}` })
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
	}, [])

	const updatePhase = useCallback((id: string, patch: Partial<PhaseDraft>) => {
		setPhaseList((current) => current.map((phase) => (phase.id === id ? { ...phase, ...patch } : phase)))
	}, [])

	const addPhase = useCallback(() => {
		setPhaseList((current) => {
			if (current.length >= MAX_PHASES) {
				return current
			}
			return [
				...current,
				{
					id: `auto-phase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
					prompt: "",
					provider: defaultProvider,
					modelId: "",
					apiKey: "",
					apiKeyTouched: false,
					apiKeyLength: 0,
					expanded: true,
				},
			]
		})
	}, [defaultProvider])

	const deletePhase = useCallback((id: string) => {
		setPhaseList((current) => current.filter((phase) => phase.id !== id))
		setStatus({ kind: "info", text: "Phase removed. Press Done to save the plan." })
	}, [])

	const copyPrompt = useCallback((prompt: string) => {
		void navigator.clipboard.writeText(prompt).then(
			() => setStatus({ kind: "info", text: "Prompt copied." }),
			() => setStatus({ kind: "error", text: "Could not copy the prompt." }),
		)
	}, [])

	const persistPlan = useCallback(
		async (message = "Auto Phase Plan saved.") => {
			setSaving(true)
			setStatus(null)
			try {
				await StateServiceClient.saveAutoPhasePlan(toPlan(phaseList))
				setPhaseList((current) =>
					current.map((phase) => ({
						...phase,
						apiKey: "",
						apiKeyTouched: false,
						apiKeyLength: phase.apiKeyTouched ? phase.apiKey.length : phase.apiKeyLength,
					})),
				)
				setStatus({ kind: "info", text: message })
			} catch (error) {
				setStatus({
					kind: "error",
					text: error instanceof Error ? error.message : "Could not save Auto Phase Plan.",
				})
			} finally {
				setSaving(false)
			}
		},
		[phaseList],
	)

	const savePrompt = useCallback(
		(phaseNumber: number) => {
			void persistPlan(`Phase ${phaseNumber} prompt saved.`)
		},
		[persistPlan],
	)

	return (
		<div id="auto-phase-plan-page">
			{renderSectionHeader("auto-phase-plan")}
			<Section>
				<p className="text-sm text-description m-0">
					Define up to {MAX_PHASES} phases. Each phase runs as its own Act-mode task, in order, with its own provider,
					API key, and model.
				</p>

				{loading ? (
					<div className="text-sm text-description py-4">Loading Auto Phase Plan…</div>
				) : (
					<div className="flex flex-col gap-3">
						{phaseList.length === 0 && (
							<div className="text-sm text-description py-4">No phases yet. Add your first phase below.</div>
						)}

						{phaseList.map((phase, index) => {
							const provider = phase.provider || defaultProvider
							return (
								<div className="rounded-sm border border-[var(--vscode-panel-border)] p-3" key={phase.id}>
									<div className="flex items-center gap-2">
										<VSCodeButton
											appearance="icon"
											aria-label={phase.expanded ? "Collapse phase" : "Expand phase"}
											onClick={() => updatePhase(phase.id, { expanded: !phase.expanded })}
											title={phase.expanded ? "Collapse phase" : "Expand phase"}>
											{phase.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
										</VSCodeButton>
										<span className="font-medium">Phase {index + 1}</span>
										<span className="text-xs text-description truncate">
											{providerLabel(provider)}
											{phase.modelId ? ` · ${phase.modelId}` : ""}
										</span>
										<div className="ml-auto flex items-center gap-1">
											<VSCodeButton
												appearance="icon"
												aria-label="Copy prompt"
												onClick={() => copyPrompt(phase.prompt)}
												title="Copy prompt">
												<Copy size={14} />
											</VSCodeButton>
											<VSCodeButton
												appearance="icon"
												aria-label="Clear prompt"
												disabled={saving || phase.prompt.length === 0}
												onClick={() => updatePhase(phase.id, { prompt: "" })}
												title="Clear prompt">
												<Eraser size={14} />
											</VSCodeButton>
											<VSCodeButton
												appearance="icon"
												aria-label="Save prompt"
												disabled={saving}
												onClick={() => savePrompt(index + 1)}
												title="Save prompt">
												<Check size={14} />
											</VSCodeButton>
											<VSCodeButton
												appearance="icon"
												aria-label="Delete phase"
												onClick={() => deletePhase(phase.id)}
												title="Delete phase">
												<Trash2 size={14} />
											</VSCodeButton>
										</div>
									</div>

									{phase.expanded && (
										<div className="flex flex-col gap-3 mt-2">
											<div className="flex flex-col gap-1">
												<label className="font-medium" htmlFor={`auto-phase-prompt-${phase.id}`}>
													Prompt
												</label>
												<textarea
													className="w-full min-h-[90px] resize-y box-border rounded-sm border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] p-2 text-sm"
													id={`auto-phase-prompt-${phase.id}`}
													onChange={(event) => updatePhase(phase.id, { prompt: event.target.value })}
													placeholder="Describe what this phase should do…"
													value={phase.prompt}
												/>
											</div>

											<div className="flex flex-col gap-2">
												<label className="font-medium" htmlFor={`auto-phase-provider-${phase.id}`}>
													Provider
												</label>
												<VSCodeDropdown
													className="w-full"
													id={`auto-phase-provider-${phase.id}`}
													onChange={(event) => {
														const nextProvider = (event.target as HTMLSelectElement).value
														updatePhase(phase.id, {
															provider: nextProvider,
															modelId: "",
															apiKey: "",
															apiKeyTouched: true,
															apiKeyLength: 0,
														})
													}}
													value={provider}>
													{!providerOptions.some((option) => option.value === provider) && (
														<VSCodeOption value={provider}>{provider}</VSCodeOption>
													)}
													{providerOptions.map((option) => (
														<VSCodeOption key={option.value} value={option.value}>
															{option.label}
														</VSCodeOption>
													))}
												</VSCodeDropdown>
											</div>

											<ApiKeyField
												helpText="Stored in VS Code SecretStorage and used only for this phase."
												initialValue={getSavedApiKeyMask(phase.apiKeyLength)}
												onChange={(value) => {
													const sanitized = sanitizeMaskedApiKeyInput(
														value,
														getSavedApiKeyMask(phase.apiKeyLength),
													)
													if (sanitized === undefined) {
														return
													}
													updatePhase(phase.id, {
														apiKey: sanitized,
														apiKeyTouched: true,
														apiKeyLength: sanitized.length,
													})
												}}
												providerName={providerLabel(provider)}
											/>

											<PhaseModelSettings
												onChange={(patch) => updatePhase(phase.id, patch)}
												phase={{ ...phase, provider }}
											/>
										</div>
									)}
								</div>
							)
						})}

						<div className="flex items-center justify-between gap-3 mt-2">
							<span className="text-xs text-description">
								{phaseList.length} / {MAX_PHASES} phases
							</span>
							<VSCodeButton
								appearance="secondary"
								disabled={saving || phaseList.length >= MAX_PHASES}
								onClick={addPhase}>
								<Plus className="mr-1" size={14} />
								Add Phase
							</VSCodeButton>
						</div>

						<div className="flex items-center justify-end gap-3 mt-2">
							{status && (
								<span
									className="text-xs"
									role={status.kind === "error" ? "alert" : "status"}
									style={{
										color:
											status.kind === "error"
												? "var(--vscode-errorForeground)"
												: "var(--vscode-descriptionForeground)",
									}}>
									{status.text}
								</span>
							)}
							<VSCodeButton appearance="primary" disabled={saving || loading} onClick={() => persistPlan()}>
								{saving ? "Saving…" : "Done"}
							</VSCodeButton>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}

export default AutoPhasePlanSection
