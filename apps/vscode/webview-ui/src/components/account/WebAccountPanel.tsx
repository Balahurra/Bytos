import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { type FormEvent, useState } from "react"
import ViewHeader from "@/components/common/ViewHeader"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useWebAccount } from "@/context/WebAccountContext"

const SIGN_IN_URL = "https://bytos.dev/signin"
const SIGN_UP_URL = "https://bytos.dev/signup"

export const WebAccountPanel = ({ onDone }: { onDone: () => void }) => {
	const { environment } = useExtensionState()
	const { user, ready, sessionExpired, keepSignedIn, setKeepSignedIn, signIn, signOut, startSignup, startSignin } =
		useWebAccount()
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [busy, setBusy] = useState(false)
	const [signupBusy, setSignupBusy] = useState(false)
	const [signinBusy, setSigninBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setError(null)

		const normalizedEmail = email.trim()
		if (!normalizedEmail || !normalizedEmail.includes("@")) {
			setError("Enter a valid email address.")
			return
		}
		if (!password) {
			setError("Enter your password.")
			return
		}

		setBusy(true)
		try {
			await signIn(normalizedEmail, password)
			setPassword("")
		} catch (signInError) {
			setError(signInError instanceof Error ? signInError.message : "Sign in failed. Please try again.")
		} finally {
			setBusy(false)
		}
	}

	const handleSignOut = async () => {
		setBusy(true)
		try {
			await signOut()
			setPassword("")
			setError(null)
		} finally {
			setBusy(false)
		}
	}

	const handleWebSignin = async () => {
		setError(null)
		setNotice(null)
		setSigninBusy(true)
		try {
			await startSignin()
			setNotice("Complete sign-in in your browser; VS Code will finish signing you in automatically.")
		} catch (signinError) {
			setError(signinError instanceof Error ? signinError.message : "Could not start sign-in. Please try again.")
		} finally {
			setSigninBusy(false)
		}
	}

	const handleSignup = async () => {
		setError(null)
		setNotice(null)
		setSignupBusy(true)
		try {
			await startSignup()
			setNotice("Complete sign-up in your browser; VS Code will finish signing you in automatically.")
		} catch (signupError) {
			setError(signupError instanceof Error ? signupError.message : "Could not start sign-up. Please try again.")
		} finally {
			setSignupBusy(false)
		}
	}

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden">
			<ViewHeader environment={environment} onDone={onDone} showEnvironmentSuffix title="Account" />
			<div className="grow flex flex-col px-5 overflow-y-auto">
				{!ready ? (
					<div className="flex h-full items-center justify-center text-(--vscode-descriptionForeground)">
						Loading account...
					</div>
				) : user ? (
					<div className="flex flex-col gap-5 max-w-[520px] w-full mx-auto pt-2">
						<div className="rounded-md border border-(--vscode-panel-border) p-5 flex flex-col gap-3">
							<div className="flex items-center gap-3">
								<div className="size-12 rounded-full bg-(--vscode-button-background) text-(--vscode-button-foreground) flex items-center justify-center text-xl">
									{user.email.charAt(0).toUpperCase()}
								</div>
								<div className="min-w-0">
									<div className="text-base font-medium">Signed in</div>
									<div className="text-sm text-(--vscode-descriptionForeground) truncate">{user.email}</div>
								</div>
							</div>
							<p className="text-sm text-(--vscode-descriptionForeground) m-0">
								Your Bytos account is connected. You can keep working, or sign out below.
							</p>
							<div className="flex gap-2">
								<VSCodeButton appearance="secondary" disabled={busy} onClick={handleSignOut}>
									{busy ? "Signing out..." : "Log out"}
								</VSCodeButton>
								<VSCodeButton appearance="primary" onClick={onDone}>
									Done
								</VSCodeButton>
							</div>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-4 max-w-[520px] w-full mx-auto pt-2">
						<div>
							<h2 className="text-lg font-medium m-0">Sign in to Bytos</h2>
							<p className="text-sm text-(--vscode-descriptionForeground) mt-1 mb-0">
								Use the email and password for your bytos.dev account.
							</p>
						</div>

						{sessionExpired && (
							<p className="text-sm text-(--vscode-errorForeground) m-0" role="alert">
								Your Bytos session expired. Sign in again to reconnect your account.
							</p>
						)}

						<form className="flex flex-col gap-3" onSubmit={handleSubmit}>
							<label className="flex flex-col gap-1 text-sm">
								<span>Email</span>
								<input
									autoComplete="email"
									className="w-full box-border rounded-sm border border-(--vscode-input-border) bg-(--vscode-input-background) text-(--vscode-input-foreground) px-2 py-1.5 text-sm outline-none focus:border-(--vscode-focusBorder)"
									onChange={(event) => setEmail(event.target.value)}
									placeholder="you@example.com"
									type="email"
									value={email}
								/>
							</label>

							<label className="flex flex-col gap-1 text-sm">
								<span>Password</span>
								<input
									autoComplete="current-password"
									className="w-full box-border rounded-sm border border-(--vscode-input-border) bg-(--vscode-input-background) text-(--vscode-input-foreground) px-2 py-1.5 text-sm outline-none focus:border-(--vscode-focusBorder)"
									onChange={(event) => setPassword(event.target.value)}
									placeholder="Your password"
									type="password"
									value={password}
								/>
							</label>

							<div className="flex items-center">
								<VSCodeCheckbox
									checked={keepSignedIn}
									onChange={(event) => setKeepSignedIn((event.target as HTMLInputElement).checked)}>
									Keep me signed in on this device
								</VSCodeCheckbox>
							</div>

							{error && (
								<p className="text-sm text-(--vscode-errorForeground) m-0" role="alert">
									{error}
								</p>
							)}
							{notice && (
								<p className="text-sm text-(--vscode-descriptionForeground) m-0" role="status">
									{notice}
								</p>
							)}

							<VSCodeButton appearance="primary" disabled={busy} type="submit">
								{busy ? "Signing in..." : "Sign in"}
							</VSCodeButton>
						</form>

						<div className="flex flex-col gap-2 border-t border-(--vscode-panel-border) pt-4">
							<VSCodeButton appearance="secondary" disabled={signupBusy} onClick={handleSignup}>
								{signupBusy ? "Opening browser..." : "Sign up"}
							</VSCodeButton>
							<VSCodeButton appearance="secondary" disabled={signinBusy} onClick={handleWebSignin}>
								{signinBusy ? "Opening browser..." : "Sign in on the web"}
							</VSCodeButton>
							<p className="text-xs text-(--vscode-descriptionForeground) m-0">
								Need to create your account? Use Sign up, or visit{" "}
								<VSCodeLink href={SIGN_UP_URL}>bytos.dev/signup</VSCodeLink>.
							</p>
							<p className="text-xs text-(--vscode-descriptionForeground) m-0">
								Prefer the web? <VSCodeLink href={SIGN_IN_URL}>Sign in on bytos.dev</VSCodeLink>.
							</p>
						</div>

						<p className="text-(--vscode-descriptionForeground) text-xs m-0">
							By continuing, you agree to the <VSCodeLink href="https://bytos.dev/tos">Terms of Service</VSCodeLink>{" "}
							and <VSCodeLink href="https://bytos.dev/privacy">Privacy Policy</VSCodeLink>.
						</p>

						<div className="border-t border-(--vscode-panel-border) pt-3 flex flex-col gap-1">
							<VSCodeButton appearance="secondary" onClick={onDone}>
								Continue without an account
							</VSCodeButton>
							<p className="text-xs text-(--vscode-descriptionForeground) m-0">
								Bytos works without an account. Use your own API key (BYOK) and skip this step any time.
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
