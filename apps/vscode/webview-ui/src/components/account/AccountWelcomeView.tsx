import { VSCodeButton, VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { BytosAuthStatus } from "@/components/account/BytosAuthStatus"
import { useBytosSignIn } from "@/context/BytosAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import BytosLogoVariable from "../../assets/BytosLogoVariable"

/**
 * Signed-out account view. The Bytos account is optional: the extension can be
 * used with a provider API key without signing in. Signing in links the
 * extension to the Bytos website account for profile, usage, and support.
 */
export const AccountWelcomeView = () => {
	const { environment } = useExtensionState()
	const { isLoginLoading, authStatusMessage, handleSignIn } = useBytosSignIn()

	return (
		<div className="flex flex-col items-center gap-2.5">
			<BytosLogoVariable className="size-16 mb-4" environment={environment} />

			<p className="text-center m-0">
				A Bytos account is optional. You can keep using Bytos with your own provider API keys without signing in.
			</p>
			<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
				Signing in connects this editor to your Bytos website account so you can manage your profile and see
				account-related usage. The extension and the website share the same Supabase authentication session.
			</p>

			<VSCodeButton className="w-full mb-2" disabled={isLoginLoading} onClick={handleSignIn}>
				Sign in or create a Bytos account
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>

			<BytosAuthStatus message={authStatusMessage} />

			<VSCodeDivider className="w-full my-2" />

			<div className="w-full text-(--vscode-descriptionForeground) text-xs">
				<div className="font-semibold text-foreground mb-1">Privacy and data</div>
				<p className="m-0 mb-2">
					Bytos processes your email address, profile fields, and account/session data through Supabase Auth and the
					Bytos API. The extension sends model requests only to the provider you configure; it does not proxy them
					through Bytos unless you explicitly select a Bytos-hosted provider.
				</p>
				<p className="m-0 mb-2">
					Account deletion is performed on the Bytos website. Open the account page to review what is stored and to
					permanently delete your account and profile.
				</p>
				<p className="m-0 flex flex-wrap gap-x-2 gap-y-1">
					<VSCodeLink href="https://bytos.dev/privacy">Privacy Policy</VSCodeLink>
					<span aria-hidden="true">·</span>
					<VSCodeLink href="https://bytos.dev/terms">Terms of Service</VSCodeLink>
					<span aria-hidden="true">·</span>
					<VSCodeLink href="https://bytos.dev/account">Manage or delete account</VSCodeLink>
				</p>
			</div>
		</div>
	)
}
