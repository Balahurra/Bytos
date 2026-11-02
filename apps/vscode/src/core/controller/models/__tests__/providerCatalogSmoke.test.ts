import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { StateManager } from "@/core/storage/StateManager"
import { createProviderCatalog } from "@/sdk/model-catalog/catalog"
import type { ProviderCatalog, ProviderConfigStore } from "@/sdk/model-catalog/contracts"
import { createProviderConfigStore } from "@/sdk/model-catalog/store"
import { Empty, StringRequest } from "@/shared/proto/bytos/common"
import { CommitModelSelectionRequest } from "@/shared/proto/bytos/models"
import { createStorageContext } from "@/shared/storage/storage-context"
import { commitModelSelection } from "../commitModelSelection"
import { listProviders } from "../listProviders"
import type { ProviderCatalogController } from "../providerCatalogShared"
import { readProviderConfig } from "../readProviderConfig"
import { resolveProviderModels } from "../resolveProviderModels"

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
}))

describe("provider model catalog backend smoke", () => {
	let bytosDir: string
	let store: ProviderConfigStore
	let catalog: ProviderCatalog
	let controller: ProviderCatalogController
	let originalBytosDir: string | undefined

	beforeAll(async () => {
		bytosDir = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-provider-catalog-smoke-"))
		originalBytosDir = process.env.BYTOS_DIR
		process.env.BYTOS_DIR = bytosDir
		await StateManager.initialize(createStorageContext({ bytosDir, workspacePath: bytosDir }))
		store = createProviderConfigStore()
		catalog = createProviderCatalog(store)
		controller = {
			getProviderConfigStore: () => store,
			getProviderCatalog: () => catalog,
		}
	})

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		if (originalBytosDir === undefined) {
			delete process.env.BYTOS_DIR
		} else {
			process.env.BYTOS_DIR = originalBytosDir
		}
		await StateManager.get().reInitialize()
		await fs.rm(bytosDir, { recursive: true, force: true })
	})

	it("lists providers, resolves DeepSeek models, and round-trips committed selection", async () => {
		const providers = await listProviders(controller, Empty.create())
		expect(providers.providers.length).toBeGreaterThanOrEqual(4)
		expect(providers.providers.some((provider) => provider.id === "deepseek")).toBe(true)

		const models = await resolveProviderModels(controller, {
			providerId: "deepseek",
			forceRefresh: false,
			requestId: "smoke-request",
		})
		expect(models.ok).toBe(true)
		expect(models.requestId).toBe("smoke-request")
		// Don't pin an exact count: the generated catalog is refreshed regularly
		// and DeepSeek's lineup changes (e.g. the v4 refresh shrank it to 3).
		expect(Object.keys(models.models).length).toBeGreaterThan(0)

		const modelId = models.defaultModelId || Object.keys(models.models)[0]
		expect(modelId).toBeTruthy()
		const modelInfo = models.models[modelId]
		expect(modelInfo).toBeDefined()

		await commitModelSelection(
			controller,
			CommitModelSelectionRequest.create({
				providerId: "deepseek",
				mode: "act",
				modelId,
			}),
		)

		const config = await readProviderConfig(controller, StringRequest.create({ value: "deepseek" }))
		expect(config.providerId).toBe("deepseek")
		expect(config.actSelection?.providerId).toBe("deepseek")
		expect(config.actSelection?.modelId).toBe(modelId)
		expect(config.actSelection?.modelInfo).toEqual(modelInfo)
		expect(JSON.stringify(config)).not.toContain("SECRET")
	})
})
