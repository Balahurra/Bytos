import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useBytosPassPromo } from "@/hooks/useBytosPassPromo"
import { BytosPassCard, BytosPassWelcomeCallout } from "../BytosPassCard"

vi.mock("@/hooks/useBytosPassPromo", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as Record<string, unknown>),
		useBytosPassPromo: vi.fn(),
	}
})

const mockPromo = (overrides: Partial<ReturnType<typeof useBytosPassPromo>> = {}) => {
	vi.mocked(useBytosPassPromo).mockReturnValue({
		isBytosPassEnabled: true,
		isUsingBytosPass: false,
		subscribeUrl: "https://app.bytos.dev/onboarding/individual-plan",
		manageSubscriptionUrl: "https://app.bytos.dev/dashboard/subscription",
		openSubscribePage: vi.fn(),
		openManageSubscriptionPage: vi.fn(),
		selectBytosPassProvider: vi.fn(),
		switchToBytosPassProvider: vi.fn(),
		...overrides,
	})
}

describe("BytosPassCard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders nothing when BytosPass promotions are disabled", () => {
		mockPromo({ isBytosPassEnabled: false })
		render(<BytosPassCard />)
		expect(screen.queryByTestId("bytos-pass-card")).not.toBeInTheDocument()
	})

	it("promotes BytosPass when the user is not on the BytosPass provider", () => {
		mockPromo()
		render(<BytosPassCard />)
		expect(screen.getByText("Get BytosPass")).toBeInTheDocument()
		expect(screen.getByText("Use BytosPass Provider")).toBeInTheDocument()
		expect(screen.queryByText("Manage Subscription")).not.toBeInTheDocument()
	})

	it("switches to the BytosPass provider on click", () => {
		const switchToBytosPassProvider = vi.fn().mockResolvedValue(undefined)
		mockPromo({ switchToBytosPassProvider })
		render(<BytosPassCard />)
		fireEvent.click(screen.getByText("Use BytosPass Provider"))
		expect(switchToBytosPassProvider).toHaveBeenCalledTimes(1)
	})

	it("links to subscription management when already using BytosPass", () => {
		mockPromo({ isUsingBytosPass: true })
		render(<BytosPassCard />)
		expect(screen.getByText("Manage Subscription")).toBeInTheDocument()
		expect(screen.queryByText("Get BytosPass")).not.toBeInTheDocument()
	})
})

describe("BytosPassWelcomeCallout", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders nothing when BytosPass promotions are disabled", () => {
		mockPromo({ isBytosPassEnabled: false })
		render(<BytosPassWelcomeCallout />)
		expect(screen.queryByTestId("bytos-pass-welcome-callout")).not.toBeInTheDocument()
	})

	it("mentions BytosPass when promotions are enabled", () => {
		mockPromo()
		render(<BytosPassWelcomeCallout />)
		expect(screen.getByTestId("bytos-pass-welcome-callout")).toHaveTextContent("BytosPass")
	})
})
