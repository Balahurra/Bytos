import { setBytosClientIdentity } from "@bytos/shared"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { BytosClient } from "@/shared/bytos"
import { EmptyRequest } from "@/shared/proto/bytos/common"
import { Logger } from "@/shared/services/Logger"

export async function registerBytosClientIdentity(): Promise<void> {
	try {
		const host = await HostProvider.env.getHostVersion(EmptyRequest.create({}))
		setBytosClientIdentity({
			name: host.bytosType || BytosClient.VSCode,
			version: host.bytosVersion || ExtensionRegistryInfo.version,
			platform: host.platform || undefined,
			platformVersion: host.version || undefined,
		})
	} catch (error) {
		Logger.log("Failed to get IDE/platform info via HostBridge EnvService.getHostVersion", error)
		setBytosClientIdentity({
			name: BytosClient.VSCode,
			version: ExtensionRegistryInfo.version,
		})
	}
}
