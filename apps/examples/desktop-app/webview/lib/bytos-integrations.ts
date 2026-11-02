import { isBytosAccountNotAuthenticatedResult } from "@/lib/bytos-account-state";
import type {
	BytosGitHubRepository,
	BytosIntegration,
} from "@/lib/bytos-integrations-types";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";

export * from "@/lib/bytos-integrations-types";

export type BytosIntegrationsListResult =
	| { status: "ok"; integrations: BytosIntegration[] }
	| { status: "not-authenticated" };

export async function listBytosIntegrations(): Promise<BytosIntegrationsListResult> {
	const result = await desktopClient.invoke("bytos_integrations", {
		operation: "list",
	});
	if (isBytosAccountNotAuthenticatedResult(result)) {
		return { status: "not-authenticated" };
	}
	return {
		status: "ok",
		integrations: Array.isArray(result) ? (result as BytosIntegration[]) : [],
	};
}

export async function listBytosGitHubRepositories(): Promise<
	BytosGitHubRepository[]
> {
	const result = await desktopClient.invoke("bytos_integrations", {
		operation: "listGitHubRepositories",
	});
	return Array.isArray(result) ? (result as BytosGitHubRepository[]) : [];
}

export async function fetchGitHubInstallUrl(): Promise<string> {
	const result = await desktopClient.invoke("bytos_integrations", {
		operation: "githubInstallUrl",
	});
	if (isBytosAccountNotAuthenticatedResult(result)) {
		throw new Error("sign in to your Bytos account first");
	}
	const url = (result as { url?: unknown } | null)?.url;
	if (typeof url !== "string" || !url.trim()) {
		throw new Error("no GitHub install URL was returned");
	}
	return url;
}

export async function openPersonalGitHubInstallUrl(
	fallbackUrl: string,
): Promise<void> {
	let url = fallbackUrl;
	try {
		url = await fetchGitHubInstallUrl();
	} catch {}
	await openExternalUrl(url);
}
