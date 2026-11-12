import { EmptyRequest } from "@shared/proto/bytos/common"
import { SelectVoiceModelFileResponse } from "@shared/proto/bytos/voice"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from ".."
import { rememberSelectedModelFile } from "./selectedVoiceModelFiles"

/**
 * `selectVoiceModelFile` — the host's own file picker, filtered to `.bin`.
 *
 * The attachment picker cannot be used for this: it rejects ordinary files over
 * 20 MB and does not list `.bin`, while whisper.cpp models are 75 MB and up.
 *
 * The chosen path never leaves the host. The webview gets a one-use token and
 * the base file name, and `addCustomVoiceModel` resolves the token. An empty
 * token means the user cancelled; nothing is copied until they press Add.
 */
export async function selectVoiceModelFile(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<SelectVoiceModelFileResponse> {
	try {
		const response = await HostProvider.window.showOpenDialogue({
			canSelectMany: false,
			openLabel: "Select model",
			filters: { files: ["bin"] },
		})
		const selected = response.paths?.[0] ?? ""
		if (!selected) {
			return SelectVoiceModelFileResponse.create({ token: "", fileName: "" })
		}
		const { token, fileName } = rememberSelectedModelFile(selected)
		return SelectVoiceModelFileResponse.create({ token, fileName })
	} catch {
		return SelectVoiceModelFileResponse.create({ token: "", fileName: "" })
	}
}
