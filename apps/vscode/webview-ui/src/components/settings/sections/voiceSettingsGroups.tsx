import type { CaptureDeviceInfo, VoiceModelInfo, VoiceServiceStatus } from "@shared/proto/bytos/voice"
import { Mic, RefreshCw } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { updateSetting } from "../utils/settingsHandlers"
import { VOICE_LANGUAGES } from "../voice/voiceStatus"
import { GroupLabel, MicrophonePicker, ModelRow, StatusLine } from "./voiceSettingsParts"

// Defined in the group module below to keep this file focused on markup.

/**
 * The four groups of Settings → Voice, each rendered as the same bordered block
 * the other Settings sections use (`border-editor-widget-border/50`, `p-3`,
 * `rounded-md`, `my-3`) so the section reads as part of the screen.
 */

/** Engine state → the short word the status line shows. */
const describeEngineState = (state: string | undefined): string => {
	switch (state) {
		case "ready":
			return "Ready"
		case "missing":
			return "Not installed"
		case "integrity-failed":
			return "Integrity check failed"
		case "unsupported-platform":
			return "Unsupported platform"
		default:
			return "—"
	}
}

/** One sentence explaining the microphone situation, from host data only. */
const microphoneHelp = (enabled: boolean, status: VoiceServiceStatus | undefined): string => {
	if (!enabled) {
		return "Turn on Voice to read the available microphones."
	}
	if (!status) {
		return "Reading the microphone list from the host…"
	}
	if (status.microphoneAvailable) {
		return "Bytos records from this device only while the microphone button is active."
	}
	return "No microphone was found. Connect one, then press Refresh."
}

export const GeneralVoiceGroup = ({
	enabled,
	canCapture,
	runtimeLabel,
	runtimeDetail,
	microphoneAvailable,
	engineState,
	osLabel,
	onEnabledChange,
}: {
	enabled: boolean
	canCapture: boolean
	runtimeLabel: string
	runtimeDetail: string
	microphoneAvailable: boolean
	engineState: string | undefined
	osLabel: string
	onEnabledChange: (enabled: boolean) => void
}) => (
	<div>
		<GroupLabel>General</GroupLabel>
		<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="voice-general">
			<div className="space-y-3">
				<div className="flex items-center justify-between w-full">
					<label htmlFor="voice-enabled-control">Voice</label>
					<Switch
						checked={enabled}
						className="shrink-0"
						id="voice-enabled-control"
						onCheckedChange={onEnabledChange}
						size="lg"
						tone="green"
					/>
				</div>
				<p className="text-xs text-description">
					Turn on voice input. Audio is captured only while the microphone button is active and never leaves your
					machine.
				</p>

				<div className="pt-1 space-y-2">
					<StatusLine label="Status" value={runtimeLabel} />
					<StatusLine
						label="Microphone"
						muted={!enabled}
						value={!enabled ? "Not checked" : microphoneAvailable ? "Available" : "Unavailable"}
					/>
					<StatusLine label="Engine" muted={!enabled} value={enabled ? describeEngineState(engineState) : "—"} />
					{canCapture && osLabel && <StatusLine label="Platform" muted value={osLabel} />}
				</div>

				<p className="text-xs text-description">{runtimeDetail}</p>
			</div>
		</div>
	</div>
)

export const MicrophoneGroup = ({
	enabled,
	disabled,
	devices,
	loading,
	status,
	value,
	onRefresh,
}: {
	enabled: boolean
	disabled: boolean
	devices: CaptureDeviceInfo[]
	loading: boolean
	status: VoiceServiceStatus | undefined
	value: string
	onRefresh: () => void
}) => (
	<div>
		<GroupLabel>Microphone</GroupLabel>
		<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="voice-microphone">
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 text-sm">
						<Mic className="w-3 h-3 text-description" />
						<span>Input device</span>
					</div>
					<button
						className="inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs text-description hover:bg-list-hover disabled:opacity-50"
						disabled={loading}
						onClick={onRefresh}
						title="Read the microphone list again"
						type="button">
						<RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
						Refresh
					</button>
				</div>

				<MicrophonePicker
					devices={devices}
					disabled={disabled}
					loading={loading}
					onChange={(deviceId) => updateSetting("voiceMicrophoneId", deviceId === "__default__" ? "" : deviceId)}
					value={value}
				/>

				<p className="text-xs text-description">{microphoneHelp(enabled, status)}</p>
			</div>
		</div>
	</div>
)

export const LanguageGroup = ({ value }: { value: string }) => (
	<div>
		<GroupLabel>Language</GroupLabel>
		<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="voice-language">
			<div className="space-y-2">
				<Select onValueChange={(next) => updateSetting("voiceLanguage", next)} value={value}>
					<SelectTrigger className="w-full" id="voice-language-select">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{VOICE_LANGUAGES.map((language) => (
							<SelectItem key={language.value} value={language.value}>
								{language.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-description">
					The language spoken to the microphone. Automatic detection lets the model identify it.
				</p>
			</div>
		</div>
	</div>
)

export const ModelGroup = ({
	models,
	selectedModelId,
	selectedModelReady,
	busyModelId,
	loading,
	onSelect,
	onDownload,
	onCancel,
	onRetry,
}: {
	models: VoiceModelInfo[]
	selectedModelId: string
	selectedModelReady: boolean
	busyModelId: string | undefined
	loading: boolean
	onSelect: (modelId: string) => void
	onDownload: (modelId: string) => void
	onCancel: (modelId: string) => void
	onRetry: (modelId: string) => void
}) => (
	<div>
		<GroupLabel>Speech model</GroupLabel>
		<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="voice-model">
			<div className="space-y-4">
				{models.length === 0 && (
					<p className="text-xs text-description">
						{loading ? "Reading installed models…" : "No speech models are available."}
					</p>
				)}
				{models.map((model) => (
					<ModelRow
						busy={busyModelId === model.id}
						key={model.id}
						model={model}
						onCancel={() => onCancel(model.id)}
						onDownload={() => onDownload(model.id)}
						onRetry={() => onRetry(model.id)}
						onSelect={() => onSelect(model.id)}
						selected={model.id === selectedModelId}
					/>
				))}
				<p className="text-xs text-description">
					Models run locally with whisper.cpp. A model is used only after its SHA-256 checksum matches the pinned value,
					and downloading one always asks for your confirmation first.
				</p>
				{selectedModelId && !selectedModelReady && (
					<p className="text-xs text-description">
						The selected model is not ready yet, so transcription stays unavailable.
					</p>
				)}
			</div>
		</div>
	</div>
)
