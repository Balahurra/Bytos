import { EmptyRequest } from "@shared/proto/bytos/common"
import BytosLogoSanta from "@/assets/BytosLogoSanta"
import BytosLogoVariable from "@/assets/BytosLogoVariable"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

interface HomeHeaderProps {
	shouldShowQuickWins?: boolean
}

const HomeHeader = ({ shouldShowQuickWins = false }: HomeHeaderProps) => {
	const { environment } = useExtensionState()

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening walkthrough:", error)
		}
	}

	const isDecember = new Date().getMonth() === 11 // 11 = December (0-indexed)
	const LogoComponent = isDecember ? BytosLogoSanta : BytosLogoVariable

	return (
		<div className="bytos-home-header flex flex-col items-center mb-5">
			<div className="bytos-home-mark my-7">
				<LogoComponent className="size-20" environment={environment} />
			</div>
			<div className="bytos-label bytos-home-kicker mb-2">Bytos workspace</div>
			<div className="text-center flex items-center justify-center px-4">
				<h1 className="bytos-home-title m-0">What should we build?</h1>
			</div>
			<p className="bytos-home-subtitle text-center mt-1.5 mb-0 px-6">
				Plan, edit, run, and verify with a human in the loop.
			</p>
			{shouldShowQuickWins && (
				<div className="mt-4">
					<button
						className="bytos-tour-button flex items-center gap-2 px-4 py-2 rounded-full border border-border-panel transition-colors duration-150 ease-in-out text-code-foreground text-sm font-medium cursor-pointer"
						onClick={handleTakeATour}
						type="button">
						Take a Tour
						<span className="codicon codicon-play scale-90" />
					</button>
				</div>
			)}
		</div>
	)
}

export default HomeHeader
