import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/**
 * Contract test across the seam the audit found broken (B-2):
 * `ExtensionStateContext` must expose `supabaseUser`, and `WebAccountContext`
 * must adopt it. This file deliberately does NOT mock `ExtensionStateContext`,
 * so it fails if `supabaseUser` is dropped from the context value again.
 *
 * Only the gRPC transport is stubbed, because there is no extension host here.
 */

const grpc = vi.hoisted(() => ({
	subscribeToState: vi.fn(),
	getSupabaseAuthState: vi.fn(),
	onResponse: null as null | ((payload: { stateJson: string }) => void),
}))

vi.mock("@/services/grpc-client", () => {
	// Some call sites take the return value as a synchronous unsubscribe function
	// (`subscribeToMcpButtonClicked(req, cb)`), while unary call sites chain
	// `.then().catch()` on it. A callable object that also proxies a real Promise
	// satisfies both shapes.
	const streamMethod =
		() =>
		(..._args: unknown[]) => {
			const inner = Promise.resolve({ user: undefined })
			const callable = (() => {}) as unknown as Record<string, unknown>
			callable.then = inner.then.bind(inner)
			callable.catch = inner.catch.bind(inner)
			callable.finally = inner.finally.bind(inner)
			callable.unsubscribe = () => {}
			return callable
		}

	const streamTwin = (overrides: Record<string, unknown>) =>
		new Proxy(overrides, { get: (t, p) => (p in t ? Reflect.get(t, p) : streamMethod()) })

	const module: Record<string, unknown> = {
		StateServiceClient: streamTwin({
			subscribeToState: (_req: unknown, callbacks: { onResponse: (p: { stateJson: string }) => void }) => {
				grpc.onResponse = callbacks.onResponse
				return () => {}
			},
		}),
		AccountServiceClient: streamTwin({ getSupabaseAuthState: grpc.getSupabaseAuthState }),
		UiServiceClient: streamTwin({}),
		ModelsServiceClient: streamTwin({}),
		McpServiceClient: streamTwin({}),
		SlashServiceClient: streamTwin({}),
		WebServiceClient: streamTwin({}),
		FileServiceClient: streamTwin({}),
		CheckpointsServiceClient: streamTwin({}),
		TaskServiceClient: streamTwin({}),
	}
	return module
})

import { ExtensionStateContextProvider, useExtensionState } from "./ExtensionStateContext"
import { useWebAccount, WebAccountProvider } from "./WebAccountContext"

function Probe() {
	const { supabaseUser } = useExtensionState()
	const account = useWebAccount()
	return (
		<div>
			<span data-testid="context-user">{supabaseUser?.uid ?? "none"}</span>
			<span data-testid="account-user">{account.user?.id ?? "none"}</span>
			<span data-testid="account-email">{account.user?.email ?? "none"}</span>
			<span data-testid="ready">{String(account.ready)}</span>
		</div>
	)
}

function emitState(partial: Record<string, unknown>): void {
	act(() => {
		grpc.onResponse?.({ stateJson: JSON.stringify({ version: "test", ...partial }) })
	})
}

describe("ExtensionStateContext -> WebAccountContext contract", () => {
	it("exposes supabaseUser on the real context value", async () => {
		grpc.getSupabaseAuthState.mockResolvedValue({})
		render(
			<ExtensionStateContextProvider>
				<WebAccountProvider>
					<Probe />
				</WebAccountProvider>
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))

		emitState({ supabaseUser: { uid: "user-42", email: "user@example.com" } })

		await waitFor(() => expect(screen.getByTestId("context-user")).toHaveTextContent("user-42"))
	})

	it("makes WebAccountContext adopt the supabaseUser the host pushes", async () => {
		grpc.getSupabaseAuthState.mockResolvedValue({})
		render(
			<ExtensionStateContextProvider>
				<WebAccountProvider>
					<Probe />
				</WebAccountProvider>
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(screen.getByTestId("ready")).toHaveTextContent("true"))
		expect(screen.getByTestId("account-user")).toHaveTextContent("none")

		emitState({ supabaseUser: { uid: "user-42", email: "user@example.com" } })

		await waitFor(() => expect(screen.getByTestId("account-user")).toHaveTextContent("user-42"))
		expect(screen.getByTestId("account-email")).toHaveTextContent("user@example.com")
	})
})
