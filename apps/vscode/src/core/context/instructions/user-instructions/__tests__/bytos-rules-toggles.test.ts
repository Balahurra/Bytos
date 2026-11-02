import { describe, it } from "bun:test"
import { expect } from "chai"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Controller } from "@/core/controller"
import { refreshBytosRulesToggles } from "../bytos-rules"

/**
 * Minimal Controller stub: refreshBytosRulesToggles only touches the
 * stateManager toggle accessors.
 */
function makeControllerStub(initial: {
	globalBytosRulesToggles?: Record<string, boolean>
	localBytosRulesToggles?: Record<string, boolean>
}) {
	const globalState = new Map<string, unknown>([["globalBytosRulesToggles", initial.globalBytosRulesToggles ?? {}]])
	const workspaceState = new Map<string, unknown>([["localBytosRulesToggles", initial.localBytosRulesToggles ?? {}]])
	const controller = {
		stateManager: {
			getGlobalSettingsKey: (key: string) => globalState.get(key) ?? {},
			getGlobalStateKey: (key: string) => globalState.get(key),
			getWorkspaceStateKey: (key: string) => workspaceState.get(key) ?? {},
			setGlobalState: (key: string, value: unknown) => globalState.set(key, value),
			setWorkspaceState: (key: string, value: unknown) => workspaceState.set(key, value),
		},
	}
	return controller as unknown as Controller
}

describe("refreshBytosRulesToggles workspace layouts", () => {
	it("discovers rules in both .bytosrules and .bytos/rules", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-rules-layouts-"))
		try {
			const legacyDir = path.join(workspace, ".bytosrules")
			const bytosRulesDir = path.join(workspace, ".bytos", "rules")
			await fs.mkdir(legacyDir, { recursive: true })
			await fs.mkdir(bytosRulesDir, { recursive: true })
			await fs.writeFile(path.join(legacyDir, "legacy-rule.md"), "Legacy layout rule")
			await fs.writeFile(path.join(bytosRulesDir, "new-rule.md"), "New layout rule")

			const controller = makeControllerStub({})
			const { localToggles } = await refreshBytosRulesToggles(controller, workspace)

			expect(localToggles).to.have.property(path.join(legacyDir, "legacy-rule.md"), true)
			expect(localToggles).to.have.property(path.join(bytosRulesDir, "new-rule.md"), true)
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})

	it("discovers .bytos/rules rules when no .bytosrules directory exists", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-rules-newonly-"))
		try {
			const bytosRulesDir = path.join(workspace, ".bytos", "rules")
			await fs.mkdir(bytosRulesDir, { recursive: true })
			await fs.writeFile(path.join(bytosRulesDir, "only-rule.md"), "Only .bytos/rules layout")

			const controller = makeControllerStub({})
			const { localToggles } = await refreshBytosRulesToggles(controller, workspace)

			expect(localToggles).to.deep.equal({
				[path.join(bytosRulesDir, "only-rule.md")]: true,
			})
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})

	it("preserves disabled toggles per layout and prunes deleted files", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-rules-toggles-"))
		try {
			const legacyDir = path.join(workspace, ".bytosrules")
			const bytosRulesDir = path.join(workspace, ".bytos", "rules")
			await fs.mkdir(legacyDir, { recursive: true })
			await fs.mkdir(bytosRulesDir, { recursive: true })
			const legacyRule = path.join(legacyDir, "a.md")
			const newRule = path.join(bytosRulesDir, "b.md")
			// Disabled rules carry `disabled: true`, which is what the SDK loader
			// and the panel read.
			await fs.writeFile(legacyRule, "---\ndisabled: true\n---\nA")
			await fs.writeFile(newRule, "---\ndisabled: true\n---\nB")

			const controller = makeControllerStub({
				localBytosRulesToggles: {
					[legacyRule]: false,
					[newRule]: false,
					[path.join(bytosRulesDir, "deleted.md")]: true,
				},
			})
			const { localToggles } = await refreshBytosRulesToggles(controller, workspace)

			expect(localToggles).to.deep.equal({
				[legacyRule]: false,
				[newRule]: false,
			})
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})

	it("still excludes .bytosrules workflows/hooks/skills sub-directories", async () => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "bytos-rules-excl-"))
		try {
			const legacyDir = path.join(workspace, ".bytosrules")
			await fs.mkdir(path.join(legacyDir, "workflows"), { recursive: true })
			await fs.mkdir(path.join(legacyDir, "hooks"), { recursive: true })
			await fs.writeFile(path.join(legacyDir, "rule.md"), "Rule")
			await fs.writeFile(path.join(legacyDir, "workflows", "flow.md"), "Workflow")
			await fs.writeFile(path.join(legacyDir, "hooks", "hook.sh"), "#!/bin/sh")

			const controller = makeControllerStub({})
			const { localToggles } = await refreshBytosRulesToggles(controller, workspace)

			expect(localToggles).to.deep.equal({
				[path.join(legacyDir, "rule.md")]: true,
			})
		} finally {
			await fs.rm(workspace, { recursive: true, force: true })
		}
	})
})
