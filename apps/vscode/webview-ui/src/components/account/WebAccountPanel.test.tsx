import { fireEvent, render, screen } from "@testing-library/react"
import type { FormEventHandler, PropsWithChildren, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	startSignup: vi.fn(),
	startSignin: vi.fn(),
	signIn: vi.fn(),
	signOut: vi.fn(),
	setKeepSignedIn: vi.fn(),
	accountState: {
		user: null as { id: string; email: string } | null,
		ready: true,
		sessionExpired: false,
		keepSignedIn: true,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ environment: "production" }),
}))

vi.mock("@/context/WebAccountContext", () => ({
	useWebAccount: () => ({
		...mocks.accountState,
		setKeepSignedIn: mocks.setKeepSignedIn,
		signIn: mocks.signIn,
		signOut: mocks.signOut,
		startSignup: mocks.startSignup,
		startSignin: mocks.startSignin,
	}),
}))

vi.mock("@/components/common/ViewHeader", () => ({
	default: ({ title, onDone }: { title: string; onDone: () => void }) => (
		<div>
			<span>{title}</span>
			<button onClick={onDone} type="button">
				Close header
			</button>
		</div>
	),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({
		children,
		onClick,
		disabled,
		type,
	}: PropsWithChildren<{
		onClick?: () => void
		disabled?: boolean
		type?: "button" | "submit"
	}>) => (
		<button disabled={disabled} onClick={onClick} type={type ?? "button"}>
			{children}
		</button>
	),
	VSCodeCheckbox: ({
		children,
		checked,
		onChange,
	}: PropsWithChildren<{
		checked?: boolean
		onChange?: FormEventHandler<HTMLInputElement>
	}>) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
	VSCodeLink: ({ children, href }: { children?: ReactNode; href?: string }) => <a href={href}>{children}</a>,
}))

import { WebAccountPanel } from "./WebAccountPanel"

function submitSignInForm(): void {
	fireEvent.submit(screen.getByRole("button", { name: "Sign in" }).closest("form") as HTMLFormElement)
}

describe("WebAccountPanel", () => {
	beforeEach(() => {
		mocks.accountState = { user: null, ready: true, keepSignedIn: true }
		mocks.signIn.mockReset()
		mocks.signOut.mockReset()
		mocks.setKeepSignedIn.mockClear()
		mocks.startSignup.mockReset()
		mocks.startSignin.mockReset()
	})

	it("renders the sign-in form for a signed-out visitor", () => {
		render(<WebAccountPanel onDone={vi.fn()} />)

		expect(screen.getByText("Sign in to Bytos")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("you@example.com")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("Your password")).toBeInTheDocument()
		expect(screen.getByLabelText(/Keep me signed in on this device/)).toBeChecked()
		expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Sign up" })).toBeInTheDocument()
		expect(screen.getByRole("link", { name: "bytos.dev/signup" })).toHaveAttribute("href", "https://bytos.dev/signup")
		expect(screen.getByRole("link", { name: "Sign in on bytos.dev" })).toHaveAttribute("href", "https://bytos.dev/signin")
	})

	it("starts the secure sign-up handoff from the Sign up button", () => {
		render(<WebAccountPanel onDone={vi.fn()} />)

		fireEvent.click(screen.getByRole("button", { name: "Sign up" }))

		expect(mocks.startSignup).toHaveBeenCalledTimes(1)
	})

	it("starts the secure sign-in handoff from the web sign-in button", () => {
		render(<WebAccountPanel onDone={vi.fn()} />)

		fireEvent.click(screen.getByRole("button", { name: "Sign in on the web" }))

		expect(mocks.startSignin).toHaveBeenCalledTimes(1)
	})

	it("passes the keep-signed-in choice to the account context", () => {
		render(<WebAccountPanel onDone={vi.fn()} />)

		fireEvent.click(screen.getByLabelText(/Keep me signed in on this device/))

		expect(mocks.setKeepSignedIn).toHaveBeenCalledWith(false)
	})

	it("validates the email before calling sign in", () => {
		render(<WebAccountPanel onDone={vi.fn()} />)

		fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "not-an-email" } })
		fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "secret" } })
		submitSignInForm()

		expect(mocks.signIn).not.toHaveBeenCalled()
		expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email address.")
	})

	it("signs in with the trimmed email and password", async () => {
		mocks.signIn.mockResolvedValue(undefined)
		render(<WebAccountPanel onDone={vi.fn()} />)

		fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: " user@example.com " } })
		fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "secret" } })
		submitSignInForm()

		await vi.waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("user@example.com", "secret"))
		await vi.waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled())
	})

	it("shows the local account error when sign in fails", async () => {
		mocks.signIn.mockRejectedValue(new Error("Invalid login credentials"))
		render(<WebAccountPanel onDone={vi.fn()} />)

		fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "user@example.com" } })
		fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "wrong" } })
		submitSignInForm()

		await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid login credentials"))
		await vi.waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled())
	})

	it("renders the signed-in state with a log out action", async () => {
		mocks.accountState = { ...mocks.accountState, user: { id: "user-1", email: "user@example.com" } }
		mocks.signOut.mockResolvedValue(undefined)
		render(<WebAccountPanel onDone={vi.fn()} />)

		expect(screen.getByText("Signed in")).toBeInTheDocument()
		expect(screen.getByText("user@example.com")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: "Log out" }))

		await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1))
		await vi.waitFor(() => expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled())
	})

	it("shows a loading state until the stored session is resolved", () => {
		mocks.accountState = { ...mocks.accountState, ready: false }
		render(<WebAccountPanel onDone={vi.fn()} />)

		expect(screen.getByText(/Loading account/)).toBeInTheDocument()
		expect(screen.queryByText("Sign in to Bytos")).not.toBeInTheDocument()
	})

	it("lets the user continue without an account (BYOK)", () => {
		const onDone = vi.fn()
		render(<WebAccountPanel onDone={onDone} />)

		fireEvent.click(screen.getByRole("button", { name: "Continue without an account" }))

		expect(onDone).toHaveBeenCalledTimes(1)
	})

	it("tells the user to sign in again when their session expired", () => {
		mocks.accountState = { ...mocks.accountState, sessionExpired: true }
		render(<WebAccountPanel onDone={vi.fn()} />)

		expect(screen.getByText(/Your Bytos session expired/)).toBeInTheDocument()
	})

	it("does not claim a session is expired for a first-time visitor", () => {
		render(<WebAccountPanel onDone={vi.fn()} />)

		expect(screen.queryByText(/Your Bytos session expired/)).not.toBeInTheDocument()
	})
})
