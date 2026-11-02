import { StringRequest } from "@shared/proto/bytos/common"
import { UiServiceClient } from "@/services/grpc-client"

// BytosPass subscription signup page in the dashboard (requires auth).
const BYTOS_PASS_SUBSCRIBE_PATH = "/onboarding/individual-plan"
const BYTOS_PASS_USAGE_PATH = "/dashboard/subscription"
export const DEFAULT_APP_BASE_URL = "https://app.bytos.dev"

// Module-level so the pending intent survives OnboardingView unmounting: handleAuthCallback
// completes the welcome view (unmounting onboarding) before it pushes the auth-status update
// that sets bytosUser, so this must outlive the component to fire the redirect.
let pendingBytosPassSubscribe = false

export function setPendingBytosPassSubscribe(pending: boolean): void {
	pendingBytosPassSubscribe = pending
}

// Appends a dashboard path to the app base URL, preserving any path prefix in
// the base (new URL(path, base) would drop it for leading-slash paths).
function joinAppBaseUrl(appBaseUrl: string | undefined, path: string): string {
	const baseUrl = appBaseUrl || DEFAULT_APP_BASE_URL
	return `${baseUrl.replace(/\/+$/, "")}${path}`
}

// Opens the BytosPass subscription page once a pending signup is authenticated (guarded so it fires once).
export function openBytosPassSubscriptionIfPending(appBaseUrl: string | undefined): void {
	if (!pendingBytosPassSubscribe) {
		return
	}
	pendingBytosPassSubscribe = false
	UiServiceClient.openUrl(StringRequest.create({ value: joinAppBaseUrl(appBaseUrl, BYTOS_PASS_SUBSCRIBE_PATH) })).catch((err) =>
		console.error("Failed to open BytosPass subscription page:", err),
	)
}

export function buildBytosPassSubscriptionPageUrl(appBaseUrl: string | undefined): string {
	// BytosPass always bills the personal account, so force the personal
	// dashboard context for org-context users (matches EntitlementError and
	// the CLI's subscription links).
	return `${joinAppBaseUrl(appBaseUrl, BYTOS_PASS_USAGE_PATH)}?personal=true`
}

// Signup/subscribe page for users who don't have a BytosPass subscription yet.
export function buildBytosPassSubscribeUrl(appBaseUrl: string | undefined): string {
	return joinAppBaseUrl(appBaseUrl, BYTOS_PASS_SUBSCRIBE_PATH)
}
