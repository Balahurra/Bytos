import { Empty, type EmptyRequest } from "@shared/proto/bytos/common"
import { SupabaseAccountService } from "@/services/auth/supabaseAccountService"
import type { Controller } from "../index"

export async function supabaseSignOut(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	// Signing out with no bound SecretStorage is already a signed-out state; it
	// must never throw, so a webview in a host without SecretStorage can always
	// clear its local view.
	if (SupabaseAccountService.isInitialized()) {
		await SupabaseAccountService.getInstance().signOut()
	}
	return Empty.create({})
}
