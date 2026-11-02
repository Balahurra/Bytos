import { describe, expect, it } from "bun:test";
import { setPackageVersion } from "./set-version.mjs";

const fixture = JSON.stringify(
	{
		name: "bytos",
		displayName: "Bytos",
		publisher: "bytos",
		version: "4.0.0",
		contributes: {
			commands: [{ command: "bytos.plusButtonClicked", title: "New Task" }],
		},
	},
	null,
	"\t",
);

describe("setPackageVersion", () => {
	it("stamps the version and touches nothing else", () => {
		const pkg = JSON.parse(setPackageVersion(fixture, "4.1.0"));
		expect(pkg.version).toBe("4.1.0");
		expect(pkg.name).toBe("bytos");
		expect(pkg.displayName).toBe("Bytos");
		expect(pkg.publisher).toBe("bytos");
		expect(pkg.contributes.commands[0].command).toBe(
			"bytos.plusButtonClicked",
		);
	});

	it("requires a version", () => {
		expect(() => setPackageVersion(fixture, undefined)).toThrow(/version/);
		expect(() => setPackageVersion(fixture, "")).toThrow(/version/);
	});
});
