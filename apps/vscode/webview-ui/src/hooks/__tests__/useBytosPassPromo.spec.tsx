import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useBytosAuth } from "@/context/BytosAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useBytosPassPromo } from "../useBytosPassPromo"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/context/BytosAuthContext", () => ({
	useBytosAuth: vi.fn(),
}))

vi.mock("@/components/settings/utils/useApiConfigurationHandlers", () => ({
	useApiConfigurationHandlers: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	UiServiceClient: {
		openUrl: vi.fn(() => Promise.resolve({})),
	},
}))

const mockNavigateToSettings = vi.fn()
const mockHandleModeFieldChange = vi.fn(() => Promise.resolve())

const mockExtensionState = (overrides: Record<string, unknown> = {}) => {
	vi.mocked(useExtensionState).mockReturnValue({
		apiConfiguration: { planModeApiProvider: "anthropic", actModeApiProvider: "anthropic" },
		environment: "production",
		navigateToSettings: mockNavigateToSettings,
		remoteConfigSettings: undefined,
		mode: "act",
		planActSeparateModelsSetting: false,
		...overrides,
	} as any)
}

describe("useBytosPassPromo", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useBytosAuth).mockReturnValue({ bytosUser: null } as any)
		vi.mocked(useApiConfigurationHandlers).mockReturnValue({
			handleModeFieldChange: mockHandleModeFieldChange,
		} as any)
		mockExtensionState()
	})

	it("is enabled when no remote config restricts providers", () => {
		const { result } = renderHook(() => useBytosPassPromo())
		expect(result.current.isBytosPassEnabled).toBe(true)
	})

	it("is disabled in self-hosted mode", () => {
		mockExtensionState({ environment: "selfHosted" })
		const { result } = renderHook(() => useBytosPassPromo())
		expect(result.current.isBytosPassEnabled).toBe(false)
	})

	it("is disabled when the environment is unknown", () => {
		mockExtensionState({ environment: undefined })
		const { result } = renderHook(() => useBytosPassPromo())
		expect(result.current.isBytosPassEnabled).toBe(false)
	})

	it("is disabled when the org remote config excludes bytos-pass", () => {
		mockExtensionState({ remoteConfigSettings: { remoteConfiguredProviders: ["anthropic", "openrouter"] } })
		const { result } = renderHook(() => useBytosPassPromo())
		expect(result.current.isBytosPassEnabled).toBe(false)
	})

	it("stays enabled when the org remote config includes bytos-pass", () => {
		mockExtensionState({ remoteConfigSettings: { remoteConfiguredProviders: ["anthropic", "bytos-pass"] } })
		const { result } = renderHook(() => useBytosPassPromo())
		expect(result.current.isBytosPassEnabled).toBe(true)
	})

	it("detects when either mode already uses the BytosPass provider", () => {
		mockExtensionState({
			apiConfiguration: { planModeApiProvider: "bytos-pass", actModeApiProvider: "anthropic" },
		})
		const { result } = renderHook(() => useBytosPassPromo())
		expect(result.current.isUsingBytosPass).toBe(true)
	})

	it("only reflects the current mode's provider when plan/act use separate models", () => {
		mockExtensionState({
			apiConfiguration: { planModeApiProvider: "bytos-pass", actModeApiProvider: "anthropic" },
			planActSeparateModelsSetting: true,
			mode: "act",
		})
		const { result: actResult } = renderHook(() => useBytosPassPromo())
		expect(actResult.current.isUsingBytosPass).toBe(false)

		mockExtensionState({
			apiConfiguration: { planModeApiProvider: "bytos-pass", actModeApiProvider: "anthropic" },
			planActSeparateModelsSetting: true,
			mode: "plan",
		})
		const { result: planResult } = renderHook(() => useBytosPassPromo())
		expect(planResult.current.isUsingBytosPass).toBe(true)
	})

	it("switches provider mode-aware and navigates to API settings on success", async () => {
		const { result } = renderHook(() => useBytosPassPromo())
		await result.current.switchToBytosPassProvider()
		// handleModeFieldChange only touches the current mode when plan/act use
		// separate models, so the other mode's provider is never overwritten.
		expect(mockHandleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			"bytos-pass",
			"act",
		)
		expect(mockNavigateToSettings).toHaveBeenCalledWith("api-config")
	})

	it("passes the current plan mode to the provider update", async () => {
		mockExtensionState({ mode: "plan" })
		const { result } = renderHook(() => useBytosPassPromo())
		await result.current.switchToBytosPassProvider()
		expect(mockHandleModeFieldChange).toHaveBeenCalledWith(
			{ plan: "planModeApiProvider", act: "actModeApiProvider" },
			"bytos-pass",
			"plan",
		)
	})

	it("does not navigate to settings when the provider update fails", async () => {
		mockHandleModeFieldChange.mockRejectedValueOnce(new Error("update failed"))
		const { result } = renderHook(() => useBytosPassPromo())
		await result.current.switchToBytosPassProvider()
		expect(mockNavigateToSettings).not.toHaveBeenCalled()
	})

	it("reports selection success and failure via the returned promise", async () => {
		const { result } = renderHook(() => useBytosPassPromo())
		await expect(result.current.selectBytosPassProvider()).resolves.toBe(true)
		mockHandleModeFieldChange.mockRejectedValueOnce(new Error("update failed"))
		await expect(result.current.selectBytosPassProvider()).resolves.toBe(false)
	})
})
