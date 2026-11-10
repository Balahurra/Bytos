import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { expect } from "chai"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import * as sinon from "sinon"
import { WebviewProvider } from "@/core/webview"
import { SupabaseAccountService } from "@/services/auth/supabaseAccountService"
import * as actualWebhookHooks from "@/services/lg-cns-integration/webhook-hooks"
import { Logger } from "@/shared/services/Logger"

// bun loads real ESM, so sinon cannot stub the
// `@/services/lg-cns-integration/webhook-hooks` namespace exports ("ES Modules
// cannot be stubbed"). Inject module-level sinon stubs via mock.module so the
// full sinon stub API keeps working.
const writeLgWebhookConfigStub: sinon.SinonStub = sinon.stub()
const writeLgWebhookHooksStub: sinon.SinonStub = sinon.stub()
const webhookHooksMock = () => ({
	...actualWebhookHooks,
	writeLgWebhookConfig: writeLgWebhookConfigStub,
	writeLgWebhookHooks: writeLgWebhookHooksStub,
})
mock.module("@/services/lg-cns-integration/webhook-hooks", webhookHooksMock)
mock.module("@services/lg-cns-integration/webhook-hooks", webhookHooksMock)

import { ErrorService } from "../error"
import { SharedUriHandler } from "./SharedUriHandler"

