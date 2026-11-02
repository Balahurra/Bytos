import {
	type RuleFrontmatterWriteResult,
	resolveRuleWriteRoots,
	setRuleDisabledInFrontmatter,
} from "@core/context/instructions/user-instructions/bytos-rules"
import { getWorkspaceBasename } from "@core/workspace"
import type { ToggleBytosRuleRequest } from "@shared/proto/bytos/file"
import { RuleScope, ToggleBytosRules } from "@shared/proto/bytos/file"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Toggles a Bytos rule (enable or disable)
 * @param controller The controller instance
 * @param request The toggle request
 * @returns The updated Bytos rule toggles
 */
export async function toggleBytosRule(controller: Controller, request: ToggleBytosRuleRequest): Promise<ToggleBytosRules> {
	const { scope, rulePath, enabled } = request

	if (!rulePath || typeof enabled !== "boolean" || scope === undefined) {
		Logger.error("toggleBytosRule: Missing or invalid parameters", {
			rulePath,
			scope,
			enabled: typeof enabled === "boolean" ? enabled : `Invalid: ${typeof enabled}`,
		})
		throw new Error("Missing or invalid parameters for toggleBytosRule")
	}

	// Handle the three different scopes
	switch (scope) {
		case RuleScope.GLOBAL: {
			const toggles = controller.stateManager.getGlobalSettingsKey("globalBytosRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("globalBytosRulesToggles", toggles)
			break
		}
		case RuleScope.LOCAL: {
			const toggles = controller.stateManager.getWorkspaceStateKey("localBytosRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setWorkspaceState("localBytosRulesToggles", toggles)
			break
		}
		case RuleScope.REMOTE: {
			const toggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")
			toggles[rulePath] = enabled
			controller.stateManager.setGlobalState("remoteRulesToggles", toggles)
			break
		}
		default:
			throw new Error(`Invalid scope: ${scope}`)
	}

	// The SDK rule loader reads the document's `disabled` frontmatter flag, not
	// the extension's toggle state, so file-backed global and workspace rules
	// are written as well. The write is confined to rule documents directly
	// inside the scope's rule roots; anything else keeps only the state toggle.
	// If a rule file cannot be written, the state toggle is reverted so the
	// panel keeps showing what the SDK will actually load.
	if (scope !== RuleScope.REMOTE) {
		let result: RuleFrontmatterWriteResult = "failed"
		try {
			const allowedRoots = await resolveRuleWriteRoots(scope === RuleScope.GLOBAL ? "global" : "local")
			result = await setRuleDisabledInFrontmatter(rulePath, enabled, allowedRoots)
		} catch (error) {
			Logger.warn(`toggleBytosRule: could not persist frontmatter for ${rulePath}`, error)
		}
		if (result === "failed") {
			Logger.warn(`toggleBytosRule: reverting toggle for ${rulePath}; the rule file could not be updated`)
			if (scope === RuleScope.GLOBAL) {
				const toggles = controller.stateManager.getGlobalSettingsKey("globalBytosRulesToggles")
				toggles[rulePath] = !enabled
				controller.stateManager.setGlobalState("globalBytosRulesToggles", toggles)
			} else {
				const toggles = controller.stateManager.getWorkspaceStateKey("localBytosRulesToggles")
				toggles[rulePath] = !enabled
				controller.stateManager.setWorkspaceState("localBytosRulesToggles", toggles)
			}
		}
	}

	// Track rule toggle telemetry with current task context
	if (controller.task?.ulid) {
		// Extract just the filename for privacy (no full paths)
		const ruleFileName = getWorkspaceBasename(rulePath, "Controller.toggleBytosRule")
		const isGlobal = scope === RuleScope.GLOBAL
		telemetryService.captureBytosRuleToggled(controller.task.ulid, ruleFileName, enabled, isGlobal)
	}

	// Get the current state to return in the response
	const globalToggles = controller.stateManager.getGlobalSettingsKey("globalBytosRulesToggles")
	const localToggles = controller.stateManager.getWorkspaceStateKey("localBytosRulesToggles")
	const remoteToggles = controller.stateManager.getGlobalStateKey("remoteRulesToggles")

	return ToggleBytosRules.create({
		globalBytosRulesToggles: { toggles: globalToggles },
		localBytosRulesToggles: { toggles: localToggles },
		remoteRulesToggles: { toggles: remoteToggles },
	})
}
