import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ChatTextArea from "./ChatTextArea"

const mocks = vi.hoisted(() => ({
	supportsImages: true as boolean | undefined,
	navigateToSettingsModelPicker: vi.fn(),
	cloudState: {} as Record<string, unknown>,
	/** F4: what the host reports for voice readiness. */
	voiceStatus: undefined as Record<string, unknown> | undefined,
	/** F4: what `transcribeUtterance` answers with. */
	transcript: { text: "", language: "tr", modelId: "base" } as Record<string, unknown>,
	/** F4: `voiceEnabled` as pushed by the host. */
	voiceEnabled: true,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mode: "act",
		apiConfiguration: {},
		openRouterModels: {},
		platform: "darwin",
		localWorkflowToggles: {},
		globalWorkflowToggles: {},
		remoteWorkflowToggles: {},
		remoteConfigSettings: undefined,
		navigateToSettingsModelPicker: mocks.navigateToSettingsModelPicker,
		mcpServers: [],
		voiceEnabled: mocks.voiceEnabled,
		voiceLanguage: "auto",
		voiceModelId: "base",
		...mocks.cloudState,
	}),
}))

vi.mock("@/context/PlatformContext", () => ({
	usePlatform: () => ({ togglePlanActKeys: "Meta+Shift+a" }),
}))

vi.mock("@/hooks/useNormalizedApiConfiguration", () => ({
	useNormalizedApiConfiguration: () => ({
		selectedProvider: "anthropic",
		selectedModelId: "text-only-model",
		selectedModelInfo: { supportsImages: mocks.supportsImages },
	}),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		searchCommits: vi.fn(async () => ({ commits: [] })),
		searchFiles: vi.fn(async () => ({ results: [] })),
		getRelativePaths: vi.fn(async () => ({ paths: [] })),
		openImage: vi.fn(async () => ({})),
		openFile: vi.fn(async () => ({})),
	},
	StateServiceClient: {
		togglePlanActModeProto: vi.fn(async () => ({})),
	},
	VoiceServiceClient: {
		getVoiceServiceStatus: vi.fn(async () => mocks.voiceStatus),
		subscribeToVoiceEvents: vi.fn(() => () => {}),
		startCapture: vi.fn(async () => ({ sessionId: "voice-1", sampleRate: 16000, channels: 1, backend: "wasapi" })),
		cancelCapture: vi.fn(async () => ({})),
		transcribeUtterance: vi.fn(async () => mocks.transcript),
	},
}))

vi.mock("../bytos-rules/BytosRulesToggleModal", () => ({ default: () => null }))
vi.mock("./ServersToggleModal", () => ({ default: () => null }))

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo="

function renderTextArea(selectedImages: string[] = [], inputValue = "") {
	const setSelectedImages = vi.fn()
	const onSend = vi.fn()
	const setInputValue = vi.fn()
	render(
		<ChatTextArea
			activeQuote={null}
			inputValue={inputValue}
			onSelectFilesAndImages={vi.fn()}
			onSend={onSend}
			placeholderText="Type a message"
			selectedFiles={[]}
			selectedImages={selectedImages}
			sendingDisabled={false}
			setInputValue={setInputValue}
			setSelectedFiles={vi.fn()}
			setSelectedImages={setSelectedImages}
			shouldDisableFilesAndImages={false}
		/>,
	)
	return { textarea: screen.getByPlaceholderText("Type a message"), setSelectedImages, onSend, setInputValue }
}

/** The host's "everything works" answer, as `VoiceServiceStatus` fields. */
const READY_VOICE_STATUS = {
	capability: { canCapture: true, backend: "wasapi", unavailableReason: "", osLabel: "Windows x64 (local)" },
	language: "auto",
	modelId: "base",
	models: [{ id: "base", displayName: "Base", state: "ready", installed: true, verified: true, isDefault: true }],
	engineState: "ready",
	engineErrorCode: "",
	transcribeReady: true,
	microphoneAvailable: true,
	microphoneErrorCode: "",
	devices: [{ id: "dev-a", name: "Microphone Array", state: "active", isDefault: true }],
}

