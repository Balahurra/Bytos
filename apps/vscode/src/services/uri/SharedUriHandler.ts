import fs from "fs/promises"
import { WebviewProvider } from "@/core/webview"
import { SupabaseAccountService } from "@/services/auth/supabaseAccountService"
import { WEB_AUTH_CALLBACK_PATH } from "@/services/auth/webHandoff"
import { writeLgWebhookConfig, writeLgWebhookHooks } from "@/services/lg-cns-integration/webhook-hooks"
import { Logger } from "@/shared/services/Logger"

export const TASK_URI_PATH = "/task"
export const LG_TASK_URI_PATH = "/lg-task"

export interface SharedUriHandlerOptions {
	/**
	 * Present only when the URI arrived through VS Code's own URI handler. The
	 * standalone HTTP callback server must not be able to claim the web account
	 * handoff path, so it never supplies this.
	 */
	webAuth?: {
		expectedScheme: string
		expectedAuthority: string
	}
}

/**
 * Shared URI handler that processes both VSCode URI events and HTTP server callbacks
 */
export class SharedUriHandler {
	/**
	 * Processes a URI and routes it to the appropriate handler
	 * @param url The URI to process (can be from VSCode or converted from HTTP)
	 * @returns Promise<boolean> indicating success (true) or failure (false)
	 */
	public static async handleUri(url: string, options: SharedUriHandlerOptions = {}): Promise<boolean> {
		const parsedUrl = new URL(url)
		const path = parsedUrl.pathname

		// The web account handoff is validated before the visible-webview check:
		// a browser callback may arrive while the sidebar is closed, and rejection
		// must not depend on UI state. A successful exchange stores tokens in
		// SecretStorage; only non-secret user state is pushed to the webview.
		if (path === WEB_AUTH_CALLBACK_PATH) {
			if (!options.webAuth) {
				Logger.warn("SharedUriHandler: Web account callback rejected outside the VS Code URI handler")
				return false
			}
			try {
				const result = await SupabaseAccountService.getInstance().handleCallback(url, options.webAuth)
				if (result.ok) {
					const visibleWebview = WebviewProvider.getVisibleInstance()
					if (visibleWebview) {
						await visibleWebview.controller.postStateToWebview()
					}
					Logger.info("[SharedUriHandler] Web account callback completed", {
						hasVisibleWebview: Boolean(visibleWebview),
					})
					return true
				}
				Logger.warn(`SharedUriHandler: Web account callback rejected (${result.reason})`)
				return false
			} catch (error) {
				Logger.error("SharedUriHandler: Web account callback failed:", error)
				return false
			}
		}

		// Create URLSearchParams from the query string, but preserve plus signs
		// by replacing them with a placeholder before parsing
		const queryString = parsedUrl.search.slice(1) // Remove leading '?'
		const query = new URLSearchParams(queryString.replace(/\+/g, "%2B"))

		Logger.info(
			"SharedUriHandler: Processing URI:" +
				JSON.stringify({
					path: path,
					query: query,
					scheme: parsedUrl.protocol,
				}),
		)

		const visibleWebview = WebviewProvider.getVisibleInstance()

		if (!visibleWebview) {
			Logger.warn("SharedUriHandler: No visible webview found")
			return false
		}

		try {
			switch (path) {
				case "/openrouter": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleOpenRouterCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for OpenRouter callback")
					return false
				}
				case "/requesty": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleRequestyCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for Requesty callback")
					return false
				}
				case "/auth": {
					// A1.3 security fix: the legacy Bytos account callback is disabled.
					// It accepted credential-shaped query parameters (code/idToken/refreshToken)
					// without state or PKCE, and this build has no producer for it. Fail closed
					// until an account-enabled build ships a dedicated /auth/callback flow with
					// state + PKCE. Do not treat idToken/refreshToken as authorization codes.
					Logger.warn("SharedUriHandler: /auth is disabled; no account authentication was performed")
					return false
				}
				case "/auth/oca": {
					Logger.log("SharedUriHandler: Oca Auth callback received:", { path: path })

					const code = query.get("code")
					const state = query.get("state")

					if (code && state) {
						await visibleWebview.controller.handleOcaAuthCallback(code, state)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for auth callback")
					return false
				}
				case TASK_URI_PATH: {
					const prompt = query.get("prompt")
					if (prompt) {
						await visibleWebview.controller.handleTaskCreation(prompt)
						return true
					}
					Logger.warn("SharedUriHandler: Missing prompt parameter for task creation")
					return false
				}
				case LG_TASK_URI_PATH: {
					const promptFile = query.get("prompt-file")
					const webhookUrl = query.get("webhook-url")
					const webhookToken = query.get("webhook-token")

					if (!promptFile || !webhookUrl || !webhookToken) {
						Logger.warn("SharedUriHandler: Missing required parameters for LG task creation")
						return false
					}

					const specContents = await fs.readFile(promptFile, "utf-8")
					const prompt = [
						`The following file contains the development specification you must implement: ${promptFile}`,
						"",
						"Start by reading that file from disk. If context compaction happens later, re-read the same file path so you can continue tracking progress against the original requirements.",
						"",
						"For convenience, here is the current file content:",
						"",
						specContents,
					].join("\n")
					await writeLgWebhookConfig(webhookUrl, webhookToken)
					await writeLgWebhookHooks()
					await visibleWebview.controller.handleTaskCreation(prompt)
					return true
				}
				case "/hicap": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleHicapCallback(code)
						return true
					}
					Logger.warn("SharedUriHandler: Missing code parameter for Hicap callback")
					return false
				}
				default:
					Logger.warn(`SharedUriHandler: Unknown path: ${path}`)
					return false
			}
		} catch (error) {
			Logger.error("SharedUriHandler: Error processing URI:", error)
			return false
		}
	}
}
