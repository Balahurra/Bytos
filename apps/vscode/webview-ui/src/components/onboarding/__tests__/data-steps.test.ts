import { describe, expect, it } from "vitest"
import { getUserTypeSelections, NEW_USER_TYPE } from "../data-steps"

describe("getUserTypeSelections", () => {
	it("offers free, frontier, and BYOK without a hosted subscription option", () => {
		const selections = getUserTypeSelections()
		expect(selections.map((s) => s.type)).toEqual([NEW_USER_TYPE.FREE, NEW_USER_TYPE.POWER, NEW_USER_TYPE.BYOK])
		expect(selections.some((s) => (s.type as string) === "cline-pass")).toBe(false)
	})
})
