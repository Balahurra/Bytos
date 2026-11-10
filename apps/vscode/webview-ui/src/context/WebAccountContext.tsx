import type { AuthState } from "@shared/proto/bytos/account"
import { SupabaseSignInRequest, SupabaseSignupRequest } from "@shared/proto/bytos/account"
import { EmptyRequest } from "@shared/proto/bytos/common"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "./ExtensionStateContext"

const KEEP_SIGNED_IN_KEY = "bytos.account.keepSignedIn"

export interface WebAccountUser {
	id: string
	email: string
}

export interface WebAccountContextValue {
	user: WebAccountUser | null
	ready: boolean
	/** True when a stored session was discarded because refresh failed. */
	sessionExpired: boolean
	keepSignedIn: boolean
	setKeepSignedIn: (value: boolean) => void
	signIn: (email: string, password: string) => Promise<void>
	startSignup: () => Promise<void>
	startSignin: () => Promise<void>
	signOut: () => Promise<void>
	refresh: () => Promise<void>
}

export const WebAccountContext = createContext<WebAccountContextValue | undefined>(undefined)

function toUser(state: AuthState): WebAccountUser | null {
	const user = state.user
	if (!user?.uid) return null
	return { id: user.uid, email: user.email ?? "" }
}

export const WebAccountProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const { supabaseUser } = useExtensionState()
	const [user, setUser] = useState<WebAccountUser | null>(null)
	const userRef = useRef<WebAccountUser | null>(null)
	const previousSupabaseUserRef = useRef<string | undefined>(undefined)
	const [ready, setReady] = useState(false)
	const [sessionExpired, setSessionExpired] = useState(false)
	const [keepSignedIn, setKeepSignedInState] = useState(() => {
		try {
			return window.localStorage.getItem(KEEP_SIGNED_IN_KEY) !== "false"
		} catch {
			return true
		}
	})

	const applyHostState = useCallback(async () => {
		const hadUser = Boolean(userRef.current)
		try {
			const state = await AccountServiceClient.getSupabaseAuthState(EmptyRequest.create())
			const next = toUser(state)
			setUser(next)
			// A null result while a session existed is the "expired" signal; the
			// host already cleared SecretStorage in that case.
			if (!next && hadUser) setSessionExpired(true)
		} catch {
			setUser(null)
		} finally {
			setReady(true)
		}
	}, [])

	useEffect(() => {
		userRef.current = user
	}, [user])

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const state = await AccountServiceClient.getSupabaseAuthState(EmptyRequest.create())
				if (!cancelled) setUser(toUser(state))
			} catch {
				if (!cancelled) setUser(null)
			} finally {
				if (!cancelled) setReady(true)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	// The host pushes non-secret user state after a URI handoff; the webview
	// never receives or stores the Supabase tokens.
	useEffect(() => {
		if (supabaseUser?.uid) {
			previousSupabaseUserRef.current = supabaseUser.uid
			setUser({ id: supabaseUser.uid, email: supabaseUser.email ?? "" })
			setSessionExpired(false)
			return
		}
		// A first snapshot without a user is a cold host cache, not a sign-out.
		// Only clear once the host has actually reported a user before, so the
		// navbar bell comes back when a live session is dropped.
		if (previousSupabaseUserRef.current) {
			previousSupabaseUserRef.current = undefined
			setUser(null)
			setSessionExpired(true)
		}
	}, [supabaseUser])

	const setKeepSignedIn = useCallback((value: boolean) => {
		setKeepSignedInState(value)
		try {
			window.localStorage.setItem(KEEP_SIGNED_IN_KEY, String(value))
		} catch {
			// preference persistence is best-effort
		}
	}, [])

	const signIn = useCallback(
		async (email: string, password: string) => {
			const state = await AccountServiceClient.supabaseSignIn(
				SupabaseSignInRequest.create({ email: email.trim(), password, keepSignedIn }),
			)
			setUser(toUser(state))
		},
		[keepSignedIn],
	)

	const startSignup = useCallback(async () => {
		await AccountServiceClient.supabaseStartSignup(SupabaseSignupRequest.create({ keepSignedIn }))
	}, [keepSignedIn])

	const startSignin = useCallback(async () => {
		await AccountServiceClient.supabaseStartSignin(SupabaseSignupRequest.create({ keepSignedIn }))
	}, [keepSignedIn])

	const signOut = useCallback(async () => {
		await AccountServiceClient.supabaseSignOut(EmptyRequest.create())
		setUser(null)
		setSessionExpired(false)
	}, [])

	const refresh = useCallback(async () => {
		setSessionExpired(false)
		await applyHostState()
	}, [applyHostState])

	const value = useMemo<WebAccountContextValue>(
		() => ({
			user,
			ready,
			sessionExpired,
			keepSignedIn,
			setKeepSignedIn,
			signIn,
			startSignup,
			startSignin,
			signOut,
			refresh,
		}),
		[user, ready, sessionExpired, keepSignedIn, setKeepSignedIn, signIn, startSignup, startSignin, signOut, refresh],
	)

	return <WebAccountContext.Provider value={value}>{children}</WebAccountContext.Provider>
}

export const useWebAccount = (): WebAccountContextValue => {
	const context = useContext(WebAccountContext)
	if (!context) throw new Error("useWebAccount must be used within a WebAccountProvider")
	return context
}
