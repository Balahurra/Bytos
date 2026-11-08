import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import SettingsView from "./SettingsView"
import { resolveSettingsTarget, SETTINGS_NAVIGATION_TARGETS } from "./settingsTargets"

/**
 * F3 — the Voice section's place in the existing Settings navigation.
 *
 * The spec is explicit: General Settings, then Voice, then About Bytos, inside
 * the existing screen. These tests read the rendered tab list, so a later
 * reordering that broke the contract would fail here rather than in a screenshot.
 */

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		version: "1.0.2",
		extensionVariant: undefined,
		environment: "production",
		settingsInitialModelTab: undefined,
	}),
}))

vi.mock("@/context/BytosAuthContext", () => ({
	useBytosAuth: () => ({ bytosUser: null, activeOrganization: null }),
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: { resetState: async () => ({}) },
	VoiceServiceClient: {
		getVoiceServiceStatus: async () => undefined,
		subscribeToVoiceEvents: () => () => {},
		downloadVoiceModel: async () => ({}),
		cancelVoiceModelDownload: async () => ({}),
		verifyVoiceModel: async () => ({}),
	},
}))

vi.mock("../common/ViewHeader", () => ({
	default: ({ title }: { title: string }) => <div data-testid="view-header">{title}</div>,
}))

vi.mock("./sections/ApiConfigurationSection", () => ({ default: () => <div>api-config</div> }))
vi.mock("./sections/FeatureSettingsSection", () => ({ default: () => <div>features</div> }))
vi.mock("./sections/AutoPhasePlanSection", () => ({ default: () => <div>auto-phase-plan</div> }))
vi.mock("./sections/GeneralSettingsSection", () => ({ default: () => <div>general</div> }))
vi.mock("./sections/AboutSection", () => ({ default: () => <div>about</div> }))
vi.mock("./sections/DebugSection", () => ({ default: () => <div>debug</div> }))
vi.mock("./sections/RemoteConfigSection", () => ({ RemoteConfigSection: () => <div>remote-config</div> }))
vi.mock("./sections/VoiceSettingsSection", () => ({ default: () => <div>voice</div> }))

const tabIds = (container: HTMLElement): string[] =>
	Array.from(container.querySelectorAll("[role='tab']")).map((tab) => tab.getAttribute("data-value") ?? "")

describe("SettingsView — Voice placement", () => {
	it("places Voice directly after General and directly before About", () => {
		const { container } = render(<SettingsView onDone={() => {}} />)
		const ids = tabIds(container)
		const general = ids.indexOf("general")
		const voice = ids.indexOf("voice")
		const about = ids.indexOf("about")

		expect(general).toBeGreaterThanOrEqual(0)
		expect(voice).toBe(general + 1)
		expect(about).toBe(voice + 1)
	})

	it("keeps the existing tab order intact around the new section", () => {
		const { container } = render(<SettingsView onDone={() => {}} />)
		// "debug" is the dev-only tab and trails the list; everything before it is
		// the pre-existing order with Voice inserted between General and About.
		const ids = tabIds(container).filter((id) => id !== "debug")
		expect(ids).toEqual(["api-config", "features", "auto-phase-plan", "general", "voice", "about"])
	})

	it("labels the new tab and its tooltip", () => {
		const { container } = render(<SettingsView onDone={() => {}} />)
		const voiceTab = container.querySelector("[role='tab'][data-value='voice']")
		expect(voiceTab?.textContent).toContain("Voice")
		expect(container.querySelector("[data-testid='tab-voice']")).toBeTruthy()
	})

	it("does not add a second settings screen for voice", () => {
		// The section is a tab in the existing view, nothing else.
		expect(Object.keys(SETTINGS_NAVIGATION_TARGETS)).toContain("voice")
		expect(resolveSettingsTarget("voice")).toEqual({ tabId: "voice" })
	})
})
