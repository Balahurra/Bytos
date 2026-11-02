import { describe, expect, it } from "bun:test";
import { nightlifyPackageJson } from "./nightlify.mjs";

const fixture = {
	name: "bytos",
	displayName: "Bytos",
	publisher: "bytos",
	version: "4.0.0",
	main: "./dist/extension.js",
	contributes: {
		viewsContainers: {
			activitybar: [
				{
					id: "bytos-ActivityBar",
					title: "Bytos",
					icon: "assets/icon.svg",
				},
			],
		},
		views: {
			"bytos-ActivityBar": [
				{ type: "webview", id: "bytos.SidebarProvider" },
			],
		},
		commands: [{ command: "bytos.plusButtonClicked", title: "New Task" }],
		keybindings: [{ command: "bytos.addToChat", key: "ctrl+'" }],
		menus: {
			"view/title": [
				{
					command: "bytos.plusButtonClicked",
					when: "view == bytos.SidebarProvider",
				},
				// Mid-string references are NOT rewritten — a known limitation
				// shared with the standalone nightly's publish-nightly.mjs.
				{ command: "bytos.addToChat", when: "config.bytos.enableExtras" },
			],
		},
		configuration: {
			title: "Bytos",
			properties: { "bytos.enableExtras": { type: "boolean" } },
		},
	},
};

describe("nightlifyPackageJson", () => {
	const pkg = JSON.parse(
		nightlifyPackageJson(JSON.stringify(fixture, null, "\t"), "4.0.1752600000"),
	);

	it("sets the nightly identity and the supplied version", () => {
		expect(pkg.name).toBe("bytos-nightly");
		expect(pkg.displayName).toBe("Bytos (Nightly)");
		expect(pkg.version).toBe("4.0.1752600000");
		expect(pkg.publisher).toBe("bytos");
	});

	it("rewrites bytos IDs and the bytos.* namespace", () => {
		expect(pkg.contributes.viewsContainers.activitybar[0].id).toBe(
			"bytos-nightly-ActivityBar",
		);
		expect(pkg.contributes.viewsContainers.activitybar[0].title).toBe(
			"Bytos (Nightly)",
		);
		expect(Object.keys(pkg.contributes.views)).toEqual([
			"bytos-nightly-ActivityBar",
		]);
		expect(pkg.contributes.views["bytos-nightly-ActivityBar"][0].id).toBe(
			"bytos-nightly.SidebarProvider",
		);
		expect(pkg.contributes.commands[0].command).toBe(
			"bytos-nightly.plusButtonClicked",
		);
		expect(pkg.contributes.keybindings[0].command).toBe(
			"bytos-nightly.addToChat",
		);
		expect(Object.keys(pkg.contributes.configuration.properties)).toEqual([
			"bytos-nightly.enableExtras",
		]);
	});

	it("rewrites when-clauses that start with a rewritten ID, but not mid-string references", () => {
		const [gated, midString] = pkg.contributes.menus["view/title"];
		expect(gated.when).toBe("view == bytos-nightly.SidebarProvider");
		// Documented limitation: `config.bytos.` does not match the `"bytos.`
		// pattern, so it survives unrewritten (matches publish-nightly.mjs).
		expect(midString.when).toBe("config.bytos.enableExtras");
	});

	it("requires a version", () => {
		expect(() => nightlifyPackageJson("{}", undefined)).toThrow(/version/);
	});
});
