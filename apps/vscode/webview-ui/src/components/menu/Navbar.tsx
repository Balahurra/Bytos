import { HistoryIcon, PlusIcon, PuzzleIcon, SettingsIcon } from "lucide-react"
import { useMemo } from "react"
import BytosLogoVariable from "@/assets/BytosLogoVariable"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "../../context/ExtensionStateContext"

interface NavbarProps {
	startNewTask: (source: "navbar") => Promise<boolean>
}

export const Navbar = ({ startNewTask }: NavbarProps) => {
	const { navigateToHistory, navigateToSettings, navigateToMarketplace, navigateToChat } = useExtensionState()

	const SETTINGS_TABS = useMemo(
		() => [
			{
				id: "chat",
				name: "Chat",
				tooltip: "New Task",
				icon: PlusIcon,
				navigate: async () => {
					try {
						if (await startNewTask("navbar")) {
							navigateToChat()
						}
					} catch (error) {
						console.error("Failed to clear task:", error)
					}
				},
			},
			{
				id: "customize",
				name: "Customize",
				tooltip: "Customize",
				icon: PuzzleIcon,
				navigate: navigateToMarketplace,
			},
			{
				id: "history",
				name: "History",
				tooltip: "History",
				icon: HistoryIcon,
				navigate: navigateToHistory,
			},
			{
				id: "settings",
				name: "Settings",
				tooltip: "Settings",
				icon: SettingsIcon,
				navigate: navigateToSettings,
			},
		],
		[navigateToChat, navigateToHistory, navigateToMarketplace, navigateToSettings, startNewTask],
	)

	return (
		<nav
			className="bytos-nav flex-none inline-flex justify-end gap-2 mb-1 z-10 border-none items-center mr-4!"
			id="bytos-navbar-container">
			<div className="mr-auto flex items-center gap-1.5 pl-1">
				<BytosLogoVariable className="size-4" />
				<span className="bytos-display text-[10px] font-semibold uppercase tracking-[0.1em] text-description">Bytos</span>
			</div>
			{SETTINGS_TABS.map((tab) => (
				<Tooltip key={`navbar-tooltip-${tab.id}`}>
					<TooltipContent side="bottom">{tab.tooltip}</TooltipContent>
					<TooltipTrigger asChild>
						<Button
							aria-label={tab.tooltip}
							className="bytos-nav-item p-0 h-7"
							data-testid={`tab-${tab.id}`}
							key={`navbar-button-${tab.id}`}
							onClick={() => tab.navigate()}
							size="icon"
							variant="icon">
							<tab.icon className="stroke-1 [svg]:size-4" size={18} />
						</Button>
					</TooltipTrigger>
				</Tooltip>
			))}
		</nav>
	)
}