function pasteImage(target: HTMLElement) {
	const file = new File(["png"], "screenshot.png", { type: "image/png" })
	return fireEvent.paste(target, {
		clipboardData: {
			items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
			getData: () => "",
		},
	})
}

describe("ChatTextArea model label", () => {
	beforeEach(() => {
		mocks.cloudState = {}
	})

	it("shows the local provider and model for a local task", () => {
		renderTextArea()
		expect(screen.getByTitle("Open API Settings")).toHaveTextContent("anthropic:text-only-model")
	})

	it.each([
		["a new task targets Cloud", { cloudSessionsEnabled: true, cloudTaskTarget: { target: "cloud" } }],
		["a cloud task is shown", { currentCloudTask: { sessionId: "ses-1", status: "running" } }],
	])("shows the cloud model and hides the Plan/Act toggle when %s", (_case, cloudState) => {
		mocks.cloudState = { ...cloudState, cloudModelId: "anthropic/claude-sonnet-4.5" }
		renderTextArea()
		expect(screen.getByTitle("Open API Settings")).toHaveTextContent("bytos:anthropic/claude-sonnet-4.5")
		expect(screen.queryByTestId("mode-switch")).not.toBeInTheDocument()
	})
})

describe("ChatTextArea image attachments vs. model capability", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.cloudState = {}
		mocks.navigateToSettingsModelPicker.mockReset()
	})

	it("renders before optional cloud state has hydrated", () => {
		renderTextArea()

		expect(screen.getByPlaceholderText("Type a message")).toBeInTheDocument()
		expect(screen.getByTestId("mode-switch")).toBeInTheDocument()
	})

	it("still takes the image attach path on paste for a text-only model, without a refusal message", () => {
		mocks.supportsImages = false
		const { textarea } = renderTextArea()

		const notCanceled = pasteImage(textarea)

		expect(notCanceled).toBe(false) // preventDefault: the paste was handled as an image, not as text
		expect(screen.queryByText(/ignored/)).not.toBeInTheDocument()
	})

	it("badges attached images and offers a model switch when the model is text-only", () => {
		mocks.supportsImages = false
		renderTextArea([PNG_DATA_URL, PNG_DATA_URL])

		const notice = screen.getByTestId("images-unsupported-notice")
		expect(notice).toHaveTextContent("text-only-model doesn't support images, so the 2 attached images will be ignored.")
		expect(screen.getAllByTestId("image-unsupported-badge")).toHaveLength(2)

		// A native button, so keyboard users get Enter/Space activation without extra handlers.
		const chooseModel = screen.getByRole("button", { name: "Choose an image-capable model" })
		expect(chooseModel.tagName).toBe("BUTTON")
		fireEvent.click(chooseModel)
		expect(mocks.navigateToSettingsModelPicker).toHaveBeenCalledWith({ targetSection: "api-config" })
	})

	it("uses singular wording for one image", () => {
		mocks.supportsImages = false
		renderTextArea([PNG_DATA_URL])

		expect(screen.getByTestId("images-unsupported-notice")).toHaveTextContent("the attached image will be ignored")
		expect(screen.getByTestId("images-unsupported-notice")).toHaveTextContent("or remove it.")
	})

	it("shows nothing extra when the model supports images", () => {
		renderTextArea([PNG_DATA_URL])

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
		expect(screen.queryByTestId("image-unsupported-badge")).not.toBeInTheDocument()
	})

	it("fails open when the model's image support is unknown", () => {
		mocks.supportsImages = undefined
		renderTextArea([PNG_DATA_URL])

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
	})

	it("shows nothing for a text-only model while no images are attached", () => {
		mocks.supportsImages = false
		renderTextArea()

		expect(screen.queryByTestId("images-unsupported-notice")).not.toBeInTheDocument()
	})
})

