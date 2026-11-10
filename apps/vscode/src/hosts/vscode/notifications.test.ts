import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

const mocks = vi.hoisted(() => ({
	isInitialized: vi.fn(),
	getCachedUser: vi.fn(),
	getState: vi.fn(),
	startSignin: vi.fn(),
	startSignup: vi.fn(),
}))

vi.mock("@/services/auth/supabaseAccountService", () => ({
	SupabaseAccountService: {
		isInitialized: mocks.isInitialized,
		getInstance: () => ({
			getCachedUser: mocks.getCachedUser,
			getState: mocks.getState,
			startSignin: mocks.startSignin,
			startSignup: mocks.startSignup,
		}),
	},
}))

import { showBytosNotifications } from "./notifications"

describe("showBytosNotifications", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		vi.clearAllMocks()
		mocks.isInitialized.mockReturnValue(true)
		mocks.getCachedUser.mockReturnValue(null)
		mocks.getState.mockResolvedValue(null)
		mocks.startSignin.mockResolvedValue(undefined)
		mocks.startSignup.mockResolvedValue(undefined)
	})

	it("shows the account reminder with sign-in, sign-up and Bytos.dev actions", async () => {
		const show = vi.spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined)

		await showBytosNotifications()

		expect(show).toHaveBeenCalledWith("Sign in to Bytos to unlock more features!", "Sign in", "Sign up", "Bytos.dev")
	})

	it("starts the web sign-in handoff from the notification", async () => {
		vi.spyOn(vscode.window, "showInformationMessage")
			.mockResolvedValueOnce("Sign in" as never)
			.mockResolvedValue(undefined)

		await showBytosNotifications()

		expect(mocks.startSignin).toHaveBeenCalledTimes(1)
		expect(mocks.startSignup).not.toHaveBeenCalled()
	})

	it("starts the web sign-up handoff from the notification", async () => {
		vi.spyOn(vscode.window, "showInformationMessage")
			.mockResolvedValueOnce("Sign up" as never)
			.mockResolvedValue(undefined)

		await showBytosNotifications()

		expect(mocks.startSignup).toHaveBeenCalledTimes(1)
		expect(mocks.startSignin).not.toHaveBeenCalled()
	})

	it("opens the Bytos homepage from the notification", async () => {
		const openExternal = vi.spyOn(vscode.env, "openExternal").mockResolvedValue(true)
		vi.spyOn(vscode.window, "showInformationMessage")
			.mockResolvedValueOnce("Bytos.dev" as never)
			.mockResolvedValue(undefined)

		await showBytosNotifications()

		expect(openExternal).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "https://bytos.dev" }))
	})

	it("restores a stored session before deciding the bell has no notification", async () => {
		mocks.getState.mockResolvedValue({ uid: "user-1", email: "user@example.com" })
		const show = vi.spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined)

		await showBytosNotifications()

		expect(mocks.getState).toHaveBeenCalledTimes(1)
		expect(show).toHaveBeenCalledWith("No new notifications.")
	})

	it("shows no account reminder when the cached session is signed in", async () => {
		mocks.getCachedUser.mockReturnValue({ uid: "user-1", email: "user@example.com" })
		const show = vi.spyOn(vscode.window, "showInformationMessage").mockResolvedValue(undefined)

		await showBytosNotifications()

		expect(show).toHaveBeenCalledTimes(1)
		expect(show).toHaveBeenCalledWith("No new notifications.")
	})

	it("reports a handoff failure without leaving the notification stuck", async () => {
		mocks.startSignin.mockRejectedValue(new Error("Could not open the browser."))
		vi.spyOn(vscode.window, "showInformationMessage")
			.mockResolvedValueOnce("Sign in" as never)
			.mockResolvedValue(undefined)
		const showError = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)

		await showBytosNotifications()

		expect(showError).toHaveBeenCalledWith("Could not open the browser.")
	})
})
