import { Check, LoaderCircle, Mic, MicOff, Square, TriangleAlert } from "lucide-react"
import type React from "react"
import { useCallback, useEffect } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { type VoiceUiLanguage, voiceDictationStrings } from "./dictationStrings"
import type { VoiceDictationController, VoiceDictationPhase } from "./useVoiceDictation"

/**
 * F4 â€” the microphone control in the composer's bottom row.
 *
 * It sits immediately left of the existing Send arrow and reuses the composer's
 * own controls: the `input-icon-button` class the Send arrow and the Settings
 * model pickers already use, the shared `Tooltip` primitive, and VS Code theme
 * variables only â€” so light and dark themes need no special case.
 *
 * ## States (F4 acceptance criteria)
 *
 * | phase | control | text |
 * |---|---|---|
 * | idle / cancelled | mic glyph | tooltip "Voice input" |
 * | initializing | spinner | "Starting the microphoneâ€¦" |
 * | recording | dot + stop glyph + **label** | "Metne Ã‡evir" / "Transcribe" / "In Text umwandeln" |
 * | transcribing | spinner | "Metne Ã§evriliyorâ€¦" |
 * | completed | check | transcript already in the draft |
 * | error | alert glyph | the host's own sentence + "Yeniden dene" |
 *
 * While recording the control becomes a real labelled button rather than an icon:
 * the user must not have to guess that the mic glyph now means "stop and turn
 * this into text".
 */

/** Short inline status next to the button while a run is in progress. */
export function voiceStatusText(state: { phase: VoiceDictationPhase; elapsedMs: number }, language?: VoiceUiLanguage): string {
	const strings = voiceDictationStrings(language)
	switch (state.phase) {
		case "initializing":
			return strings.starting
		case "recording":
			return strings.recording(formatElapsed(state.elapsedMs))
		case "transcribing":
			return strings.transcribing
		case "error":
			return strings.failed
		case "completed":
			return strings.completed
		case "cancelled":
			return strings.cancelled
		default:
			return ""
	}
}

/** `m:ss`, capped at the host's 2-minute utterance ceiling. */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000))
	const minutes = Math.floor(total / 60)
	const seconds = total % 60
	return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function Glyph({ phase }: { phase: VoiceDictationPhase }) {
	switch (phase) {
		case "initializing":
		case "transcribing":
			return <LoaderCircle className="animate-spin" size={13} />
		case "recording":
			return <MicOff size={13} />
		case "completed":
			return <Check size={13} />
		case "error":
			return <TriangleAlert size={13} />
		default:
			return <Mic size={13} />
	}
}

interface VoiceDictationButtonProps {
	dictation: VoiceDictationController
	/** False when the host says voice cannot capture here; the button is inert. */
	enabled: boolean
	/**
	 * Why voice is unavailable, already turned into a sentence by the caller.
	 * Shown as the tooltip and as the title, so the button explains itself.
	 */
	disabledReason?: string
	/** UI language for the labels. Defaults to English. */
	language?: VoiceUiLanguage
}

export const VoiceDictationButton: React.FC<VoiceDictationButtonProps> = ({ dictation, enabled, disabledReason, language }) => {
	const { phase, errorMessage } = dictation
	const strings = voiceDictationStrings(language)
	const busy = phase === "initializing" || phase === "transcribing"
	const recording = phase === "recording"
	const disabled = !enabled

	// The error sentence is the tooltip while a run failed; otherwise the label.
	const tooltip = disabled
		? (disabledReason ?? strings.idle)
		: phase === "error"
			? errorMessage || strings.failed
			: phase === "completed"
				? strings.completed
				: phase === "cancelled"
					? strings.cancelled
					: recording
						? strings.transcribeAria
						: phase === "transcribing"
							? strings.transcribing
							: phase === "initializing"
								? strings.starting
								: strings.idle

	// Escape cancels a recording or a transcription, the same way it cancels
	// the assistant's pending action (ActionButtons).
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key !== "Escape") return
			if (phase !== "recording" && phase !== "transcribing" && phase !== "initializing") return
			event.preventDefault()
			event.stopPropagation()
			void dictation.cancel()
		},
		[dictation, phase],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown, true)
		return () => window.removeEventListener("keydown", handleKeyDown, true)
	}, [handleKeyDown])

	const iconColor = recording
		? "var(--vscode-errorForeground, #f14c4c)"
		: phase === "error"
			? "var(--vscode-errorForeground)"
			: phase === "completed"
				? "var(--vscode-charts-green, #2ea043)"
				: undefined

	return (
		<Tooltip>
			<TooltipContent className="text-xs px-2" side="top">
				{tooltip}
			</TooltipContent>
			<TooltipTrigger asChild>
				{/* While recording the control is a labelled button, so "Metne Ã‡evir"
				    is read, not guessed from an icon. */}
				{recording ? (
					<button
						aria-label={strings.transcribeAria}
						aria-pressed={true}
						className="flex items-center gap-1 rounded-xs px-1.5 h-5 text-xs font-medium bg-transparent border-0 cursor-pointer"
						data-dictation-phase={phase}
						data-testid="voice-button"
						onClick={() => dictation.toggle()}
						style={{ color: iconColor }}
						title={tooltip}
						type="button">
						<span
							aria-hidden="true"
							className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
							style={{ backgroundColor: "var(--vscode-errorForeground, #f14c4c)" }}
						/>
						<Square fill="currentColor" size={9} strokeWidth={0} />
						<span data-testid="voice-button-label">{strings.transcribeButton}</span>
					</button>
				) : (
					<button
						aria-label={strings.idle}
						aria-pressed={false}
						className={cn(
							"input-icon-button flex items-center justify-center w-5 h-5 bg-transparent border-0 p-0",
							disabled && "disabled",
						)}
						data-dictation-phase={phase}
						data-testid="voice-button"
						disabled={disabled || busy}
						onClick={() => dictation.toggle()}
						style={{ color: iconColor }}
						title={tooltip}
						type="button">
						<Glyph phase={phase} />
					</button>
				)}
			</TooltipTrigger>
		</Tooltip>
	)
}
