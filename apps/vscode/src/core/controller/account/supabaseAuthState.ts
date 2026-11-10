import { AuthState, UserInfo } from "@shared/proto/bytos/account"
import type { SupabaseAccountUser } from "@/services/auth/supabaseAccountService"

export function toSupabaseAuthState(user: SupabaseAccountUser | null): AuthState {
	if (!user) return AuthState.create({})
	return AuthState.create({
		user: UserInfo.create({
			uid: user.uid,
			email: user.email,
			displayName: user.displayName,
			photoUrl: user.photoUrl,
		}),
	})
}
