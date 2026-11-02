// Under vitest, `@bytos/core` is aliased to src/test/bytos-core-vitest-stub.ts
// (see vitest.config.ts), which holds models.json state in memory and exposes
// the stub-only `resetModelsFileState` — hence the cast below.
import * as BytosCore from "@bytos/core"
import { resetRegistry } from "@bytos/llms"
import { beforeEach } from "vitest"

const { resetModelsFileState } = BytosCore as typeof BytosCore & { resetModelsFileState(): void }

beforeEach(() => {
	resetModelsFileState()
	// The stub's syncStoredProviderRegistration mutates the real shared
	// @bytos/llms registry; reset it so registrations never leak across tests.
	resetRegistry()
})
