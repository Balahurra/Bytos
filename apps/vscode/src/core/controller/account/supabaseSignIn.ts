import { AuthState, SupabaseSignInRequest } from "@shared/proto/bytos/account"
import { SupabaseAccountService } from "@/services/auth/supabaseAccountService"
import type { Controller } from "../index"
import { toSupabaseAuthState } from "./supabaseAuthState"

export async function supabaseSignIn(_controller: Controller, request: SupabaseSignInRequest): Promise<AuthState> {
	// SecretStorage is only available in the VS Code extension host; without it
	// there is nowhere safe to put the session, so fail with an actionable
	// message instead of an opaque INTERNAL error.
	if (!SupabaseAccountService.isInitialized()) {
		throw new Error("Bytos account sign-in is only available inside VS Code.")
	}
	const user = await SupabaseAccountService.getInstance().signIn(request.email, request.password, request.keepSignedIn ?? true)
	return toSupabaseAuthState(user)
}
