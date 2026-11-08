import type { VoiceModelInfo } from "@shared/proto/bytos/voice"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatModelSize, modelRowState } from "../voice/voiceStatus"

/**
 * F3 — the small presentational pieces of Settings → Voice.
 *
 * These use only the existing design system: the same borders
 * (`border-editor-widget-border/50`), the same muted text (`text-description`),
 * the same Radix `Select`/`Progress` primitives, and the same icon sizes as the
 * rest of the Settings screen. No new colours, no new fonts, no new spacing.
 */

/** Subtle group label, matching the other Settings sections. */
export const GroupLabel = ({ children }: { children: React.ReactNode }) => (
	<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">{children}</div>
)

/** One `label + value` status line. Values are always host-owned strings. */
export const StatusLine = ({ label, value, muted }: { label: string; value: string; muted?: boolean }) => (
	<div className="flex items-start justify-between gap-4 text-sm">
		<span className="text-description">{label}</span>
		<span className={`text-right ${muted ? "text-description" : "text-foreground"}`}>{value}</span>
	</div>
)

export interface MicrophoneOption {
	id: string
	name: string
	state: string
	isDefault: boolean
}

/**
 * The capture-device picker.
 *
 * Options come from a real enumeration. "System default microphone" is a
 * first-class choice that clears the pin, matching the F1 runtime, which already
 * treats an empty microphone id that way.
 *
 * F4: only devices that can actually be recorded from are listed. The host
 * enumerates WASAPI **capture** endpoints only, so speakers and headphones can
 * never appear; this picker additionally hides endpoints Windows reports as
 * `disabled`, `unplugged` or `notpresent`, because selecting one can only fail.
 * The previously pinned device is still shown (marked as disconnected) when it
 * has gone away, so the user can see why nothing is being captured instead of
 * silently recording from a different microphone.
 */
export const MicrophonePicker = ({
	value,
	devices,
	loading,
	disabled,
	onChange,
}: {
	value: string
	devices: MicrophoneOption[]
	loading: boolean
	disabled: boolean
	onChange: (deviceId: string) => void
}) => {
	// Only devices that can record. A pinned-but-missing device keeps its row.
	const selectable = devices.filter((device) => device.state === "active" || device.id === value)
	const hasCurrentValue = value === "" || devices.some((device) => device.id === value)
	const pinnedMissing = value !== "" && !devices.some((device) => device.id === value && device.state === "active")

	return (
		<Select
			disabled={disabled}
			onValueChange={onChange}
			value={hasCurrentValue && !pinnedMissing ? (value === "" ? "__default__" : value) : "__missing__"}>
			<SelectTrigger className="w-full" id="voice-microphone-select">
				<SelectValue placeholder="No microphone available" />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="__default__">System default microphone</SelectItem>
				{selectable.map((device) => (
					<SelectItem key={device.id} value={device.id}>
						{device.name}
						{device.isDefault ? " (default)" : ""}
						{device.state !== "active" ? " — not connected" : ""}
					</SelectItem>
				))}
				{pinnedMissing && (
					<SelectItem value="__missing__">
						{loading ? "Reading microphones…" : "Selected microphone is not connected — pick another one"}
					</SelectItem>
				)}
			</SelectContent>
		</Select>
	)
}

export interface ModelRowProps {
	model: VoiceModelInfo
	selected: boolean
	busy: boolean
	onSelect: () => void
	onDownload: () => void
	onCancel: () => void
	onRetry: () => void
}

/**
 * One pinned model: name, size, install/verify state, and exactly one primary
 * action for the state it is in (download → cancel, failed → retry).
 */
export const ModelRow = ({ model, selected, busy, onSelect, onDownload, onCancel, onRetry }: ModelRowProps) => {
	const row = modelRowState(model)
	const isDownloading = model.state === "downloading"
	const isVerifying = model.state === "verifying"

	return (
		<div className="space-y-2" data-model-id={model.id}>
			<div className="flex items-start justify-between gap-3">
				<label className="flex items-start gap-2 cursor-pointer select-none" htmlFor={`voice-model-${model.id}`}>
					<input
						checked={selected}
						className="mt-0.5 accent-[var(--vscode-button-background)]"
						id={`voice-model-${model.id}`}
						name="voice-model"
						onChange={onSelect}
						type="radio"
					/>
					<span className="text-sm">
						{model.displayName}
						{model.isDefault && <span className="ml-1 text-xs text-description">(default)</span>}
					</span>
				</label>
				<span className="text-xs text-description shrink-0">
					{formatModelSize(model.sizeBytes)} · ~{model.approxMemoryMb} MB RAM
				</span>
			</div>

			<div className="flex items-center justify-between gap-3">
				<span
					className={`text-xs ${
						row.tone === "error" ? "text-error" : row.tone === "ready" ? "text-success" : "text-description"
					}`}>
					{row.label}
					{model.state === "failed" && model.errorCode ? ` — ${model.errorCode}` : ""}
				</span>
				<div className="flex items-center gap-2">
					{isDownloading && (
						<button
							className="rounded-xs px-1.5 py-0.5 text-xs text-description hover:bg-list-hover"
							onClick={onCancel}
							type="button">
							Cancel
						</button>
					)}
					{model.state === "failed" && (
						<button
							className="rounded-xs px-1.5 py-0.5 text-xs text-link hover:underline disabled:opacity-50"
							disabled={busy}
							onClick={onRetry}
							title="Re-check this model's SHA-256 against the pinned value"
							type="button">
							{model.errorCode === "MODEL_UNVERIFIED" ? "Verify" : "Retry"}
						</button>
					)}
					{!isDownloading && !isVerifying && model.state !== "ready" && (
						<button
							className="rounded-xs px-1.5 py-0.5 text-xs text-link hover:underline disabled:opacity-50"
							disabled={busy}
							onClick={onDownload}
							type="button">
							Download
						</button>
					)}
				</div>
			</div>

			{typeof row.progress === "number" && <Progress className="h-1" value={row.progress} />}
		</div>
	)
}
