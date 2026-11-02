import { describe, expect, it, vi } from "vitest";
import {
	persistBytosAccountTelemetryIdentity,
	resolveBytosAccountTelemetryIdentity,
} from "./telemetry";
import type { BytosAccountUser } from "./types";

function createUser(
	overrides: Partial<BytosAccountUser> = {},
): BytosAccountUser {
	return {
		id: "user-1",
		email: "user@example.com",
		displayName: "User",
		photoUrl: "",
		createdAt: "",
		updatedAt: "",
		organizations: [],
		...overrides,
	};
}

describe("Bytos account telemetry identity", () => {
	it("resolves the active organization", () => {
		const identity = resolveBytosAccountTelemetryIdentity(
			createUser({
				organizations: [
					{
						active: true,
						memberId: "member-1",
						name: "Acme",
						organizationId: "org-1",
						roles: ["member"],
					},
				],
			}),
		);

		expect(identity).toEqual({
			id: "user-1",
			email: "user@example.com",
			provider: "bytos",
			organizationId: "org-1",
			organizationName: "Acme",
			memberId: "member-1",
		});
	});

	it("persists organization context for detached runtimes", () => {
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings: vi.fn(() => ({
				provider: "bytos" as const,
				auth: { accountId: "user-1", accessToken: "secret" },
			})),
			saveProviderSettings,
		};
		const identity = resolveBytosAccountTelemetryIdentity(
			createUser({
				organizations: [
					{
						active: true,
						memberId: "member-1",
						name: "Acme",
						organizationId: "org-1",
						roles: ["member"],
					},
				],
			}),
		);

		expect(persistBytosAccountTelemetryIdentity(manager, identity)).toBe(true);
		expect(saveProviderSettings).toHaveBeenCalledWith(
			{
				provider: "bytos",
				auth: {
					accountId: "user-1",
					accessToken: "secret",
					organizationId: "org-1",
					organizationName: "Acme",
					memberId: "member-1",
				},
			},
			{ setLastUsed: false },
		);
	});

	it("replaces stale persisted account identity after an account switch", () => {
		const saveProviderSettings = vi.fn();
		const manager = {
			getProviderSettings: vi.fn(() => ({
				provider: "bytos" as const,
				auth: { accountId: "old-user", accessToken: "secret" },
			})),
			saveProviderSettings,
		};

		persistBytosAccountTelemetryIdentity(manager, {
			id: "new-user",
			provider: "bytos",
		});

		expect(saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				auth: expect.objectContaining({ accountId: "new-user" }),
			}),
			{ setLastUsed: false },
		);
	});
});