describe("SharedUriHandler", () => {
	let sandbox: sinon.SinonSandbox
	let handleOpenRouterCallbackStub: sinon.SinonStub
	let handleRequestyCallbackStub: sinon.SinonStub
	let handleOcaAuthCallbackStub: sinon.SinonStub
	let handleHicapCallbackStub: sinon.SinonStub
	let handleAuthCallbackStub: sinon.SinonStub
	let handleTaskCreationStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()
		SupabaseAccountService.resetForTests()

		// Mock Logger methods to avoid HostProvider dependency
		sandbox.stub(Logger, "info").returns()
		sandbox.stub(Logger, "warn").returns()
		sandbox.stub(Logger, "error").returns()
		// Mock ErrorService to avoid telemetry dependency
		const mockErrorService = {
			logMessage: sandbox.stub(),
			logException: sandbox.stub(),
			toBytosError: sandbox.stub(),
			isEnabled: sandbox.stub().returns(false),
			getSettings: sandbox.stub().returns({ enabled: false, hostEnabled: false }),
			getProvider: sandbox.stub(),
			dispose: sandbox.stub().resolves(),
		}
		sandbox.stub(ErrorService, "initialize").resolves(mockErrorService as any)
		sandbox.stub(ErrorService, "get").returns(mockErrorService as any)

		await ErrorService.initialize()

		handleOpenRouterCallbackStub = sandbox.stub().resolves()
		handleRequestyCallbackStub = sandbox.stub().resolves()
		handleOcaAuthCallbackStub = sandbox.stub().resolves()
		handleHicapCallbackStub = sandbox.stub().resolves()
		handleAuthCallbackStub = sandbox.stub().resolves()
		handleTaskCreationStub = sandbox.stub().resolves()
		const mockWebviewProvider = {
			controller: {
				handleOpenRouterCallback: handleOpenRouterCallbackStub,
				handleRequestyCallback: handleRequestyCallbackStub,
				handleOcaAuthCallback: handleOcaAuthCallbackStub,
				handleHicapCallback: handleHicapCallbackStub,
				handleAuthCallback: handleAuthCallbackStub,
				handleTaskCreation: handleTaskCreationStub,
			},
		} as any
		sandbox.stub(WebviewProvider, "getVisibleInstance").returns(mockWebviewProvider)
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("handleUri", () => {
		describe("OpenRouter callback handling", () => {
			it("should successfully handle OpenRouter callback with code", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/openrouter?code=test123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test123")
			})

			it("should return false when OpenRouter code is missing", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/openrouter")

				expect(result).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})

			it("should handle URL with plus signs in code parameter", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/openrouter?code=test+123+abc")

				expect(result).to.be.true
				// Plus signs in query params are preserved
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test+123+abc")
			})
		})

		describe("Other auth callback regression handling", () => {
			it("should still handle the OCA callback with code and state", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/auth/oca?code=oca-code&state=oca-state")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOcaAuthCallbackStub, "oca-code", "oca-state")
			})

			it("should reject the OCA callback when state is missing", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/auth/oca?code=oca-code")

				expect(result).to.be.false
				sinon.assert.notCalled(handleOcaAuthCallbackStub)
			})

			it("should still handle the Requesty callback", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/requesty?code=requesty-code")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleRequestyCallbackStub, "requesty-code")
			})

			it("should still handle the Hicap callback", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/hicap?code=hicap-code")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleHicapCallbackStub, "hicap-code")
			})

			it("should still handle task deep links", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/task?prompt=hello")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleTaskCreationStub, "hello")
			})
		})

		describe("Web account handoff callback (production SupabaseAccountService)", () => {
			const webAuth = { expectedScheme: "vscode", expectedAuthority: "bytos.bytos" }
			const redirectUri = "vscode://bytos.bytos/auth/callback"

			function callback(state: string, extra = "code=code123"): string {
				return `${redirectUri}?state=${encodeURIComponent(state)}&${extra}`
			}

			it("rejects a callback that arrived without the VS Code handler context", async () => {
				const result = await SharedUriHandler.handleUri(callback("any-state"))
				expect(result).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})

			it("rejects a callback with no matching extension-side handoff", async () => {
				const result = await SharedUriHandler.handleUri(callback("unknown-state"), { webAuth })
				expect(result).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})

			it("rejects a wrong scheme on the callback path", async () => {
				const result = await SharedUriHandler.handleUri("https://bytos.bytos/auth/callback?state=x&code=y", { webAuth })
				expect(result).to.be.false
			})

			it("rejects a wrong authority on the callback path", async () => {
				const result = await SharedUriHandler.handleUri("vscode://evil.extension/auth/callback?state=x&code=y", {
					webAuth,
				})
				expect(result).to.be.false
			})

			it("keeps the legacy /auth path rejected", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/auth?code=legacy-code", { webAuth })

				expect(result).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})

			it("never establishes a session for a callback with only legacy token parameters", async () => {
				const result = await SharedUriHandler.handleUri(
					`${redirectUri}?state=anything&idToken=jwt123&refreshToken=rt123`,
					{ webAuth },
				)
				expect(result).to.be.false
			})
		})

		describe("Auth callback handling (disabled)", () => {
			it("should reject idToken instead of treating it as an authorization code", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/auth?idToken=jwt123&provider=google")

				expect(result).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})

			it("should reject refreshToken instead of treating it as an authorization code", async () => {
				const result = await SharedUriHandler.handleUri(
					"vscode://bytos.bytos/auth?refreshToken=refresh123&provider=github",
				)

				expect(result).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})

			it("should reject code without initiating account authentication", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/auth?code=code123&provider=bytos")

				expect(result).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})

			it("should reject auth callbacks from unexpected schemes and hosts", async () => {
				const httpsResult = await SharedUriHandler.handleUri("https://example.com/auth?code=code123")
				const httpResult = await SharedUriHandler.handleUri("http://localhost:3000/auth?code=code123")

				expect(httpsResult).to.be.false
				expect(httpResult).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})

			it("should not change authentication state when a callback is rejected", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/auth?idToken=jwt123")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
				expect(handleRequestyCallbackStub.called).to.be.false
				expect(handleOcaAuthCallbackStub.called).to.be.false
				expect(handleHicapCallbackStub.called).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
			})
		})

		describe("Unknown path handling", () => {
			it("should return false for unknown paths", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/unknown?param=value")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("LG task URI handling", () => {
			it("should setup webhook files and create task from prompt-file", async () => {
				const webhookUrl = "https://example.com/api/updates"
				const webhookToken = "token-123"
				const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lg-task-uri-"))
				try {
					const promptFilePath = path.join(tempDir, "lg-spec.md")
					await fs.writeFile(promptFilePath, "Implement user registration flow", "utf-8")

					const writeConfigStub = writeLgWebhookConfigStub
					writeConfigStub.reset()
					writeConfigStub.resolves()
					const writeHooksStub = writeLgWebhookHooksStub
					writeHooksStub.reset()
					writeHooksStub.resolves()

					const result = await SharedUriHandler.handleUri(
						`vscode://bytos.bytos/lg-task?prompt-file=${encodeURIComponent(
							promptFilePath,
						)}&webhook-url=${encodeURIComponent(webhookUrl)}&webhook-token=${encodeURIComponent(webhookToken)}`,
					)

					expect(result).to.be.true
					sinon.assert.calledOnce(handleTaskCreationStub)
					const taskPrompt = handleTaskCreationStub.firstCall.args[0] as string
					expect(taskPrompt).to.contain(promptFilePath)
					expect(taskPrompt).to.contain("Implement user registration flow")
					expect(taskPrompt).to.contain("re-read")
					sinon.assert.calledOnceWithExactly(writeConfigStub, webhookUrl, webhookToken)
					sinon.assert.calledOnce(writeHooksStub)
				} finally {
					await fs.rm(tempDir, { recursive: true, force: true })
				}
			})

			it("should return false when LG task parameters are missing", async () => {
				const writeConfigStub = writeLgWebhookConfigStub
				writeConfigStub.reset()
				writeConfigStub.resolves()
				const writeHooksStub = writeLgWebhookHooksStub
				writeHooksStub.reset()
				writeHooksStub.resolves()
				const result = await SharedUriHandler.handleUri(
					"vscode://bytos.bytos/lg-task?prompt-file=%2Ftmp%2Fspec.md&webhook-url=https%3A%2F%2Fexample.com",
				)

				expect(result).to.be.false
				expect(handleTaskCreationStub.called).to.be.false
				expect(writeConfigStub.called).to.be.false
				expect(writeHooksStub.called).to.be.false
			})
		})

		describe("Error handling", () => {
			it("should catch and log errors from controller methods", async () => {
				handleOpenRouterCallbackStub.rejects(new Error("Controller error"))

				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/openrouter?code=test123")

				expect(result).to.be.false
			})

			it("should handle malformed URIs gracefully", async () => {
				const result = await SharedUriHandler.handleUri("invalid://uri")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Query parameter parsing", () => {
			it("should correctly parse multiple query parameters", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/openrouter?code=test123&extra=param")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test123")
			})

			it("should handle URL-encoded parameters", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/openrouter?code=test%20with%20spaces")

				expect(result).to.be.true
				// URLSearchParams should decode %20 to spaces
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test with spaces")
			})

			it("should handle empty query string", async () => {
				const result = await SharedUriHandler.handleUri("vscode://bytos.bytos/openrouter")

				expect(result).to.be.false
				expect(handleAuthCallbackStub.called).to.be.false
				expect(handleOpenRouterCallbackStub.called).to.be.false
			})
		})

		describe("Different URI schemes", () => {
			it("should handle HTTP scheme URIs", async () => {
				const result = await SharedUriHandler.handleUri("http://localhost:3000/openrouter?code=test123")

				expect(result).to.be.true
				sinon.assert.calledOnceWithExactly(handleOpenRouterCallbackStub, "test123")
			})

			it("should reject HTTPS auth callbacks", async () => {
				const result = await SharedUriHandler.handleUri("https://example.com/auth?idToken=jwt123&provider=github")

				expect(result).to.be.false
				sinon.assert.notCalled(handleAuthCallbackStub)
			})
		})
	})
})
