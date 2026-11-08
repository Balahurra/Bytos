import { EmptyRequest } from "@shared/proto/bytos/common"
import type { VoiceEvent, VoiceServiceStatus } from "@shared/proto/bytos/voice"
import { useCallback, useEffect, useRef, useState } from "react"
import { VoiceServiceClient } from "@/services/grpc-client"

/**
 * F3 — the webview side of the Voice settings surface.
 *
 * Two rules:
 *  1. The panel never guesses. Every field it renders comes from
 *     `VoiceService.getVoiceServiceStatus` or from a pushed `VoiceEvent`.
 *  2. Progress is never polled. A download reports itself through the
 *     `subscribeToVoiceEvents` stream (percent counters only), so an idle panel
 *     makes no requests at all.
 */

export interface VoiceServiceState {
	status: VoiceServiceStatus | undefined
	loading: boolean
	/** Stable code when the status call itself failed. */
	errorCode: string
	/** Refreshes everything: capability, microphones, engine, models. */
	refresh: () => void
	/** Re-reads a single model's row from the host (no hashing). */
	patchModel: (modelId: string, patch: Partial<{ state: string; progressPercent: number; errorCode: string }>) => void
}

export function useVoiceServiceStatus(enabled: boolean): VoiceServiceState {
	const [status, setStatus] = useState<VoiceServiceStatus | undefined>(undefined)
	const [loading, setLoading] = useState(false)
	const [errorCode, setErrorCode] = useState("")
	const [refreshToken, setRefreshToken] = useState(0)
	// Prevents a slow, stale response from overwriting a newer one.
	const requestSeq = useRef(0)

	const refresh = useCallback(() => setRefreshToken((token) => token + 1), [])

	useEffect(() => {
		if (!enabled) {
			return
		}
		let cancelled = false
		const seq = ++requestSeq.current
		setLoading(true)
		setErrorCode("")
		VoiceServiceClient.getVoiceServiceStatus(EmptyRequest.create())
			.then((next) => {
				if (cancelled || seq !== requestSeq.current) return
				setStatus(next)
			})
			.catch((error: unknown) => {
				if (cancelled || seq !== requestSeq.current) return
				setErrorCode(error instanceof Error ? error.message : String(error))
			})
			.finally(() => {
				if (cancelled || seq !== requestSeq.current) return
				setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [enabled, refreshToken])

	const patchModel = useCallback<VoiceServiceState["patchModel"]>((modelId, patch) => {
		setStatus((current) => {
			if (!current) return current
			const models = current.models.map((model) =>
				model.id === modelId
					? {
							...model,
							state: patch.state ?? model.state,
							progressPercent: patch.progressPercent ?? model.progressPercent,
							errorCode: patch.errorCode ?? model.errorCode,
							installed: patch.state === "ready" ? true : patch.state === "not-installed" ? false : model.installed,
							verified: patch.state === "ready" ? true : patch.state === "not-installed" ? false : model.verified,
						}
					: model,
			)
			return { ...current, models }
		})
	}, [])

	// Live progress: one stream subscription while the panel is open.
	useEffect(() => {
		if (!enabled) {
			return
		}
		const unsubscribe = VoiceServiceClient.subscribeToVoiceEvents(EmptyRequest.create(), {
			onResponse: (event: VoiceEvent) => {
				if (!event.modelId) return
				if (event.kind === "modelDownloadProgress") {
					patchModel(event.modelId, { state: "downloading", progressPercent: event.progressPercent })
					return
				}
				if (event.kind === "modelStatusChanged") {
					patchModel(event.modelId, {
						state: event.modelState,
						progressPercent: event.progressPercent,
						errorCode: event.code,
					})
					// A terminal transition (ready / failed / removed) can also change
					// `transcribeReady`, so re-read the composed status once.
					if (event.modelState !== "downloading" && event.modelState !== "verifying") {
						refresh()
					}
				}
			},
			onError: () => {
				// The events stream is an optimisation; the panel still works without it.
			},
			onComplete: () => {},
		})
		return unsubscribe
	}, [enabled, patchModel, refresh])

	return { status, loading, errorCode, refresh, patchModel }
}
