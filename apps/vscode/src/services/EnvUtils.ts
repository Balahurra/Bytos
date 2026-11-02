import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { EmptyRequest } from "@/shared/proto/bytos/common"
import { Logger } from "@/shared/services/Logger"

// Canonical header names for extra client/host context
const BytosHeaders = {
	PLATFORM: "X-PLATFORM",
	PLATFORM_VERSION: "X-PLATFORM-VERSION",
	CLIENT_VERSION: "X-CLIENT-VERSION",
	CLIENT_TYPE: "X-CLIENT-TYPE",
	CORE_VERSION: "X-CORE-VERSION",
	IS_MULTIROOT: "X-IS-MULTIROOT",
} as const

export function buildExternalBasicHeaders(): Record<string, string> {
	return {
		"User-Agent": `Bytos/${ExtensionRegistryInfo.version}`,
	}
}

export async function buildBasicBytosHeaders(): Promise<Record<string, string>> {
	const headers: Record<string, string> = buildExternalBasicHeaders()
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		headers[BytosHeaders.PLATFORM] = host.platform || "unknown"
		headers[BytosHeaders.PLATFORM_VERSION] = host.version || "unknown"
		headers[BytosHeaders.CLIENT_TYPE] = host.bytosType || "unknown"
		headers[BytosHeaders.CLIENT_VERSION] = host.bytosVersion || "unknown"
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		headers[BytosHeaders.PLATFORM] = "unknown"
		headers[BytosHeaders.PLATFORM_VERSION] = "unknown"
		headers[BytosHeaders.CLIENT_TYPE] = "unknown"
		headers[BytosHeaders.CLIENT_VERSION] = "unknown"
	}
	headers[BytosHeaders.CORE_VERSION] = ExtensionRegistryInfo.version

	return headers
}
