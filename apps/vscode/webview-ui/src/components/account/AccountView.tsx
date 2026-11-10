import type { UsageTransaction as BytosAccountUsageTransaction, PaymentTransaction } from "@shared/BytosAccount"
import { isBytosInternalTester } from "@shared/internal/account"
import type { UserOrganization } from "@shared/proto/bytos/account"
import { EmptyRequest } from "@shared/proto/bytos/common"
import { VSCodeButton, VSCodeDivider, VSCodeDropdown, VSCodeOption, VSCodeTag } from "@vscode/webview-ui-toolkit/react"
import { LoaderCircleIcon } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useInterval } from "react-use"
import { CloudGitHubCard } from "@/components/cloud/CloudGitHubCard"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type BytosUser, handleSignOut, useBytosAuth } from "@/context/BytosAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import ViewHeader from "../common/ViewHeader"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import { updateSetting } from "../settings/utils/settingsHandlers"
import { AccountWelcomeView } from "./AccountWelcomeView"
import { CreditBalance } from "./CreditBalance"
import CreditsHistoryTable from "./CreditsHistoryTable"
import { convertProtoUsageTransactions, getBytosUris, getMainRole } from "./helpers"
import { RemoteConfigToggle } from "./RemoteConfigToggle"

type AccountViewProps = {
	bytosUser: BytosUser | null
	organizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	onDone: () => void
}

type BytosAccountViewProps = {
	bytosUser: BytosUser
	userOrganizations: UserOrganization[] | null
	activeOrganization: UserOrganization | null
	bytosEnv: "Production" | "Staging" | "Local"
}

type CachedData = {
	balance: number | null
	usageData: BytosAccountUsageTransaction[]
	paymentsData: PaymentTransaction[]
	lastFetchTime: number
}

const BytosEnvOptions = ["Production", "Staging", "Local"] as const

const AccountView = ({ onDone, bytosUser, organizations, activeOrganization }: AccountViewProps) => {
	const { environment } = useExtensionState()

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden">
			<ViewHeader environment={environment} onDone={onDone} showEnvironmentSuffix title="Account" />
			<div className="grow flex flex-col px-5 overflow-y-auto">
				{bytosUser?.uid ? (
					<BytosAccountView
						activeOrganization={activeOrganization}
						bytosEnv={environment === "local" ? "Local" : environment === "staging" ? "Staging" : "Production"}
						bytosUser={bytosUser}
						key={bytosUser.uid}
						userOrganizations={organizations}
					/>
				) : (
					<AccountWelcomeView />
				)}
			</div>
		</div>
	)
}

