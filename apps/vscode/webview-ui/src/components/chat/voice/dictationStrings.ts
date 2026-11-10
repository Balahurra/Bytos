/**
 * F4 — composer dictation strings in the three languages Bytos supports.
 *
 * ## Why a table and not an i18n framework
 *
 * The webview has no translation layer: every other surface is English-only
 * literals. Introducing `i18next` (plus locale files, a provider, a language
 * negotiation layer and a bundle-size increase) to translate nine short strings
 * would be a parallel subsystem for one feature. This module instead provides
 * exactly the strings the composer needs, keyed by the same language codes the
 * Voice settings already use (`tr` | `en` | `de`), with English as the fallback.
 *
 * The language comes from the host's `voiceLanguage` setting. When that is
 * `auto` — the default — the UI language follows the editor's display language
 * instead, so a Turkish user sees Turkish buttons without having to pin the
 * recognition language first. Recognition language and UI language are separate
 * concerns and are deliberately not coupled any further than that.
 */

/** The languages Bytos ships dictation strings for. */
export type VoiceUiLanguage = "tr" | "en" | "de"

/** Every string the composer dictation UI can show. */
export interface VoiceDictationStrings {
	/** Idle tooltip / aria-label. */
	idle: string
	/** "Starting the microphone…" while `startCapture` runs. */
	starting: string
	/** Recording state label, e.g. "Recording 0:12". */
	recording: (elapsed: string) => string
	/** The button label while recording: stop and turn the audio into text. */
	transcribeButton: string
	/** aria-label for that button. */
	transcribeAria: string
	/** "Transcribing…" while whisper runs. */
	transcribing: string
	/** Confirmation that the transcript landed in the draft. */
	completed: string
	/** Recording was cancelled; nothing was added. */
	cancelled: string
	/** Generic failure headline (the host's own sentence follows it). */
	failed: string
	/** Action that starts a new recording after a failure. */
	tryAgain: string
	/** Action that abandons a recording or a transcription. */
	cancel: string
	/** Action that dismisses an error or a completion notice. */
	dismiss: string
	/** Shown when the capture produced no audible speech. */
	noSpeech: string
}

const EN: VoiceDictationStrings = {
	idle: "Voice input",
	starting: "Starting the microphone…",
	recording: (elapsed) => `Recording ${elapsed}`,
	transcribeButton: "Transcribe",
	transcribeAria: "Stop recording and transcribe to text",
	transcribing: "Transcribing…",
	completed: "Voice transcript added to your message",
	cancelled: "Voice input cancelled",
	failed: "Voice input failed",
	tryAgain: "Try again",
	cancel: "Cancel",
	dismiss: "Dismiss",
	noSpeech: "No speech was detected.",
}

const TR: VoiceDictationStrings = {
	idle: "Sesli giriş",
	starting: "Mikrofon açılıyor…",
	recording: (elapsed) => `Kayıt ${elapsed}`,
	transcribeButton: "Metne Çevir",
	transcribeAria: "Kaydı durdur ve metne çevir",
	transcribing: "Metne çevriliyor…",
	completed: "Konuşma metni mesajınıza eklendi",
	cancelled: "Sesli giriş iptal edildi",
	failed: "Sesli giriş başarısız oldu",
	tryAgain: "Yeniden dene",
	cancel: "İptal",
	dismiss: "Kapat",
	noSpeech: "Konuşma algılanamadı.",
}

const DE: VoiceDictationStrings = {
	idle: "Spracheingabe",
	starting: "Mikrofon wird gestartet…",
	recording: (elapsed) => `Aufnahme ${elapsed}`,
	transcribeButton: "In Text umwandeln",
	transcribeAria: "Aufnahme beenden und in Text umwandeln",
	transcribing: "Wird in Text umgewandelt…",
	completed: "Transkript wurde Ihrer Nachricht hinzugefügt",
	cancelled: "Spracheingabe abgebrochen",
	failed: "Spracheingabe fehlgeschlagen",
	tryAgain: "Erneut versuchen",
	cancel: "Abbrechen",
	dismiss: "Schließen",
	noSpeech: "Keine Sprache erkannt.",
}

const TABLES: Record<VoiceUiLanguage, VoiceDictationStrings> = { en: EN, tr: TR, de: DE }

function isVoiceUiLanguage(value: string | undefined): value is VoiceUiLanguage {
	return value === "tr" || value === "en" || value === "de"
}

/**
 * Resolves the UI language.
 *
 * Priority: the requested recognition language when it is one Bytos supports
 * (a user who pinned Turkish wants Turkish buttons), then the editor's display
 * language, then English.
 */
export function resolveVoiceUiLanguage(options: {
	/** `voiceLanguage` from the host: "auto" | "tr" | "en" | "de". */
	recognitionLanguage?: string
	/** `navigator.language` or the editor locale, e.g. "tr", "de-DE". */
	editorLocale?: string
}): VoiceUiLanguage {
	if (isVoiceUiLanguage(options.recognitionLanguage)) return options.recognitionLanguage
	const locale = (options.editorLocale ?? "").toLowerCase()
	if (locale.startsWith("tr")) return "tr"
	if (locale.startsWith("de")) return "de"
	return "en"
}

/** The string table for a language, defaulting to English. */
export function voiceDictationStrings(language: VoiceUiLanguage | undefined): VoiceDictationStrings {
	return TABLES[language ?? "en"] ?? EN
}

/** Every language the dictation UI is translated into. */
export const VOICE_UI_LANGUAGES: readonly VoiceUiLanguage[] = ["tr", "en", "de"] as const