/**
 * F4 — the microphone button in the composer.
 *
 * Position is asserted structurally, not visually: the button must be the
 * immediate previous sibling of the Send arrow inside the same row, which is the
 * only way it can sit "directly left of Send" without changing the layout.
 */
describe("ChatTextArea voice input button", () => {
	beforeEach(() => {
		mocks.supportsImages = true
		mocks.cloudState = {}
		mocks.voiceStatus = READY_VOICE_STATUS
		mocks.voiceEnabled = true
		mocks.transcript = { text: "", language: "tr", modelId: "base" }
	})

	it("sits immediately left of the Send arrow, in the same row", () => {
		renderTextArea()

		const voiceButton = screen.getByTestId("voice-button")
		const sendButton = screen.getByTestId("send-button")

		// Same row container, adjacent, voice before send.
		expect(voiceButton.parentElement).toBe(sendButton.parentElement)
		expect(voiceButton.nextElementSibling).toBe(sendButton)
	})

	it("leaves the Send arrow where it was and does not add a second icon", () => {
		renderTextArea()

		expect(screen.getAllByTestId("send-button")).toHaveLength(1)
		expect(screen.getAllByTestId("voice-button")).toHaveLength(1)
		// Still the composer's own icon button styling, so hover/focus match Send.
		expect(screen.getByTestId("voice-button").className).toContain("input-icon-button")
	})

	it.each([
		["idle", { engineState: "missing", transcribeReady: false }],
	])("is disabled and explains itself when the host is not ready (%s)", async (_case, patch) => {
		mocks.voiceStatus = { ...READY_VOICE_STATUS, ...patch }
		renderTextArea()

		const voiceButton = screen.getByTestId("voice-button")
		await waitFor(() => expect(voiceButton).toHaveAttribute("title", "The speech recognition engine is not installed."))
		expect(voiceButton).toBeDisabled()
	})

	it("is disabled with an actionable sentence when Voice is turned off", async () => {
		mocks.voiceEnabled = false
		renderTextArea()

		const voiceButton = screen.getByTestId("voice-button")
		await waitFor(() => expect(voiceButton).toHaveAttribute("title", "Voice input is off. Turn it on in Settings → Voice."))
		expect(voiceButton).toBeDisabled()
	})

	it("is disabled when no microphone is present", async () => {
		mocks.voiceStatus = { ...READY_VOICE_STATUS, microphoneAvailable: false, microphoneErrorCode: "NO_CAPTURE_DEVICE" }
		renderTextArea()

		const voiceButton = screen.getByTestId("voice-button")
		await waitFor(() => expect(voiceButton).toHaveAttribute("title", "No microphone was found on this machine."))
		expect(voiceButton).toBeDisabled()
	})

	it("is enabled and idle-labelled when capture and recognition are ready", async () => {
		renderTextArea()

		const voiceButton = screen.getByTestId("voice-button")
		// Readiness comes from the host, so it settles one tick after mount.
		await waitFor(() => expect(voiceButton).toBeEnabled())
		expect(voiceButton).toHaveAttribute("data-dictation-phase", "idle")
		expect(voiceButton).toHaveAttribute("aria-label", "Voice input")
		expect(voiceButton).toHaveAttribute("title", "Voice input")
	})

	it("does not send anything when the transcript arrives", async () => {
		mocks.transcript = { text: "merhaba dünya", language: "tr", modelId: "base" }
		const { onSend, setInputValue } = renderTextArea([], "Fix the build")

		const voiceButton = screen.getByTestId("voice-button")
		// Wait for the host's readiness read to unlock the button.
		await waitFor(() => expect(voiceButton).toBeEnabled())
		fireEvent.click(voiceButton)
		await waitFor(() => expect(voiceButton).toHaveAttribute("data-dictation-phase", "recording"))
		fireEvent.click(voiceButton)

		// The transcript is APPENDED to the existing draft…
		await waitFor(() => expect(setInputValue).toHaveBeenCalledWith("Fix the build merhaba dünya"))
		// …and nothing is submitted: Send is still the only way to send.
		expect(onSend).not.toHaveBeenCalled()
	})
})