const BytosAccountView = ({ bytosUser, userOrganizations, activeOrganization, bytosEnv }: BytosAccountViewProps) => {
	const { email, displayName, appBaseUrl, uid } = bytosUser
	const { remoteConfigSettings, environment, cloudSessionsEnabled } = useExtensionState()

	// Determine if dropdown should be locked by remote config
	const isLockedByRemoteConfig = Object.keys(remoteConfigSettings || {}).length > 0

	const { accountSwitch, accountSwitchError, switchOrganization } = useBytosAuth()
	const dropdownValue = activeOrganization?.organizationId || uid
	const [isLoading, setIsLoading] = useState(false)

	const [creditData, setCreditData] = useState<CachedData & { accountId: string }>()
	const creditRequest = useRef<object | null>(null)
	const activeAccount = useRef(dropdownValue)
	activeAccount.current = dropdownValue
	const isBytosTester = useMemo(() => (email ? isBytosInternalTester(email) : false), [email])
	const bytosUrl = appBaseUrl || "https://app.bytos.dev"

	const fetchCreditBalance = useCallback(
		async (accountId: string) => {
			const request = {}
			creditRequest.current = request
			setIsLoading(true)
			try {
				const response =
					accountId === uid
						? await AccountServiceClient.getUserCredits(EmptyRequest.create())
						: await AccountServiceClient.getOrganizationCredits({ organizationId: accountId })
				if (creditRequest.current !== request || activeAccount.current !== accountId) return
				setCreditData({
					accountId,
					balance: response.balance?.currentBalance ?? null,
					usageData: convertProtoUsageTransactions(response.usageTransactions),
					paymentsData: "paymentTransactions" in response ? response.paymentTransactions : [],
					lastFetchTime: Date.now(),
				})
			} catch (error) {
				console.error("Failed to fetch credit balance:", error)
			} finally {
				if (creditRequest.current === request) setIsLoading(false)
			}
		},
		[uid],
	)

	useEffect(() => {
		if (!accountSwitch) void fetchCreditBalance(dropdownValue)
		return () => {
			creditRequest.current = null
		}
	}, [dropdownValue, accountSwitch, fetchCreditBalance])
	useInterval(() => {
		if (!accountSwitch) void fetchCreditBalance(dropdownValue)
	}, 60_000)

	const displayedCredit = !accountSwitch && creditData?.accountId === dropdownValue ? creditData : undefined
	const balance = displayedCredit?.balance ?? null
	const usageData = displayedCredit?.usageData ?? []
	const paymentsData = displayedCredit?.paymentsData ?? []
	const lastFetchTime = displayedCredit?.lastFetchTime ?? 0

	const handleOrganizationChange = (event: { target: EventTarget | null }) => {
		const newValue = (event.target as HTMLSelectElement | null)?.value
		if (newValue && newValue !== dropdownValue && !accountSwitch) {
			void switchOrganization(newValue === uid ? undefined : newValue)
		}
	}

	return (
		<div className="h-full flex flex-col">
			<div className="flex flex-col h-full">
				<div className="flex flex-col w-full gap-1 mb-6">
					<div className="flex items-center flex-wrap gap-y-4">
						{/* {user.photoUrl ? (
								<img src={user.photoUrl} alt="Profile" className="size-16 rounded-full mr-4" />
							) : ( */}
						<div className="size-16 rounded-full bg-button-background flex items-center justify-center text-2xl text-button-foreground mr-4">
							{displayName?.[0] || email?.[0] || "?"}
						</div>
						{/* )} */}

						<div className="flex flex-col">
							{displayName && <h2 className="text-foreground m-0 text-lg font-medium">{displayName}</h2>}

							{email && <div className="text-sm text-description">{email}</div>}

							<div className="flex gap-2 items-center mt-1">
								<Tooltip>
									<TooltipTrigger>
										<VSCodeDropdown
											className="w-full"
											currentValue={accountSwitch ? accountSwitch.organizationId || uid : dropdownValue}
											disabled={!!accountSwitch || isLockedByRemoteConfig}
											onChange={handleOrganizationChange}>
											<VSCodeOption key="personal" value={uid}>
												Personal
											</VSCodeOption>
											{userOrganizations?.map((org: UserOrganization) => (
												<VSCodeOption key={org.organizationId} value={org.organizationId}>
													{org.name}
												</VSCodeOption>
											))}
										</VSCodeDropdown>
									</TooltipTrigger>
									<TooltipContent hidden={!isLockedByRemoteConfig}>
										This cannot be changed while your organization has remote configuration enabled.
									</TooltipContent>
								</Tooltip>
								{accountSwitch ? (
									<LoaderCircleIcon
										aria-label="Switching account"
										className="size-4 shrink-0 animate-spin text-description"
									/>
								) : (
									activeOrganization && (
										<VSCodeTag className="text-xs p-2" title="Role">
											{getMainRole(activeOrganization.roles)}
										</VSCodeTag>
									)
								)}
							</div>
							{accountSwitchError && (
								<div className="mt-1 text-xs text-error" role="alert">
									Could not confirm account switch: {accountSwitchError}
								</div>
							)}
							{accountSwitch?.slow && (
								<div className="mt-1 text-xs text-description" role="status">
									Account switch is still pending. You can navigate while it finishes.
								</div>
							)}
						</div>
					</div>
					<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
						<RemoteConfigToggle activeOrganization={activeOrganization} />
					</div>
				</div>

				<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
					<div className="w-full min-[225px]:w-1/2">
						<VSCodeButtonLink appearance="primary" className="w-full" href={getBytosUris(bytosUrl, "dashboard").href}>
							Dashboard
						</VSCodeButtonLink>
					</div>
					<VSCodeButton appearance="secondary" className="w-full min-[225px]:w-1/2" onClick={() => handleSignOut()}>
						Log out
					</VSCodeButton>
				</div>

				<VSCodeDivider className="w-full my-6" />

				<div className="w-full text-xs text-(--vscode-descriptionForeground) mb-6">
					<div className="text-sm font-semibold text-foreground mb-1">Privacy and data</div>
					<p className="m-0 mb-2">
						Your Bytos account stores your email address and the profile fields you enter. Authentication and profile
						data are processed by Supabase Auth; account and usage requests go to the Bytos API. Provider API keys
						stay in this editor's secret storage and model requests go directly to the provider you select.
					</p>
					<p className="m-0 mb-2">
						Account deletion is handled on the Bytos website. Open the account page to review your data and
						permanently delete your account, profile, and active sessions.
					</p>
					<p className="m-0 flex flex-wrap gap-x-2 gap-y-1">
						<VSCodeButtonLink appearance="secondary" href="https://bytos.dev/privacy">
							Privacy Policy
						</VSCodeButtonLink>
						<VSCodeButtonLink appearance="secondary" href="https://bytos.dev/terms">
							Terms of Service
						</VSCodeButtonLink>
						<VSCodeButtonLink appearance="secondary" href="https://bytos.dev/account">
							Manage or delete account
						</VSCodeButtonLink>
					</p>
				</div>

				{cloudSessionsEnabled && (
					<div className="mb-6">
						<CloudGitHubCard />
					</div>
				)}

				<CreditBalance
					balance={balance}
					creditUrl={getBytosUris(bytosUrl, "credits", dropdownValue === uid ? "account" : "organization")}
					fetchCreditBalance={() => fetchCreditBalance(dropdownValue)}
					isLoading={isLoading || !!accountSwitch}
					lastFetchTime={lastFetchTime}
				/>

				<VSCodeDivider className="mt-6 mb-3 w-full" />

				<div className="flex flex-col pb-[0px]">
					<CreditsHistoryTable
						isLoading={isLoading || !!accountSwitch}
						paymentsData={paymentsData}
						showPayments={dropdownValue === uid}
						usageData={usageData}
					/>
				</div>

				{/* Hide environment switching UI when in self-hosted mode */}
				{isBytosTester && environment !== "selfHosted" && (
					<div className="w-full gap-1 items-end">
						<VSCodeDivider className="w-full my-3" />
						<div className="text-sm font-semibold">Bytos Environment</div>
						<VSCodeDropdown
							className="w-full mt-1"
							currentValue={bytosEnv}
							onChange={async (e) => {
								const target = e.target as HTMLSelectElement
								if (target?.value) {
									const value = target.value as "Local" | "Staging" | "Production"
									updateSetting("bytosEnv", value.toLowerCase())
								}
							}}>
							{BytosEnvOptions.map((env) => (
								<VSCodeOption key={env} value={env}>
									{env}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(AccountView)
