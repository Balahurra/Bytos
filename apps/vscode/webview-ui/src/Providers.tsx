import { HeroUIProvider } from "@heroui/react"
import { type ReactNode } from "react"
import { CustomPostHogProvider } from "./CustomPostHogProvider"
import { BytosAuthProvider } from "./context/BytosAuthContext"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { PlatformProvider } from "./context/PlatformContext"
import { WebAccountProvider } from "./context/WebAccountContext"

export function Providers({ children }: { children: ReactNode }) {
	return (
		<PlatformProvider>
			<ExtensionStateContextProvider>
				<WebAccountProvider>
					<CustomPostHogProvider>
						<BytosAuthProvider>
							<HeroUIProvider>{children}</HeroUIProvider>
						</BytosAuthProvider>
					</CustomPostHogProvider>
				</WebAccountProvider>
			</ExtensionStateContextProvider>
		</PlatformProvider>
	)
}
