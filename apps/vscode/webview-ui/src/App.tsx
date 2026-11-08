import type { Boolean, EmptyRequest } from "@shared/proto/bytos/common"
import { useCallback, useEffect, useRef } from "react"
import { WebAccountPanel } from "./components/account/WebAccountPanel"
import ChatView from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import MarketplaceView from "./components/marketplace/MarketplaceView"
import McpView from "./components/mcp/configuration/McpConfigurationView"
import SettingsView from "./components/settings/SettingsView"
import WorktreesView from "./components/worktrees/WorktreesView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { useWebAccount } from "./context/WebAccountContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

const AppContent = () => {
	const {
		didHydrateState,
		shouldShowAnnouncement,
		showMarketplace,
		showMcp,
		mcpTab,
		showSettings,
		settingsNavigationRequest,
		showHistory,
		showWorktrees,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideWorktrees,
		closeMarketplaceView,
		hideAnnouncement,
		showAccount,
		hideAccount,
		navigateToAccount,
		welcomeViewCompleted,
	} = useExtensionState()
	const { user: webAccountUser, ready: webAccountReady, sessionExpired: webAccountSessionExpired } = useWebAccount()
	const accountGateInitializedRef = useRef(false)
	const previousWebAccountUserRef = useRef(webAccountUser)

	// Offer the account screen once, on the very first run, and only as a
	// starting view: the chat stays reachable and BYOK keeps working without an
	// account, so this is never a lock. Dismissing it sets `welcomeViewCompleted`.
	useEffect(() => {
		if (!didHydrateState || !webAccountReady || accountGateInitializedRef.current) {
			return
		}
		accountGateInitializedRef.current = true
		if (!welcomeViewCompleted && !webAccountUser) {
			navigateToAccount()
		}
	}, [didHydrateState, webAccountReady, welcomeViewCompleted, webAccountUser, navigateToAccount])

	// Show the account screen when a live session drops (expired refresh token),
	// so the user is told to sign in again instead of silently landing in chat.
	useEffect(() => {
		const previousUser = previousWebAccountUserRef.current
		previousWebAccountUserRef.current = webAccountUser
		if (didHydrateState && previousUser && !webAccountUser && webAccountSessionExpired) {
			navigateToAccount()
		}
	}, [webAccountUser, webAccountSessionExpired, didHydrateState, navigateToAccount])

	const showUpdateAnnouncementModal = useCallback(() => {
		setShowAnnouncement(true)
		UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
			.then((response: Boolean) => {
				setShouldShowAnnouncement(response.value)
			})
			.catch((error) => {
				console.error("Failed to acknowledge announcement:", error)
			})
	}, [setShouldShowAnnouncement, setShowAnnouncement])

	useEffect(() => {
		if (!didHydrateState || !shouldShowAnnouncement || showAnnouncement) {
			return
		}
		showUpdateAnnouncementModal()
	}, [didHydrateState, shouldShowAnnouncement, showAnnouncement, showUpdateAnnouncementModal])

	if (!didHydrateState) {
		return null
	}

	return (
		<div className="flex h-screen w-full flex-col">
			{showSettings && <SettingsView navigationRequest={settingsNavigationRequest} onDone={hideSettings} />}
			{showHistory && <HistoryView onDone={hideHistory} />}
			{showMarketplace && <MarketplaceView initialType={mcpTab ? "mcp" : undefined} onDone={closeMarketplaceView} />}
			{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
			{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
			{showAccount && <WebAccountPanel onDone={hideAccount} />}
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showMarketplace || showMcp || showWorktrees || showAccount}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
