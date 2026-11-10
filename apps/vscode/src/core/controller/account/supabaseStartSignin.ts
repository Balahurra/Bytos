import { SupabaseSignupRequest } from "@shared/proto/bytos/account"
import { String } from "@shared/proto/bytos/common"
import { SupabaseAccountService } from "@/services/auth/supabaseAccountService"
import type { Controller } from "../index"

export async function supabaseStartSignin(_controller: Controller, request: SupabaseSignupRequest): Promise<String> {
	if (!SupabaseAccountService.isInitialized()) {
		throw new Error("Bytos account sign-in is only available inside VS Code.")
	}
	const url = await SupabaseAccountService.getInstance().startSignin(request.keepSignedIn ?? true)
	return String.create({ value: url })
}
