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
	if (!status) {
		return "Reading the microphone list from the host…"
	}
	const activeCount = (status.devices ?? []).filter((device) => device.state === "active").length
	if (!enabled) {
		return activeCount > 0
			? `Found ${activeCount} microphone${activeCount === 1 ? "" : "s"}. Turn on Voice to choose one.`
			: "Turn on Voice to read the available microphones."
	}
	if (status.microphoneAvailable) {
		return "Bytos records from this device only while the microphone button is active."
	}
	switch (status.microphoneErrorCode) {
		case "CAPTURE_HELPER_MISSING":
			return "The bundled microphone helper is missing from this installation. Reinstall Bytos, then press Refresh."
		case "MICROPHONE_ACCESS_DENIED":
			return "Microphone access is blocked by Windows privacy settings. Allow microphone access, then press Refresh."
		case "CAPTURE_HELPER_FAILED":
			return "The microphone helper could not start. Press Refresh; if it keeps failing, reinstall Bytos."
		case "CAPTURE_ENUMERATION_FAILED":
			return "Windows did not return a device list. Check your audio driver, then press Refresh."
		default:
			return "No microphone was found. Connect one, then press Refresh."
	}
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
						muted={!microphoneAvailable}
						value={microphoneAvailable ? "Available" : enabled ? "Unavailable" : "Not checked"}
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
	busyModelIds,
	removingModelId,
	loading,
	customName,
	customFileName,
	customBusy,
	customError,
	onSelect,
	onDownload,
	onCancel,
	onRetry,
	onRemove,
	onCustomNameChange,
	onPickCustomFile,
	onAddCustom,
}: {
	models: VoiceModelInfo[]
	selectedModelId: string
	selectedModelReady: boolean
	busyModelIds: ReadonlySet<string>
	removingModelId: string | undefined
	loading: boolean
	customName: string
	customFileName: string
	customBusy: boolean
	customError: string
	onSelect: (modelId: string) => void
	onDownload: (modelId: string) => void
	onCancel: (modelId: string) => void
	onRetry: (modelId: string) => void
	onRemove: (modelId: string) => void
	onCustomNameChange: (value: string) => void
	onPickCustomFile: () => void
	onAddCustom: () => void
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
						busy={busyModelIds.has(model.id)}
						key={model.id}
						model={model}
						onCancel={() => onCancel(model.id)}
						onDownload={() => onDownload(model.id)}
						onRemove={() => onRemove(model.id)}
						onRetry={() => onRetry(model.id)}
						onSelect={() => onSelect(model.id)}
						removing={removingModelId === model.id}
						selected={model.id === selectedModelId}
					/>
				))}
				<p className="text-xs text-description">
					Models run locally with whisper.cpp. A built-in model is used only after its SHA-256 checksum matches the
					pinned value, and downloading one always asks for your confirmation first.
				</p>
				{selectedModelId && !selectedModelReady && (
					<p className="text-xs text-description">
						The selected model is not ready yet, so transcription stays unavailable.
					</p>
				)}

				<div className="border-t border-editor-widget-border/50 pt-3 space-y-2" id="voice-model-custom">
					<div className="text-sm font-medium">Add a custom voice model</div>
					<p className="text-xs text-description m-0">
						Add any multilingual whisper.cpp model you already have as a local <code>.bin</code> file. Bytos copies
						the file into its model folder, records its SHA-256, and lists it beside the built-in models. After
						selecting it, the composer's microphone uses it for dictation.
					</p>
					<label className="block text-xs text-description" htmlFor="voice-custom-model-name">
						Model name
					</label>
					<input
						className="w-full box-border rounded-sm border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] px-2 py-1 text-sm"
						id="voice-custom-model-name"
						onChange={(event) => onCustomNameChange(event.target.value)}
						placeholder="e.g. Whisper Small Turkish"
						value={customName}
					/>
					<div className="flex items-center gap-2">
						<button
							className="rounded-xs border border-[var(--vscode-button-border,transparent)] bg-[var(--vscode-button-secondaryBackground)] px-2 py-1 text-xs text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
							onClick={onPickCustomFile}
							type="button">
							{customFileName ? "Choose another file" : "Choose .bin file"}
						</button>
						<span className="min-w-0 truncate text-xs text-description">{customFileName || "No file selected"}</span>
					</div>
					<button
						className="rounded-xs bg-[var(--vscode-button-background)] px-2.5 py-1 text-xs text-[var(--vscode-button-foreground)] hover:bg-[var(--vscode-button-hoverBackground)] disabled:opacity-50"
						disabled={customBusy || !customFileName}
						onClick={onAddCustom}
						type="button">
						{customBusy ? "Adding…" : "Add model and use it"}
					</button>
					{customError && <p className="text-xs text-error m-0">{customError}</p>}
				</div>
			</div>
		</div>
	</div>
)
