import { VoiceEvent } from "@shared/proto/bytos/voice"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import { toVoiceErrorCode, toVoiceErrorText } from "./shared"
import { publishVoiceEvent } from "./subscribeToVoiceEvents"
import { assertModelId, type VoiceModelService, type VoiceModelView } from "./VoiceModelService"

/**
 * F3 — the consent-gated model download flow shared by the RPC handler and its
 * tests.
 *
 * Hard rules, inherited from F2 and re-enforced here:
 *  - **Two independent consent gates.** The request must carry `consent: true`
 *    *and* the user must confirm the host's own prompt, which discloses the
 *    exact size. Either gate refusing means nothing is transferred.
 *  - **Nothing unverified is used.** A model becomes `ready` only after the
 *    SHA-256 and size match the Bytos pin; the row stays `failed` otherwise.
 *  - **Metadata only.** Progress leaves as a percentage and a state name.
 */

/** The confirmation text shown before a download. Size is always disclosed. */
export function describeDownloadForConsent(view: VoiceModelView): { message: string; detail: string } {
	const size = (view.sizeBytes / (1024 * 1024)).toFixed(1)
	return {
		message: `Download the ${view.displayName} speech model (${size} MiB)?`,
		detail:
			`Bytos transcribes locally with whisper.cpp. The ${view.displayName} model is ${size} MiB and is stored in ` +
			"this editor's extension storage. Audio never leaves your machine. The download is verified with SHA-256 " +
			"before the model can be used.",
	}
}

/**
 * Asks the user, in the host's own UI, for permission to download. Returns
 * `true` only on an explicit positive answer.
 */
export async function askForDownloadConsent(view: VoiceModelView): Promise<boolean> {
	const { message, detail } = describeDownloadForConsent(view)
	try {
		const answer = await HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message,
			options: { modal: true, detail, items: ["Download"] },
		})
		return answer.selectedOption === "Download"
	} catch (error) {
		Logger.warn("[Voice] The download consent prompt could not be shown:", error)
		return false
	}
}

export interface DownloadFlowOptions {
	controller: Controller
	modelId: string
	consent: boolean
	service: VoiceModelService
	/** Test seam: replaces the host prompt. */
	askConsent?: (view: VoiceModelView) => Promise<boolean>
}

/**
 * Runs the whole download decision + transfer. Returns `true` when a transfer
 * actually ran, so the caller can decide whether to push state to the webview.
 */
export async function runConsentedModelDownload(options: DownloadFlowOptions): Promise<boolean> {
	const modelId = assertModelId(options.modelId)
	const service = options.service
	const view = service.viewOf(modelId)

	// Already downloading: nothing to start.
	if (service.isDownloading(modelId)) {
		return false
	}
	// A verified model needs no work. An installed-but-unverified one is NOT
	// "ready" (see `viewOf`), so it falls through to the consent prompt and is
	// re-downloaded and verified rather than trusted.
	if (view.state === "ready" && view.verified && view.installed) {
		return false
	}

	const ask = options.askConsent ?? askForDownloadConsent
	const granted = options.consent === true && (await ask(view))
	if (!granted) {
		await publishVoiceEvent(
			VoiceEvent.create({
				kind: "modelStatusChanged",
				modelId,
				modelState: view.state,
				code: "MODEL_CONSENT_REQUIRED",
			}),
		)
		return false
	}

	const unsubscribe = service.subscribe((change) => {
		void publishVoiceEvent(
			VoiceEvent.create({
				kind: change.state === "downloading" ? "modelDownloadProgress" : "modelStatusChanged",
				modelId: change.id,
				modelState: change.state,
				progressPercent: change.progressPercent,
				code: change.errorCode,
			}),
		)
	})

	try {
		await service.download(modelId, { consent: true })
	} catch (error) {
		// A cancel is a normal outcome; anything else is logged as a stable code.
		if (toVoiceErrorCode(error) !== "MODEL_DOWNLOAD_ABORTED") {
			Logger.warn(`[Voice] Downloading the ${modelId} model failed:`, toVoiceErrorText(error))
		}
	} finally {
		unsubscribe()
	}
	return true
}
