import * as vscode from "vscode"
import { SupabaseAccountService } from "@/services/auth/supabaseAccountService"
import { Logger } from "@/shared/services/Logger"

export const BYTOS_HOME_URL = "https://bytos.dev"

type AccountHandoff = "signin" | "signup"

async function startAccountHandoff(kind: AccountHandoff): Promise<void> {
	if (!SupabaseAccountService.isInitialized()) {
		void vscode.window.showErrorMessage("Bytos account sign-in is unavailable in this host.")
		return
	}

	try {
		const service = SupabaseAccountService.getInstance()
		if (kind === "signin") {
			await service.startSignin()
		} else {
			await service.startSignup()
		}
		void vscode.window.showInformationMessage(
			kind === "signin"
				? "Complete sign-in in your browser; VS Code will finish signing you in automatically."
				: "Complete sign-up in your browser; VS Code will finish signing you in automatically.",
		)
	} catch (error) {
		Logger.error(`[Bytos] Could not start account ${kind}:`, error)
		void vscode.window.showErrorMessage(
			error instanceof Error ? error.message : "Could not start Bytos sign-in. Please try again.",
		)
	}
}

/**
 * Handles the Bytos title-bar bell. The account reminder is the only
 * notification today; the action list keeps the same entry point usable for
 * future marketplace and product notices.
 */
export async function showBytosNotifications(): Promise<void> {
	const service = SupabaseAccountService.isInitialized() ? SupabaseAccountService.getInstance() : undefined
	const cachedUser = service?.getCachedUser() ?? null
	const user = cachedUser ?? (service ? await service.getState().catch(() => null) : null)

	if (user) {
		void vscode.window.showInformationMessage("No new notifications.")
		return
	}

	const choice = await vscode.window.showInformationMessage(
		"Sign in to Bytos to unlock more features!",
		"Sign in",
		"Sign up",
		"Bytos.dev",
	)

	if (choice === "Sign in") {
		await startAccountHandoff("signin")
	} else if (choice === "Sign up") {
		await startAccountHandoff("signup")
	} else if (choice === "Bytos.dev") {
		await vscode.env.openExternal(vscode.Uri.parse(BYTOS_HOME_URL))
	}
}
