import { Mode } from "@shared/storage/types"
import { BytosAccountInfoCard } from "../BytosAccountInfoCard"
import BytosModelPicker from "../BytosModelPicker"

/**
 * Props for the BytosProvider component
 */
interface BytosProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

/**
 * The Bytos provider configuration component
 */
export const BytosProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: BytosProviderProps) => {
	return (
		<div>
			{/* Bytos Account Info Card */}
			<div style={{ marginBottom: 14, marginTop: 4 }}>
				<BytosAccountInfoCard />
			</div>

			{showModelOptions && (
				<BytosModelPicker
					currentMode={currentMode}
					initialTab={initialModelTab}
					isPopup={isPopup}
					showProviderRouting={true}
				/>
			)}
		</div>
	)
}
