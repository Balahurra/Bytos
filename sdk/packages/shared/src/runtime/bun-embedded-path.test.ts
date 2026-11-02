import { describe, expect, it } from "vitest";
import { isBunEmbeddedModulePath } from "./bun-embedded-path";

describe("isBunEmbeddedModulePath", () => {
	it.each([
		"/$bunfs/root/entry.js",
		"/$bunfs/root/bytos",
		"B:\\~BUN\\root\\entry.js",
		"B:/~BUN/root/entry.js",
		"b:\\~bun\\root\\entry.js",
		"  B:\\~BUN\\root\\entry.js  ",
	])("detects the embedded path %s", (path) => {
		expect(isBunEmbeddedModulePath(path)).toBe(true);
	});

	it.each([
		undefined,
		"",
		"   ",
		"/usr/local/bin/bytos",
		"C:\\Users\\me\\AppData\\Local\\Bytos\\code-sidecar.exe",
		"./entry.js",
		"B:\\real-drive\\entry.js",
		"/home/user/$bunfs/root/entry.js",
	])("rejects the ordinary path %s", (path) => {
		expect(isBunEmbeddedModulePath(path)).toBe(false);
	});
});
