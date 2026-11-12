import { buildChatAttachments } from "@shared/attachments"
import { EmptyRequest } from "@shared/proto/bytos/common"
import { SelectFilesRequest } from "@shared/proto/bytos/file"
import { AutoPhaseErrorPolicy, AutoPhasePlan, AutoPhasePlanPhase } from "@shared/proto/bytos/state"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { Check, ChevronDown, ChevronRight, Copy, Eraser, Plus, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { getDataUrlBase64Length, normalizeImagesForAttachment } from "@/components/chat/attachment-image-normalization"
import DoneButton from "@/components/common/DoneButton"
import Thumbnails from "@/components/common/Thumbnails"
import { type ProviderId, useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderListings } from "@/hooks/useProviderListings"
import { useProviderModels } from "@/hooks/useProviderModels"
import { FileServiceClient, StateServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { CLINE_PASS_DEFAULT_MODEL_ID, CLINE_PASS_MODELS, clinePassFallbackModelInfo } from "../providers/clinePassModels"
import Section from "../Section"
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "../utils/apiKeyMasking"

const MAX_PHASES = 10
const MAX_PHASE_ATTACHMENTS = 20
const CLINE_PASS_PROVIDER_ID = "cline-pass"

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
	images: string[]
	files: string[]
	mcpServers: string[]
	mcpServersExplicit: boolean
}

interface StatusMessage {
	kind: "info" | "error"
	text: string
}

interface PlanSettings {
	onPhaseError: AutoPhaseErrorPolicy
	writeReport: boolean
	aiSummary: boolean
	passPhaseReports: boolean
}

const DEFAULT_PLAN_SETTINGS: PlanSettings = {
	onPhaseError: AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_ASK,
	writeReport: true,
	aiSummary: false,
	passPhaseReports: true,
}

function createDraft(phase: AutoPhasePlanPhase, expanded = false): PhaseDraft {
	const images = (phase.attachments ?? [])
		.filter((attachment) => attachment.kind === "image" && attachment.data)
		.map((attachment) => attachment.data as string)
	const files = (phase.attachments ?? [])
		.filter((attachment) => attachment.kind !== "image" && attachment.path)
		.map((attachment) => attachment.path as string)
	return {
		id: phase.id || `auto-phase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
		prompt: phase.prompt ?? "",
		provider: phase.provider ?? "",
		modelId: phase.modelId ?? "",
		apiKey: "",
		apiKeyTouched: false,
		apiKeyLength: phase.apiKeyLength ?? 0,
		expanded,
		images,
		files,
		mcpServers: phase.mcpServers ?? [],
		mcpServersExplicit: phase.mcpServersExplicit === true,
	}
}

function displayProviderName(id: string, name: string): string {
	return id === CLINE_PASS_PROVIDER_ID ? "ClinePass" : name
}

function toPlan(phases: PhaseDraft[], settings: PlanSettings): AutoPhasePlan {
	return AutoPhasePlan.create({
		phases: phases.slice(0, MAX_PHASES).map((phase) =>
			AutoPhasePlanPhase.create({
				id: phase.id,
				prompt: phase.prompt,
				provider: phase.provider,
				modelId: phase.modelId,
				apiKey: phase.apiKeyTouched ? phase.apiKey : undefined,
				apiKeyLength: phase.apiKeyLength,
				mcpServers: phase.mcpServers,
				mcpServersExplicit: phase.mcpServersExplicit,
				attachments: buildChatAttachments(phase.images, phase.files),
			}),
		),
		onPhaseError: settings.onPhaseError,
		writeReport: settings.writeReport,
		aiSummary: settings.aiSummary,
		passPhaseReports: settings.passPhaseReports,
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
	const [planSettings, setPlanSettings] = useState<PlanSettings>(DEFAULT_PLAN_SETTINGS)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [status, setStatus] = useState<StatusMessage | null>(null)
	const { providers } = useProviderListings()
	const { navigateToMcp, setAutoPhaseMcpTarget } = useExtensionState()

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
				setPlanSettings({
					onPhaseError: plan.onPhaseError ?? AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_ASK,
					writeReport: plan.writeReport !== false,
					aiSummary: plan.aiSummary === true,
					passPhaseReports: plan.passPhaseReports !== false,
				})
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

	const updatePlanSettings = useCallback((patch: Partial<PlanSettings>) => {
		setPlanSettings((current) => ({ ...current, ...patch }))
	}, [])

	const addPhaseAttachments = useCallback(
		async (phaseId: string) => {
			const phase = phaseList.find((entry) => entry.id === phaseId)
			if (!phase) {
				return
			}
			const available = MAX_PHASE_ATTACHMENTS - (phase.images.length + phase.files.length)
			if (available <= 0) {
				setStatus({ kind: "info", text: `This phase already has ${MAX_PHASE_ATTACHMENTS} attachments.` })
				return
			}
			try {
				const response = await FileServiceClient.selectFilesWithOptions(
					SelectFilesRequest.create({ supportsImages: true, imagesOnly: false }),
				)
				const existingImageBytes = phase.images.reduce((sum, image) => sum + getDataUrlBase64Length(image), 0)
				const { images } = await normalizeImagesForAttachment(response.values1.slice(0, available), existingImageBytes)
				const remaining = available - images.length
				const files = response.values2.slice(0, Math.max(0, remaining))
				updatePhase(phaseId, {
					images: [...phase.images, ...images.map((image) => image.dataUrl)].slice(0, MAX_PHASE_ATTACHMENTS),
					files: [...phase.files, ...files].slice(0, MAX_PHASE_ATTACHMENTS),
				})
				setStatus(
					images.length + files.length > 0
						? { kind: "info", text: "Attachments added to this phase. Press Done to save the plan." }
						: null,
				)
			} catch (error) {
				setStatus({
					kind: "error",
					text: error instanceof Error ? error.message : "Could not add phase attachments.",
				})
			}
		},
		[phaseList, updatePhase],
	)

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
					images: [],
					files: [],
					mcpServers: [],
					mcpServersExplicit: true,
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
				await StateServiceClient.saveAutoPhasePlan(toPlan(phaseList, planSettings))
				setPhaseList((current) =>
					current.map((phase) => ({
						...phase,
						apiKey: "",
						apiKeyTouched: false,
						apiKeyLength: phase.apiKeyTouched ? phase.apiKey.length : phase.apiKeyLength,
					})),
				)
				setStatus({ kind: "info", text: message })
				return true
			} catch (error) {
				setStatus({
					kind: "error",
					text: error instanceof Error ? error.message : "Could not save Auto Phase Plan.",
				})
				return false
			} finally {
				setSaving(false)
			}
		},
		[phaseList, planSettings],
	)

	const openPhaseMcpSettings = useCallback(
		async (phaseId: string, phaseNumber: number) => {
			const saved = await persistPlan("Plan saved. Select MCP servers in Customize → MCP.")
			if (!saved) {
				return
			}
			navigateToMcp("configure")
			setAutoPhaseMcpTarget({ phaseId, phaseNumber })
		},
		[navigateToMcp, persistPlan, setAutoPhaseMcpTarget],
	)

	const savePrompt = useCallback(
		(phaseNumber: number) => {
			void persistPlan(`Phase ${phaseNumber} prompt saved.`)
		},
		[persistPlan],
	)

	/** Clear the saved plan (and its stored keys). History and tasks are untouched. */
	const deleteAllPhases = useCallback(async () => {
		setSaving(true)
		setStatus(null)
		try {
			await StateServiceClient.saveAutoPhasePlan(toPlan([], planSettings))
			setPhaseList([])
			setStatus({ kind: "info", text: "All phases deleted. History and tasks were not changed." })
		} catch (error) {
			setStatus({
				kind: "error",
				text: error instanceof Error ? error.message : "Could not delete the Auto Phase Plan.",
			})
		} finally {
			setSaving(false)
		}
	}, [planSettings])

	return (
		<div id="auto-phase-plan-page">
			{renderSectionHeader("auto-phase-plan")}
			<Section>
				<p className="text-sm text-description m-0">
					Define up to {MAX_PHASES} phases. Each phase runs as its own Act-mode task, in order, with its own provider,
					API key, and model. Approval prompts use the global Auto-approve settings from the chat panel; there are no
					per-phase approval settings.
				</p>

				{loading ? (
					<div className="text-sm text-description py-4">Loading Auto Phase Planner…</div>
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
										<span
											className={`font-medium ${
												phase.expanded ? "text-[var(--vscode-charts-yellow)]" : ""
											}`}>
											Phase {index + 1}
										</span>
										<span className="text-xs text-description truncate">
											{providerLabel(provider)}
											{phase.modelId ? ` · ${phase.modelId}` : ""}
										</span>
										<div className="ml-auto flex items-center gap-1">
											<VSCodeButton
												appearance="icon"
												aria-label="Add attachment"
												onClick={() => void addPhaseAttachments(phase.id)}
												title="Add attachment">
												<Plus size={14} />
											</VSCodeButton>
											<VSCodeButton
												appearance="icon"
												aria-label="Select MCP servers for this phase"
												onClick={() => void openPhaseMcpSettings(phase.id, index + 1)}
												title="Select MCP servers for this phase">
												<i className="codicon codicon-server" style={{ fontSize: "12.5px" }} />
											</VSCodeButton>
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

											{(phase.images.length > 0 || phase.files.length > 0) && (
												<Thumbnails
													files={phase.files}
													images={phase.images}
													setFiles={(updater) =>
														updatePhase(phase.id, {
															files: typeof updater === "function" ? updater(phase.files) : updater,
														})
													}
													setImages={(updater) =>
														updatePhase(phase.id, {
															images:
																typeof updater === "function" ? updater(phase.images) : updater,
														})
													}
												/>
											)}

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

						<div className="rounded-sm border border-[var(--vscode-panel-border)] p-3 mt-2 flex flex-col gap-3">
							<div>
								<div className="font-medium">Failure handling</div>
								<p className="text-xs text-description m-0 mt-1">
									If a phase fails or is blocked, should Auto Phase continue with the next phase?
								</p>
							</div>

							<div className="flex flex-col gap-1">
								<label className="font-medium" htmlFor="auto-phase-error-policy">
									On phase failure
								</label>
								<VSCodeDropdown
									className="w-full"
									id="auto-phase-error-policy"
									onChange={(event) =>
										updatePlanSettings({
											onPhaseError: Number(
												(event.target as HTMLSelectElement).value,
											) as AutoPhaseErrorPolicy,
										})
									}
									value={String(planSettings.onPhaseError)}>
									<VSCodeOption value={String(AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_ASK)}>
										Ask me when a phase fails
									</VSCodeOption>
									<VSCodeOption value={String(AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_CONTINUE)}>
										Continue with the next phase automatically
									</VSCodeOption>
									<VSCodeOption value={String(AutoPhaseErrorPolicy.AUTO_PHASE_ERROR_STOP)}>
										Stop the plan
									</VSCodeOption>
								</VSCodeDropdown>
							</div>

							<VSCodeCheckbox
								checked={planSettings.passPhaseReports}
								onChange={(event) =>
									updatePlanSettings({
										passPhaseReports: (event.target as HTMLInputElement).checked === true,
									})
								}>
								Pass each phase's short report to the next phase
							</VSCodeCheckbox>

							<div>
								<VSCodeCheckbox
									checked={planSettings.writeReport}
									onChange={(event) =>
										updatePlanSettings({ writeReport: (event.target as HTMLInputElement).checked === true })
									}>
									Write a detailed Markdown report for every run
								</VSCodeCheckbox>
								<p className="text-xs text-description m-0 mt-1">
									Reports are written to <code>.bytos/auto-phase-reports/</code> in the workspace. The chat
									shows a short summary and points to the detailed report.
								</p>
							</div>

							<div>
								<VSCodeCheckbox
									checked={planSettings.aiSummary}
									onChange={(event) =>
										updatePlanSettings({ aiSummary: (event.target as HTMLInputElement).checked === true })
									}>
									Generate an AI summary at the end (extra model call)
								</VSCodeCheckbox>
								<p className="text-xs text-description m-0 mt-1">
									When off, the chat summary is generated deterministically from the phase reports. When on, the
									summary uses the last phase's provider and model.
								</p>
							</div>
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
							{phaseList.length > 0 && (
								<VSCodeButton
									appearance="secondary"
									disabled={saving || loading}
									onClick={() => void deleteAllPhases()}
									title="Delete all phases from the plan. History and tasks are not affected.">
									Delete all phases
								</VSCodeButton>
							)}
							<DoneButton appearance="primary" disabled={saving || loading} onClick={() => persistPlan()}>
								{saving ? "Saving…" : "Done"}
							</DoneButton>
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}

export default AutoPhasePlanSection
