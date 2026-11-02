import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listLocalProviders: vi.fn(async () => ({ providers: [], settingsPath: "" })),
}));

vi.mock("@bytos/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@bytos/core")>();
	return {
		...actual,
		listLocalProviders: mocks.listLocalProviders,
	};
});

describe("listLocalProviders", () => {
	it("enables BytosPass when listing the SDK provider list", async () => {
		const { listLocalProviders } = await import("./provider-catalog");
		const manager = {} as never;

		await listLocalProviders(manager);

		expect(mocks.listLocalProviders).toHaveBeenCalledWith(manager, {
			isBytosPassEnabled: true,
		});
	});
});
