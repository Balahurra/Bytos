import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	getSupabaseAuthState: vi.fn(),
	supabaseSignIn: vi.fn(),
	supabaseStartSignup: vi.fn(),
	supabaseStartSignin: vi.fn(),
	supabaseSignOut: vi.fn(),
	extensionState: { supabaseUser: undefined as { uid: string; email?: string } | undefined },
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getSupabaseAuthState: mocks.getSupabaseAuthState,
		supabaseSignIn: mocks.supabaseSignIn,
		supabaseStartSignup: mocks.supabaseStartSignup,
		supabaseStartSignin: mocks.supabaseStartSignin,
		supabaseSignOut: mocks.supabaseSignOut,
	},
}))

vi.mock("./ExtensionStateContext", () => ({
	useExtensionState: () => mocks.extensionState,
}))

import { useWebAccount, WebAccountProvider } from "./WebAccountContext"

class MemoryStorage {
	private readonly map = new Map<string, string>()

	get length(): number {
		return this.map.size
	}

	clear(): void {
		this.map.clear()
	}

	getItem(key: string): string | null {
		return this.map.get(key) ?? null
	}

	key(index: number): string | null {
		return [...this.map.keys()][index] ?? null
	}

	removeItem(key: string): void {
		this.map.delete(key)
	}

	setItem(key: string, value: string): void {
		this.map.set(key, String(value))
	}
}

Object.defineProperty(window, "localStorage", { configurable: true, value: new MemoryStorage() })

function Probe() {
	const { user, ready, sessionExpired, keepSignedIn, setKeepSignedIn, signIn, startSignup, startSignin, signOut, refresh } =
		useWebAccount()
	const [error, setError] = useState("")

	return (
		<div>
			<span data-testid="ready">{String(ready)}</span>
			<span data-testid="user">{user?.email ?? "none"}</span>
			<span data-testid="expired">{String(sessionExpired)}</span>
			<span data-testid="keep">{String(keepSignedIn)}</span>
			<span data-testid="error">{error}</span>
			<button onClick={() => setKeepSignedIn(!keepSignedIn)} type="button">
				toggle keep
			</button>
			<button
				onClick={async () => {
					try {
						await signIn("user@example.com", "secret")
					} catch (signInError) {
						setError(signInError instanceof Error ? signInError.message : "error")
					}
				}}
				type="button">
				sign in
			</button>
			<button onClick={() => void startSignup()} type="button">
				sign up
			</button>
			<button onClick={() => void startSignin()} type="button">
				sign in on web
			</button>
			<button onClick={() => void signOut()} type="button">
				sign out
			</button>
			<button onClick={() => void refresh()} type="button">
				refresh
			</button>
		</div>
	)
}

function renderProvider() {
	return render(
		<WebAccountProvider>
			<Probe />
		</WebAccountProvider>,
	)
}

