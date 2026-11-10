import type { BytosMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import { BytosAuthStatus } from "@/components/account/BytosAuthStatus"
import BytosFreeModelLimitError from "@/components/chat/BytosFreeModelLimitError"
import BytosFreePromotionEndedError from "@/components/chat/BytosFreePromotionEndedError"
import BytosPassLimitError from "@/components/chat/BytosPassLimitError"
import CreditLimitError from "@/components/chat/CreditLimitError"
import EntitlementError from "@/components/chat/EntitlementError"
import OrgBytosPassRestrictionError from "@/components/chat/OrgBytosPassRestrictionError"
import SpendLimitError from "@/components/chat/SpendLimitError"
import { Button } from "@/components/ui/button"
import { useBytosAuth, useBytosSignIn } from "@/context/BytosAuthContext"
import { BytosError, BytosErrorType, MODEL_NOT_FOUND_GUIDANCE } from "../../../../src/services/error/BytosError"

const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: BytosMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "bytosignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
	retryFailedRequest?: () => Promise<boolean>
}

const ErrorRow = memo((props: ErrorRowProps) => {
	const { message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage, retryFailedRequest } = props
	const { bytosUser } = useBytosAuth()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage

	const { isLoginLoading, authStatusMessage, handleSignIn } = useBytosSignIn()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with special error parsing
				if (rawApiError) {
					// FIXME: BytosError parsing should not be applied to non-Bytos providers, but it seems we're using bytosErrorMessage below in the default error display
					const bytosError = BytosError.parse(rawApiError)
					const errorMessage = bytosError?._error?.message || bytosError?.message || rawApiError
					const requestId = bytosError?._error?.request_id
					const providerId = bytosError?.providerId || bytosError?._error?.providerId
					// Deliberately narrower than the shared isBytosManagedProvider (which
					// also matches bytos-pass): only usage-billing errors get the credit
					// and login prompts below.
					const isBytosUsageBillingProvider = providerId === "bytos"
					const errorCode = bytosError?._error?.code

					if (bytosError?.isErrorType(BytosErrorType.Balance)) {
						const errorDetails = bytosError._error?.details
						if (isBytosUsageBillingProvider || errorDetails?.buy_credits_url) {
							return (
								<CreditLimitError
									buyCreditsUrl={errorDetails?.buy_credits_url}
									currentBalance={errorDetails?.current_balance}
									message={errorDetails?.message}
									retryFailedRequest={retryFailedRequest}
									totalPromotions={errorDetails?.total_promotions}
									totalSpent={errorDetails?.total_spent}
								/>
							)
						}
					}

					if (bytosError?.isErrorType(BytosErrorType.SpendLimit)) {
						const d = bytosError._error?.details
						return (
							<SpendLimitError
								budgetPeriod={d?.budget_period}
								limitUsd={d?.limit_usd}
								message={d?.message || errorMessage}
								resetsAt={d?.resets_at}
								spentUsd={d?.spent_usd}
							/>
						)
					}

					if (bytosError?.isErrorType(BytosErrorType.Entitlement)) {
						const detailMessage = bytosError?._error?.details?.message || errorMessage
						return <EntitlementError message={detailMessage} retryFailedRequest={retryFailedRequest} />
					}

					if (bytosError?.isErrorType(BytosErrorType.OrgBytosPassRestriction)) {
						return <OrgBytosPassRestrictionError />
					}

					if (bytosError?.isErrorType(BytosErrorType.BytosPassLimit)) {
						const detailMessage = bytosError?._error?.details?.message || errorMessage
						return <BytosPassLimitError message={detailMessage} />
					}

					if (bytosError?.isErrorType(BytosErrorType.BytosFreeModelLimit)) {
						const detailMessage = bytosError?._error?.details?.message || errorMessage
						return <BytosFreeModelLimitError message={detailMessage} />
					}

					// A retired free model answers model-not-found once its promotion
					// ends — dedicated copy plus a route into the model picker,
					// since retrying the deleted model can never succeed.
					if (bytosError?.isErrorType(BytosErrorType.BytosFreePromotionEnded)) {
						return <BytosFreePromotionEndedError />
					}

					if (bytosError?.isErrorType(BytosErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</p>
						)
					}

					if (bytosError?.isErrorType(BytosErrorType.QuotaExceeded)) {
						const detailMessage = bytosError?._error?.details?.message || errorMessage
						return <p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">{detailMessage}</p>
					}

					// A 404/405/410 is the server saying the model id or endpoint
					// path does not exist. The host already appends this guidance
					// when it can recognise the message text; add it here only
					// when the status alone carried the verdict.
					const notFoundGuidance =
						bytosError?.isErrorType(BytosErrorType.NotFound) && !errorMessage.includes(MODEL_NOT_FOUND_GUIDANCE)
							? `The model or endpoint was not found. ${MODEL_NOT_FOUND_GUIDANCE}`
							: undefined

					if (bytosError?.isErrorType(BytosErrorType.Auth) && isBytosUsageBillingProvider) {
						return !bytosUser ? (
							// User is using Bytos provider and is not logged in
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-center rounded border border-neutral-500/30 bg-vscode-editor-background p-6 text-center text-vscode-foreground">
									Whoops looks like you're logged out – click below to sign in
								</div>
								<Button className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
									Sign in to Bytos
									{isLoginLoading && (
										<span className="ml-1 animate-spin">
											<span className="codicon codicon-refresh" />
										</span>
									)}
								</Button>
								<BytosAuthStatus message={authStatusMessage} />
							</div>
						) : (
							// Don't show sign in button after the user has logged in, just ask them to retry
							<div className="mt-4">
								<span className="text-description">(Click "Retry" below)</span>
							</div>
						)
					}

					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							{/* Display the well-formatted error extracted from the BytosError instance */}

							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode}</span>}
								{errorMessage}
								{requestId && <div>Request ID: {requestId}</div>}
							</header>

							{notFoundGuidance && <div>{notFoundGuidance}</div>}

							{/* Windows Powershell Issue */}
							{errorMessage?.toLowerCase()?.includes("powershell") && (
								<div>
									It seems like you're having Windows PowerShell issues, please see this{" "}
									<a
										className="underline text-inherit"
										href="https://github.com/Balahurra/Bytos/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22">
										troubleshooting guide
									</a>
									.
								</div>
							)}

							{/* Display raw API error if different from parsed error message */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}
						</p>
					)
				}

				// Regular error message
				return <p className="m-0 mt-0 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>The model used search patterns that don't match anything in the file. Retrying...</div>
					</div>
				)

			case "bytosignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>
							Bytos tried to access <code>{message.text}</code> which is blocked by the <code>.bytosignore</code>
							file.
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and bytosignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "bytosignore_error") {
		return renderErrorContent()
	}

	// For other error types, show header + content
	return renderErrorContent()
})

export default ErrorRow
