import { CORE_BUILD_VERSION } from "@bytos/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { version as extensionVersion } from "../../package.json"
import { buildSdkProviderConfig } from "./sdk-api-handler"

const mocks = vi.hoisted(() => {
	const providerSettingsManager = {
		getProviderSettings: vi.fn(),
	}
	return {
		getProviderSettingsManager: vi.fn(() => providerSettingsManager),
		providerSettingsManager,
	}
})

vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: mocks.getProviderSettingsManager,
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		warn: vi.fn(),
	},
}))

describe("buildSdkProviderConfig", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("uses the user-supplied Cline API key for ClinePass direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "cline-pass") {
				return undefined
			}
			return {
				provider: "cline-pass",
				apiKey: "cline-user-key",
				baseUrl: "https://api.cline.bot/api/v1",
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "cline-pass/glm-5.2",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "cline-pass",
			modelId: "cline-pass/glm-5.2",
			apiKey: "cline-user-key",
		})
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("cline-pass")
	})

	it("uses provider-specific settings for SDK-backed direct handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId !== "v0") {
				return undefined
			}
			return {
				provider: "v0",
				apiKey: "v0-key",
			}
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "v0",
				actModeApiModelId: "v0-1.5-md",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "v0",
			modelId: "v0-1.5-md",
			apiKey: "v0-key",
		})
		expect(mocks.providerSettingsManager.getProviderSettings).toHaveBeenCalledWith("v0")
	})

	it("forwards the Ollama request timeout and context window to standalone handlers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "ollama",
				actModeOllamaModelId: "qwen2.5:7b",
				requestTimeoutMs: 45_000,
				ollamaApiOptionsCtxNum: "16384",
			},
			"act",
		)

		expect(providerConfig).toMatchObject({
			providerId: "ollama",
			modelId: "qwen2.5:7b",
			timeoutMs: 45_000,
			modelInfo: { id: "qwen2.5:7b", contextWindow: 16384 },
		})
	})

	it("attaches the Bytos surface headers for Bytos billing providers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "bytos",
			apiKey: "bytos-token",
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "bytos",
				actModeApiModelId: "deepseek/deepseek-v4-flash",
			},
			"act",
			{
				client: {
					name: "VSCode Extension",
					version: "4.1.16",
					platform: "Visual Studio Code",
					platformVersion: "1.109.0",
					isMultiRoot: false,
				},
			},
		)

		expect(providerConfig.headers).toMatchObject({
			"HTTP-Referer": "https://bytos.dev",
			"X-Title": "Bytos",
			"User-Agent": "Bytos/4.1.16",
			"X-IS-MULTIROOT": "false",
			"X-CLIENT-TYPE": "VSCode Extension",
			"X-CLIENT-VERSION": "4.1.16",
			"X-PLATFORM": "Visual Studio Code",
			"X-PLATFORM-VERSION": "1.109.0",
		})
		// A standalone handler is not a task, so no task id is claimed.
		expect(providerConfig.headers && "X-Task-ID" in providerConfig.headers).toBe(false)
	})

	it("attaches the Bytos surface headers for ClinePass", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "bytos",
			auth: { accessToken: "workos:shared-bytos-token" },
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "cline-pass",
				actModeClinePassModelId: "cline-pass/glm-5.2",
			},
			"act",
		)

		// Without a resolved host context the extension's own identity is used.
		expect(providerConfig.headers).toMatchObject({
			"X-CLIENT-TYPE": "VSCode Extension",
			"X-CLIENT-VERSION": extensionVersion,
			"X-CORE-VERSION": CORE_BUILD_VERSION,
			"User-Agent": `Bytos/${extensionVersion}`,
		})
	})

	it("does not attach Bytos surface headers to other providers, but keeps their stored headers", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue({
			provider: "anthropic",
			apiKey: "sk-ant",
			headers: { "x-custom": "kept" },
		})

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-sonnet-5",
			},
			"act",
		)

		expect(providerConfig.headers).toEqual({ "x-custom": "kept" })
	})

	it("omits timeoutMs for Ollama when no explicit timeout is configured", () => {
		mocks.providerSettingsManager.getProviderSettings.mockReturnValue(undefined)

		const providerConfig = buildSdkProviderConfig(
			{
				actModeApiProvider: "ollama",
				actModeOllamaModelId: "qwen2.5:7b",
			},
			"act",
		)

		expect(providerConfig.providerId).toBe("ollama")
		expect("timeoutMs" in providerConfig).toBe(false)
	})
})
