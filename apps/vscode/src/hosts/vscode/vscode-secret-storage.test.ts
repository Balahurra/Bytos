import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { migrateLegacySecretsFile, VscodeSecretStorage } from "./vscode-secret-storage"

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

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-secret-storage-"))
})

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true })
})

describe("VscodeSecretStorage", () => {
	it("hydrates from SecretStorage and writes through", async () => {
		const fake = new FakeSecretStorage()
		fake.data.set("apiKey", "sk-existing")
		const store = await VscodeSecretStorage.create(fake as never, ["apiKey", "openRouterApiKey"])
		expect(store.get("apiKey")).toBe("sk-existing")

		store.set("openRouterApiKey", "sk-or-new")
		await store.flush()
		expect(fake.data.get("openRouterApiKey")).toBe("sk-or-new")
		store.delete("apiKey")
		await store.flush()
		expect(fake.data.has("apiKey")).toBe(false)
	})

	it("migrates and removes a legacy secrets.json only after verification", async () => {
		const fake = new FakeSecretStorage()
		const legacyPath = path.join(tempDir, "secrets.json")
		await fs.writeFile(legacyPath, JSON.stringify({ apiKey: "sk-legacy", openRouterApiKey: "sk-or-legacy" }))
		const store = await VscodeSecretStorage.create(fake as never, [])
		const result = await migrateLegacySecretsFile(tempDir, store)
		expect(result).toEqual({ migrated: 2, preserved: false })
		expect(fake.data.get("apiKey")).toBe("sk-legacy")
		expect(fake.data.get("openRouterApiKey")).toBe("sk-or-legacy")
		await expect(fs.access(legacyPath)).rejects.toThrow()
	})

	it("preserves a malformed legacy file", async () => {
		const fake = new FakeSecretStorage()
		const legacyPath = path.join(tempDir, "secrets.json")
		await fs.writeFile(legacyPath, "{not-json")
		const store = await VscodeSecretStorage.create(fake as never, [])
		const result = await migrateLegacySecretsFile(tempDir, store)
		expect(result.preserved).toBe(true)
		await expect(fs.access(legacyPath)).resolves.toBeUndefined()
	})
})
