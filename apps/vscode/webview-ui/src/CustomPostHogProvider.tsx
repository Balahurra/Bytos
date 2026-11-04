import { posthogConfig } from "@shared/services/config/posthog-config"
import posthog from "posthog-js"
import { PostHogProvider } from "posthog-js/react"
import { type ReactNode, useEffect, useState } from "react"
import { useExtensionState } from "./context/ExtensionStateContext"

export function CustomPostHogProvider({ children }: { children: ReactNode }) {
	const { distinctId, version, userInfo, environment, telemetrySetting } = useExtensionState()

	// Skip PostHog entirely in self-hosted mode or when environment is unknown (safety fallback)
	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"

	const isTelemetryEnabled = telemetrySetting === "enabled"
	const [isActive, setIsActive] = useState(false)

	useEffect(() => {
		if (isSelfHostedOrUnknown || isActive || !posthogConfig.apiKey) {
			return
		}
		// At this point, we know apiKey is defined due to the check above
		const apiKey = posthogConfig.apiKey as string
		posthog.init(apiKey, {
			api_host: posthogConfig.host,
			ui_host: posthogConfig.uiHost,
			disable_session_recording: true,
			capture_pageview: false,
			capture_dead_clicks: false,
			// Feature flag evaluation is a network request; it is only allowed
			// after an explicit telemetry opt-in.
			advanced_disable_decide: !isTelemetryEnabled,
			// Autocapture should respect telemetry settings
			autocapture: false,
		})
		setIsActive(true)
	}, [isSelfHostedOrUnknown])

	useEffect(() => {
		if (!isActive || !distinctId || !version) {
			return
		}

		posthog.set_config({
			before_send: (payload) => {
				// No event, including feature-flag calls, leaves the webview
				// unless the user explicitly enabled telemetry.
				if (!isTelemetryEnabled) {
					return null
				}

				if (payload?.properties) {
					payload.properties.extension_version = version
					payload.properties.distinct_id = distinctId
				}
				return payload
			},
		})

		const optedIn = posthog.has_opted_in_capturing()
		const optedOut = posthog.has_opted_out_capturing()
		const args = {
			email: userInfo?.email,
			name: userInfo?.displayName,
		}
		if (!isTelemetryEnabled) {
			if (!optedOut) {
				posthog.opt_out_capturing()
			}
			return
		}

		posthog.identify(distinctId, args)
		if (!optedIn) {
			posthog.opt_in_capturing()
		}
	}, [isActive, isTelemetryEnabled, distinctId, version])

	return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
