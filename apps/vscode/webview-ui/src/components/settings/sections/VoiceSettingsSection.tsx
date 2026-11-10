import { useCallback, useMemo, useState } from "react"
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

/**
 * Settings → Voice (F3).
 *
 * Sits between General and About, and is built from the same primitives as the
 * rest of the screen. Every value it shows comes from `VoiceService`
 * (`getVoiceServiceStatus`) or from a pushed `VoiceEvent`; the only local state
 * is which row is mid-action, and that is a UI detail, never a claim about the
 * host.
 */
const VoiceSettingsSection = ({ renderSectionHeader }: VoiceSettingsSectionProps) => {
	const { voiceEnabled, voiceMicrophoneId, voiceLanguage } = useExtensionState()
	const voice = useVoiceServiceStatus(true)
	const [busyModelId, setBusyModelId] = useState<string | undefined>(undefined)

	const capability = voice.status?.capability
	const runtime = useMemo(() => deriveVoiceStatus(voice.status, { loading: voice.loading }), [voice.status, voice.loading])
	const models = voice.status?.models ?? []
	const selectedModel = models.find((model) => model.id === voice.status?.modelId)
	const microphoneDisabled = !voiceEnabled || !capability?.canCapture

	/**
	 * Enabling Voice changes what the host can report (microphone enumeration only
	 * runs once capture is possible), so the panel re-reads the status after the
	 * write instead of waiting for the next state push.
	 */
	const handleEnabledChange = useCallback(
		(checked: boolean) => {
			updateSetting("voiceEnabled", checked)
			// The write is a ProtoBus round-trip; poll briefly so the status row
			// reflects the host's answer rather than the click.
			window.setTimeout(() => voice.refresh(), 400)
		},
		[voice],
	)

	const handleDownload = useCallback(async (modelId: string) => {
		setBusyModelId(modelId)
		try {
			// `consent: true` expresses the click; the host then shows its own modal
			// with the exact download size before transferring anything.
			await VoiceServiceClient.downloadVoiceModel({ modelId, consent: true })
		} catch (error) {
			console.error("Starting the model download failed:", error)
		} finally {
			setBusyModelId(undefined)
		}
	}, [])

	const handleCancel = useCallback(async (modelId: string) => {
		try {
			await VoiceServiceClient.cancelVoiceModelDownload({ modelId })
		} catch (error) {
			console.error("Cancelling the model download failed:", error)
		}
	}, [])

	const handleRetry = useCallback(
		async (modelId: string) => {
			setBusyModelId(modelId)
			try {
				await VoiceServiceClient.verifyVoiceModel({ modelId })
				voice.refresh()
			} catch (error) {
				console.error("Verifying the model failed:", error)
			} finally {
				setBusyModelId(undefined)
			}
		},
		[voice],
	)

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
					busyModelId={busyModelId}
					loading={voice.loading}
					models={models}
					onCancel={handleCancel}
					onDownload={handleDownload}
					onRetry={handleRetry}
					onSelect={(modelId) => updateSetting("voiceModelId", modelId)}
					selectedModelId={voice.status?.modelId ?? ""}
					selectedModelReady={selectedModel?.state === "ready"}
				/>
			</Section>
		</div>
	)
}

export default VoiceSettingsSection
