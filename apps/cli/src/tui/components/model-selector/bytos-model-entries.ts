import type {
	BytosRecommendedModel,
	BytosRecommendedModelsData,
} from "@bytos/core";

export type BytosModelPickerTier = "recommended" | "free";

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
	free: "Free",
};

// Featured entries for the sectioned picker: Recommended/Free with a
// browse-all escape into the full catalog.
export function buildFeaturedModelEntries(
	_providerId: string,
	data: BytosRecommendedModelsData,
): BytosModelPickerEntry[] {
	return buildBytosModelEntries(data);
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

export function freeTierDescriptionFor(
	_entries: BytosModelPickerEntry[],
): string | undefined {
	return undefined;
}
