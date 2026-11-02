import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useBytosPassPromo } from "@/hooks/useBytosPassPromo"
import { StateServiceClient } from "@/services/grpc-client"
import { clearSessionBannerDismissalsForTesting } from "@/utils/sessionBannerDismissals"
import { BytosPassHint } from "../BytosPassHint"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

vi.mock("@/hooks/useBytosPassPromo", async (importOriginal) => {
	const actual = await importOriginal()
	return {
		...(actual as Record<string, unknown>),
		useBytosPassPromo: vi.fn(),
	}
})

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		dismissBanner: vi.fn(() => Promise.resolve({})),
	},
}))

vi.mock("../utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

const mockHandleModeFieldChange = vi.fn(() => Promise.resolve())

const mockExtensionState = (overrides: Record<string, unknown> = {}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		dismissedBanners: [],
		...overrides,
	} as any)
}

const mockPromo = (overrides: Partial<ReturnType<typeof useBytosPassPromo>> = {}) => {
	vi.mocked(useBytosPassPromo).mockReturnValue({
		isBytosPassEnabled: true,
		...overrides,
	} as any)
}

describe("BytosPassHint", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		clearSessionBannerDismissalsForTesting()
		mockPromo()
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleModeFieldChange: mockHandleModeFieldChange,
		} as any)
		mockExtensionState()
	})

	it("shows the hint for non-BytosPass providers", () => {
		render(<BytosPassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.getByTestId("bytos-pass-settings-hint")).toBeInTheDocument()
	})

	it("selects the BytosPass provider for the current mode when clicking Try it", () => {
		render(<BytosPassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByText("Try it"))
		expect(mockHandleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			"bytos-pass",
			"plan",
		)
	})

	it("hides the hint when BytosPass promotions are disabled (self-hosted or org allowlist)", () => {
		mockPromo({ isBytosPassEnabled: false })
		render(<BytosPassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("bytos-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint when BytosPass is already selected", () => {
		render(<BytosPassHint currentMode="plan" selectedProvider="bytos-pass" />)
		expect(screen.queryByTestId("bytos-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("hides the hint once dismissed and persists the dismissal", () => {
		render(<BytosPassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByLabelText("Dismiss BytosPass hint"))
		expect(screen.queryByTestId("bytos-pass-settings-hint")).not.toBeInTheDocument()
		expect(StateServiceClient.dismissBanner).toHaveBeenCalledWith({ value: "bytos-pass-settings-hint-v1" })
	})

	it("stays hidden after a remount within the same session", () => {
		const { unmount } = render(<BytosPassHint currentMode="plan" selectedProvider="anthropic" />)
		fireEvent.click(screen.getByLabelText("Dismiss BytosPass hint"))
		unmount()
		// Remount before the persisted dismissal has synced back from the host
		render(<BytosPassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("bytos-pass-settings-hint")).not.toBeInTheDocument()
	})

	it("stays hidden when a previous dismissal is in extension state", () => {
		mockExtensionState({ dismissedBanners: [{ bannerId: "bytos-pass-settings-hint-v1", dismissedAt: 1 }] })
		render(<BytosPassHint currentMode="plan" selectedProvider="anthropic" />)
		expect(screen.queryByTestId("bytos-pass-settings-hint")).not.toBeInTheDocument()
	})
})
