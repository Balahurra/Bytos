/**
 * F4 — how a voice transcript is merged into the composer draft.
 *
 * The rule the user asked for is absolute: **never overwrite what they typed**.
 * So this only ever appends, and it decides the separator from the draft that is
 * actually in the text area at the moment the transcript arrives (not from a
 * stale render), keeping any text the user typed while recording.
 */

/** Collapses runs of whitespace and trims — whisper output, not user input. */
export function normaliseTranscript(text: string): string {
	return (text ?? "").replace(/\s+/g, " ").trim()
}

/**
 * Appends `transcript` to `draft`.
 *
 * - Empty transcript ⇒ the draft is returned byte-for-byte (`changed: false`), so
 *   a silent capture cannot even rewrite trailing whitespace.
 * - Existing text gets exactly one space before the transcript; a draft that
 *   already ends in whitespace (space, newline, tab) gets none, so the result
 *   never doubles a separator or glues words together.
 * - `cursor` is where the caret should land: the end of the inserted text.
 */
export function appendTranscript(draft: string, transcript: string): { value: string; changed: boolean; cursor: number } {
	const clean = normaliseTranscript(transcript)
	if (!clean) {
		return { value: draft, changed: false, cursor: draft.length }
	}
	let value: string
	if (draft.length === 0) {
		value = clean
	} else if (/\s$/.test(draft)) {
		value = draft + clean
	} else {
		value = `${draft} ${clean}`
	}
	return { value, changed: value !== draft, cursor: value.length }
}