describe("WebAccountContext", () => {
	beforeEach(() => {
		window.localStorage.clear()
		mocks.extensionState = { supabaseUser: undefined }
		mocks.getSupabaseAuthState.mockReset()
		mocks.supabaseSignIn.mockReset()
		mocks.supabaseStartSignup.mockReset()
		mocks.supabaseStartSignin.mockReset()
		mocks.supabaseSignOut.mockReset()
		mocks.getSupabaseAuthState.mockResolvedValue({})
		mocks.supabaseSignIn.mockResolvedValue({ user: { uid: "user-1", email: "user@example.com" } })
		mocks.supabaseStartSignup.mockResolvedValue({ value: "https://bytos.dev/signup" })
		mocks.supabaseStartSignin.mockResolvedValue({ value: "https://bytos.dev/signin" })
		mocks.supabaseSignOut.mockResolvedValue({})
	})

	it("restores the host session state on mount", async () => {
		mocks.getSupabaseAuthState.mockResolvedValue({ user: { uid: "user-1", email: "user@example.com" } })
		renderProvider()

		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))
		expect(screen.getByTestId("user")).toHaveTextContent("user@example.com")
		expect(mocks.getSupabaseAuthState).toHaveBeenCalledTimes(1)
	})

	it("signs in through the host and reflects the returned user", async () => {
		renderProvider()
		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))

		fireEvent.click(screen.getByRole("button", { name: "sign in" }))

		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("user@example.com"))
		expect(mocks.supabaseSignIn).toHaveBeenCalledWith(
			expect.objectContaining({ email: "user@example.com", password: "secret", keepSignedIn: true }),
		)
	})

	it("starts signup with the keep-signed-in preference", async () => {
		renderProvider()
		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))
		fireEvent.click(screen.getByRole("button", { name: "toggle keep" }))
		await waitFor(() => expect(screen.getByTestId("keep")).toHaveTextContent("false"))

		fireEvent.click(screen.getByRole("button", { name: "sign up" }))

		await waitFor(() =>
			expect(mocks.supabaseStartSignup).toHaveBeenCalledWith(expect.objectContaining({ keepSignedIn: false })),
		)
		expect(window.localStorage.getItem("bytos.account.keepSignedIn")).toBe("false")
	})

	it("starts web sign-in through the host", async () => {
		renderProvider()
		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))

		fireEvent.click(screen.getByRole("button", { name: "sign in on web" }))

		await waitFor(() =>
			expect(mocks.supabaseStartSignin).toHaveBeenCalledWith(expect.objectContaining({ keepSignedIn: true })),
		)
	})

	it("signs out through the host", async () => {
		mocks.getSupabaseAuthState.mockResolvedValue({ user: { uid: "user-1", email: "user@example.com" } })
		renderProvider()
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("user@example.com"))

		fireEvent.click(screen.getByRole("button", { name: "sign out" }))

		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"))
		expect(mocks.supabaseSignOut).toHaveBeenCalledTimes(1)
	})

	it("adopts non-secret user state pushed by the host after a callback", async () => {
		const view = renderProvider()
		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))

		mocks.extensionState = { supabaseUser: { uid: "handoff-user", email: "handoff@example.com" } }
		view.rerender(
			<WebAccountProvider>
				<Probe />
			</WebAccountProvider>,
		)
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("handoff@example.com"))
	})

	it("flags an expired session when a known user disappears after a refresh", async () => {
		mocks.getSupabaseAuthState.mockResolvedValue({ user: { uid: "user-1", email: "user@example.com" } })
		renderProvider()
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("user@example.com"))
		expect(screen.getByTestId("expired")).toHaveTextContent("false")

		// The host now reports no session — the refresh token was rejected.
		mocks.getSupabaseAuthState.mockResolvedValue({})
		fireEvent.click(screen.getByRole("button", { name: "refresh" }))

		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"))
		expect(screen.getByTestId("expired")).toHaveTextContent("true")
	})

	it("does not flag an expired session for a visitor who never signed in", async () => {
		mocks.getSupabaseAuthState.mockResolvedValue({})
		renderProvider()
		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))

		fireEvent.click(screen.getByRole("button", { name: "refresh" }))

		await waitFor(() => expect(mocks.getSupabaseAuthState).toHaveBeenCalledTimes(2))
		expect(screen.getByTestId("expired")).toHaveTextContent("false")
	})

	it("clears the expired flag after a successful sign-in", async () => {
		mocks.getSupabaseAuthState.mockResolvedValue({ user: { uid: "user-1", email: "user@example.com" } })
		renderProvider()
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("user@example.com"))

		mocks.getSupabaseAuthState.mockResolvedValue({})
		fireEvent.click(screen.getByRole("button", { name: "refresh" }))
		await waitFor(() => expect(screen.getByTestId("expired")).toHaveTextContent("true"))

		fireEvent.click(screen.getByRole("button", { name: "sign in" }))
		await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("user@example.com"))
	})
})
