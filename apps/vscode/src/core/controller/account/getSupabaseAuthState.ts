import { AuthState } from "@shared/proto/bytos/account"
import type { EmptyRequest } from "@shared/proto/bytos/common"
import { SupabaseAccountService, SupabaseAccountServiceUnavailableError } from "@/services/auth/supabaseAccountService"
import type { Controller } from "../index"
import { toSupabaseAuthState } from "./supabaseAuthState"

export async function getSupabaseAuthState(_controller: Controller, _request: EmptyRequest): Promise<AuthState> {
	if (!SupabaseAccountService.isInitialized()) return AuthState.create({})
	try {
		const user = await SupabaseAccountService.getInstance().getState()
		return toSupabaseAuthState(user)
	} catch (error) {
		// A host without SecretStorage (plain node, a booting webview) must show a
		// signed-out account instead of an INTERNAL gRPC error.
		if (error instanceof SupabaseAccountServiceUnavailableError) return AuthState.create({})
		throw error
	}
}
