import { Boolean } from "@shared/proto/bytos/common"
import { isBytosCliInstalled } from "@/utils/cli-detector"
import { Controller } from ".."

/**
 * Check if the Bytos CLI is installed
 * @param controller The controller instance
 * @returns Boolean indicating if CLI is installed
 */
export async function checkCliInstallation(_controller: Controller): Promise<Boolean> {
	try {
		const isInstalled = await isBytosCliInstalled()
		return Boolean.create({ value: isInstalled })
	} catch {
		return Boolean.create({ value: false })
	}
}
