import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { VscodeProviderCredentialStore } from "./vscode-provider-credential-store"

class FakeSecretStorage {
	readonly data = new Map<string, string>()
	onDidChange() {
		return { dispose() {} }
	}
	async get(key: string) {
		return this.data.get(key)
	}
	async store(key: string, value: string) {
		this.data.set(key, value)
	}
	async delete(key: string) {
		this.data.delete(key)
	}
}

let tempDir: string
let providersPath: string

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-provider-creds-"))
	providersPath = path.join(tempDir, "settings", "providers.json")
	await fs.mkdir(path.dirname(providersPath), { recursive: true })
})

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true })
})

describe("VscodeProviderCredentialStore", () => {
	it("moves credentials out of providers.json and merges them back in memory", async () => {
		await fs.writeFile(
			providersPath,
			JSON.stringify(
				{
					version: 1,
					providers: {
						anthropic: {
							settings: {
								provider: "anthropic",
								apiKey: "sk-ant-secret",
								baseUrl: "https://api.anthropic.com",
								aws: { accessKey: "AKIA", secretKey: "aws-secret", region: "us-east-1" },
							},
							updatedAt: new Date().toISOString(),
							tokenSource: "manual",
						},
					},
				},
				null,
				2,
			),
		)
		const fake = new FakeSecretStorage()
		const store = await VscodeProviderCredentialStore.create(fake as never, providersPath)
		expect(store.get("anthropic")).toMatchObject({
			apiKey: "sk-ant-secret",
			aws: { accessKey: "AKIA", secretKey: "aws-secret" },
		})

		const persisted = JSON.parse(await fs.readFile(providersPath, "utf8"))
		expect(persisted.providers.anthropic.settings).not.toHaveProperty("apiKey")
		expect(persisted.providers.anthropic.settings.aws).not.toHaveProperty("accessKey")
		expect(persisted.providers.anthropic.settings.aws).not.toHaveProperty("secretKey")
		expect(persisted.providers.anthropic.settings.aws.region).toBe("us-east-1")
		expect(persisted.providers.anthropic.settings.baseUrl).toBe("https://api.anthropic.com")
	})

	it("writes and deletes SecretStorage blobs", async () => {
		const fake = new FakeSecretStorage()
		const store = await VscodeProviderCredentialStore.create(fake as never, providersPath)
		store.set("openrouter", { apiKey: "sk-or" })
		await store.flush()
		expect(fake.data.get("bytos.providerCredentials.openrouter")).toContain("sk-or")
		store.delete("openrouter")
		await store.flush()
		expect(fake.data.has("bytos.providerCredentials.openrouter")).toBe(false)
	})
})
