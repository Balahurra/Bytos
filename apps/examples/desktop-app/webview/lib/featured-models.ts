"use client";

import type { SearchComboboxOption, SearchComboboxSection } from "@bytos/ui";
import type {
	ProviderModel,
	ProviderModelFeaturedTier,
} from "@/lib/provider-schema";

export type ModelPickerData = {
	options: SearchComboboxOption[];
	sections?: SearchComboboxSection[];
};

// Section copy mirrors the CLI's featured picker so the products read the same.
const FREE_SECTION_DESCRIPTION = "Try with limited usage at no cost";

function displayName(model: ProviderModel): string {
	return model.name?.trim() || model.id;
}

function byLabel(a: SearchComboboxOption, b: SearchComboboxOption): number {
	return a.label.localeCompare(b.label);
}

function flatOptions(models: ProviderModel[]): SearchComboboxOption[] {
	const labelCounts = new Map<string, number>();
	for (const model of models) {
		const label = displayName(model);
		labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
	}
	return models
		.map((model) => {
			const label = displayName(model);
			return {
				label:
					(labelCounts.get(label) ?? 0) > 1 ? `${label} (${model.id})` : label,
				value: model.id,
			};
		})
		.sort(byLabel);
}

function tierOptions(
	models: ProviderModel[],
	tier: ProviderModelFeaturedTier,
	section: string,
	badge?: (model: ProviderModel) => string | undefined,
): SearchComboboxOption[] {
	return models
		.filter((model) => model.featured?.tier === tier)
		.sort((a, b) => (a.featured?.rank ?? 0) - (b.featured?.rank ?? 0))
		.map((model) => ({
			badge: badge?.(model),
			description: model.description?.trim() || undefined,
			label: displayName(model),
			section,
			value: model.id,
		}));
}

/**
 * Builds the sectioned model picker for a provider from the tier data the SDK
 * stamps onto `ProviderModel.featured` (see @bytos/core's
 * applyBytosFeaturedModels). The `bytos` provider gets Recommended / Free /
 * All models. Every other provider renders its catalog as a flat list ordered
 * by display name.
 */
export function buildModelPickerData(
	providerId: string,
	models: ProviderModel[],
): ModelPickerData {
	if (providerId === "bytos") {
		const recommended = tierOptions(
			models,
			"recommended",
			"recommended",
			(model) => model.featured?.tags[0],
		);
		const free = tierOptions(models, "free", "free");
		if (recommended.length === 0 && free.length === 0) {
			return { options: flatOptions(models) };
		}
		const rest = models
			.filter((model) => !model.featured)
			.map((model) => ({
				label: displayName(model),
				section: "all",
				value: model.id,
			}))
			.sort(byLabel);
		return {
			options: [...recommended, ...free, ...rest],
			sections: [
				{ id: "recommended", label: "Recommended" },
				{
					description: FREE_SECTION_DESCRIPTION,
					id: "free",
					label: "Free",
				},
				{ id: "all", label: "All models" },
			],
		};
	}

	return { options: flatOptions(models) };
}
