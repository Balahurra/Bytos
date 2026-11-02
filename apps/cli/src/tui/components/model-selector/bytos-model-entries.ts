import type {
	BytosRecommendedModel,
	BytosRecommendedModelsData,
} from "@bytos/core";

export type BytosModelPickerTier = "recommended" | "subscribed" | "free";

export interface BytosModelPickerItem {
	kind: "model";
	model: BytosRecommendedModel;
	tier: BytosModelPickerTier;
}

export interface BytosModelPickerBrowse {
	kind: "browse";
}

export type BytosModelPickerEntry =
	| BytosModelPickerItem
	| BytosModelPickerBrowse;

export const BYTOS_MODEL_PICKER_TIER_LABELS: Record<
	BytosModelPickerTier,
	string
> = {
	recommended: "Recommended",
	subscribed: "Subscribed",
	free: "Free",
};

// Featured entries for the sectioned picker, keyed by provider: bytos gets
// Recommended/Free with a browse-all escape into the full catalog; bytos-pass
// gets Subscribed/Free (see buildBytosPassModelEntries for why no browse-all).
export function buildFeaturedModelEntries(
	providerId: string,
	data: BytosRecommendedModelsData,
): BytosModelPickerEntry[] {
	return providerId === "bytos-pass"
		? buildBytosPassModelEntries(data)
		: buildBytosModelEntries(data);
}

function buildBytosModelEntries(
	data: BytosRecommendedModelsData,
): BytosModelPickerEntry[] {
	const entries: BytosModelPickerEntry[] = [];
	for (const m of data.recommended) {
		entries.push({ kind: "model", model: m, tier: "recommended" });
	}
	for (const m of data.free) {
		entries.push({ kind: "model", model: m, tier: "free" });
	}
	entries.push({ kind: "browse" });
	return entries;
}

// Shown under the Free section header when picking a model for BytosPass
export const BYTOS_PASS_FREE_SECTION_DESCRIPTION =
	"Try with limited usage, separate from BytosPass quota.";

// BytosPass shows the subscription's models plus the Bytos free models — both
// providers hit the same Bytos API, so free models are selectable in place
// (they ride usage billing at $0 instead of the subscription quota).
// No "browse all" entry when the bytosPass bucket is populated: unlike bytos,
// the BytosPass catalog contains exactly these two buckets, so the sections
// already list every selectable model. An empty bytosPass bucket means the
// fetch fell back to the bundled list (which has no pass models) — without an
// escape into the full catalog a subscriber could only pick free models, so
// browse-all comes back in that degraded mode.
function buildBytosPassModelEntries(
	data: BytosRecommendedModelsData,
): BytosModelPickerEntry[] {
	const entries: BytosModelPickerEntry[] = [];
	for (const m of data.bytosPass) {
		entries.push({ kind: "model", model: m, tier: "subscribed" });
	}
	for (const m of data.free) {
		entries.push({ kind: "model", model: m, tier: "free" });
	}
	if (data.bytosPass.length === 0) {
		entries.push({ kind: "browse" });
	}
	return entries;
}

// The quota explainer only makes sense in the BytosPass picker, which is the
// only picker that has a "subscribed" section
export function freeTierDescriptionFor(
	entries: BytosModelPickerEntry[],
): string | undefined {
	const isBytosPassPicker = entries.some(
		(entry) => entry.kind === "model" && entry.tier === "subscribed",
	);
	return isBytosPassPicker ? BYTOS_PASS_FREE_SECTION_DESCRIPTION : undefined;
}
