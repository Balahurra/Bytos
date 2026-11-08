import type { Boolean, EmptyRequest } from "@shared/proto/bytos/common"
import { BooleanRequest } from "@shared/proto/bytos/common"
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
import { StateServiceClient, UiServiceClient } from "./services/grpc-client"

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
	const { user: webAccountUser, ready: webAccountReady } = useWebAccount()
	const accountGateInitializedRef = useRef(false)

	// Offer the account screen once, on the very first run. Dismissing it marks
	// the intro complete, so it never opens automatically again; the title-bar
	// bell is the ongoing sign-in reminder. The chat and BYOK keep working
	// without an account, so this is never a lock.
	useEffect(() => {
		if (!didHydrateState || !webAccountReady || accountGateInitializedRef.current) {
			return
		}
		accountGateInitializedRef.current = true
		if (!welcomeViewCompleted && !webAccountUser) {
			navigateToAccount()
		}
	}, [didHydrateState, webAccountReady, welcomeViewCompleted, webAccountUser, navigateToAccount])

	// Closing the account screen while signed out completes the one-time intro.
	// A signed-out session must not trap the user in the account view.
	const handleAccountDone = useCallback(async () => {
		hideAccount()
		if (webAccountUser) {
			return
		}
		try {
			await StateServiceClient.setWelcomeViewCompleted(BooleanRequest.create({ value: true }))
		} catch (error) {
			console.error("Failed to mark the account intro as complete:", error)
		}
	}, [hideAccount, webAccountUser])

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
			{showAccount && <WebAccountPanel onDone={handleAccountDone} />}
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
