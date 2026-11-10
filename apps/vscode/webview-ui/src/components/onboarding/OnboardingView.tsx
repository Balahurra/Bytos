import WelcomeView from "../welcome/WelcomeView"

/**
 * The current build is BYOK-first: account creation is optional and no hosted
 * subscription onboarding exists. Keep the WelcomeView as the single entry
 * point so users configure their own provider.
 */
const OnboardingView = () => {
	return <WelcomeView />
}

export default OnboardingView
