import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { VoiceServiceClient } from "@/services/grpc-client"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"
import { useVoiceServiceStatus } from "../voice/useVoiceServiceStatus"
import { deriveVoiceStatus } from "../voice/voiceStatus"
import { GeneralVoiceGroup, LanguageGroup, MicrophoneGroup, ModelGroup } from "./voiceSettingsGroups"

interface VoiceSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

/** `ggml-small.bin` → `ggml-small`. */
function modelNameFromFile(fileName: string): string {
	return fileName.replace(/\.bin$/i, "")
}

/**
 * Settings → Voice (F3).
 *
 * Sits between General and About, and is built from the same primitives as the
 * rest of the screen. Every value it shows comes from `VoiceService`
 * (`getVoiceServiceStatus`) or from a pushed `VoiceEvent`; the only local state
 * is the model the user just selected (so the row responds before the host has
 * answered) and which row is mid-action.
 */
const VoiceSettingsSection = ({ renderSectionHeader }: VoiceSettingsSectionProps) => {
	const { voiceEnabled, voiceMicrophoneId, voiceLanguage } = useExtensionState()
	const voice = useVoiceServiceStatus(true)
	// Selection is written through the host, but the radio must flip on click.
	// This optimistic id is cleared as soon as the host reports the same value.
	const [optimisticModelId, setOptimisticModelId] = useState<string | undefined>(undefined)
	const [busyModelIds, setBusyModelIds] = useState<ReadonlySet<string>>(() => new Set())
	const [removingModelId, setRemovingModelId] = useState<string | undefined>(undefined)
	const [customName, setCustomName] = useState("")
	const [customToken, setCustomToken] = useState("")
	const [customFileName, setCustomFileName] = useState("")
	const [customBusy, setCustomBusy] = useState(false)
	const [customError, setCustomError] = useState("")

	const capability = voice.status?.capability
	const runtime = useMemo(() => deriveVoiceStatus(voice.status, { loading: voice.loading }), [voice.status, voice.loading])
	const models = voice.status?.models ?? []
	const selectedModelId = optimisticModelId ?? voice.status?.modelId ?? ""
	const selectedModel = models.find((model) => model.id === selectedModelId)
	const microphoneDisabled = !voiceEnabled || !capability?.canCapture

	useEffect(() => {
		if (optimisticModelId && voice.status?.modelId === optimisticModelId) {
			setOptimisticModelId(undefined)
		}
	}, [optimisticModelId, voice.status?.modelId])

	const markBusy = useCallback((modelId: string, busy: boolean) => {
		setBusyModelIds((current) => {
			const next = new Set(current)
			if (busy) {
				next.add(modelId)
			} else {
				next.delete(modelId)
			}
			return next
		})
	}, [])

	/**
	 * Enabling Voice changes what the host can report (microphone enumeration only
	 * runs once capture is possible), so the panel re-reads the status after the
	 * write instead of waiting for the next state push.
	 */
	const handleEnabledChange = useCallback(
		(checked: boolean) => {
			void updateSetting("voiceEnabled", checked)
			// The write is a ProtoBus round-trip; poll briefly so the status row
			// reflects the host's answer rather than the click.
			window.setTimeout(() => voice.refresh(), 400)
		},
		[voice],
	)

	const handleSelect = useCallback(
		async (modelId: string) => {
			setOptimisticModelId(modelId)
			await updateSetting("voiceModelId", modelId)
			voice.refresh()
		},
		[voice],
	)

	const handleDownload = useCallback(
		async (modelId: string) => {
			markBusy(modelId, true)
			try {
				// `consent: true` expresses the click; the host then shows its own modal
				// with the exact download size before transferring anything.
				await VoiceServiceClient.downloadVoiceModel({ modelId, consent: true })
			} catch (error) {
				console.error("Starting the model download failed:", error)
			} finally {
				markBusy(modelId, false)
				// A completed download changes this row and `transcribeReady`; the
				// other row's state must stay visible too.
				voice.refresh()
			}
		},
		[markBusy, voice],
	)

	const handleCancel = useCallback(async (modelId: string) => {
		try {
			await VoiceServiceClient.cancelVoiceModelDownload({ modelId })
		} catch (error) {
			console.error("Cancelling the model download failed:", error)
		}
	}, [])

	const handleRetry = useCallback(
		async (modelId: string) => {
			markBusy(modelId, true)
			try {
				await VoiceServiceClient.verifyVoiceModel({ modelId })
				voice.refresh()
			} catch (error) {
				console.error("Verifying the model failed:", error)
			} finally {
				markBusy(modelId, false)
			}
		},
		[markBusy, voice],
	)

	const handleRemove = useCallback(
		async (modelId: string) => {
			setRemovingModelId(modelId)
			try {
				await VoiceServiceClient.removeVoiceModel({ modelId })
				if (selectedModelId === modelId) {
					setOptimisticModelId("base")
					await updateSetting("voiceModelId", "base")
				}
				voice.refresh()
			} catch (error) {
				console.error("Removing the model failed:", error)
			} finally {
				setRemovingModelId(undefined)
			}
		},
		[selectedModelId, voice],
	)

	const handlePickCustomFile = useCallback(async () => {
		setCustomError("")
		try {
			const response = await VoiceServiceClient.selectVoiceModelFile({})
			if (!response.token) return
			setCustomToken(response.token)
			setCustomFileName(response.fileName)
			if (!customName.trim()) {
				setCustomName(modelNameFromFile(response.fileName))
			}
		} catch (error) {
			setCustomError(error instanceof Error ? error.message : "Could not open the file picker.")
		}
	}, [customName])

	const handleAddCustom = useCallback(async () => {
		if (!customToken) return
		setCustomBusy(true)
		setCustomError("")
		try {
			const model = await VoiceServiceClient.addCustomVoiceModel({
				displayName: customName.trim() || modelNameFromFile(customFileName),
				selectionToken: customToken,
			})
			setOptimisticModelId(model.id)
			await updateSetting("voiceModelId", model.id)
			setCustomName("")
			setCustomToken("")
			setCustomFileName("")
			voice.refresh()
		} catch (error) {
			setCustomError(error instanceof Error ? error.message : "Could not add the custom model.")
		} finally {
			setCustomBusy(false)
		}
	}, [customFileName, customName, customToken, voice])

	return (
		<div>
			{renderSectionHeader("voice")}
			<Section>
				<GeneralVoiceGroup
					canCapture={!!capability?.canCapture}
					enabled={!!voiceEnabled}
					engineState={voice.status?.engineState}
					microphoneAvailable={!!voice.status?.microphoneAvailable}
					onEnabledChange={handleEnabledChange}
					osLabel={capability?.osLabel ?? ""}
					runtimeDetail={runtime.detail}
					runtimeLabel={runtime.label}
				/>
				<MicrophoneGroup
					devices={voice.status?.devices ?? []}
					disabled={microphoneDisabled}
					enabled={!!voiceEnabled}
					loading={voice.loading}
					onRefresh={voice.refresh}
					status={voice.status}
					value={voiceMicrophoneId ?? ""}
				/>
				<LanguageGroup value={voiceLanguage ?? "auto"} />
				<ModelGroup
					busyModelIds={busyModelIds}
					customBusy={customBusy}
					customError={customError}
					customFileName={customFileName}
					customName={customName}
					loading={voice.loading}
					models={models}
					onAddCustom={handleAddCustom}
					onCancel={handleCancel}
					onCustomNameChange={setCustomName}
					onDownload={handleDownload}
					onPickCustomFile={handlePickCustomFile}
					onRemove={handleRemove}
					onRetry={handleRetry}
					onSelect={(modelId) => void handleSelect(modelId)}
					removingModelId={removingModelId}
					selectedModelId={selectedModelId}
					selectedModelReady={selectedModel?.state === "ready"}
				/>
			</Section>
		</div>
	)
}

export default VoiceSettingsSection
