import { getBytosClientIdentity, setBytosClientIdentity } from "@bytos/shared";
import { afterEach, describe, expect, it } from "vitest";
import { buildBytosClientHeaders } from "./bytos-client-headers";

afterEach(() => {
	setBytosClientIdentity(undefined);
});

describe("buildBytosClientHeaders", () => {
	it("falls back to the SDK client type when no identity is registered", () => {
		expect(getBytosClientIdentity()).toBeUndefined();
		expect(buildBytosClientHeaders()).toEqual({
			"HTTP-Referer": "https://bytos.dev",
			"X-Title": "Bytos",
			"X-IS-MULTIROOT": "false",
			"User-Agent": "Bytos/unknown",
			"X-CLIENT-TYPE": "bytos-sdk",
			"X-CLIENT-VERSION": "unknown",
			"X-PLATFORM": "bytos-sdk",
			"X-PLATFORM-VERSION": "unknown",
		});
	});

	it("stamps the registered client identity", () => {
		setBytosClientIdentity({
			name: "VSCode Extension",
			version: "3.40.0",
			platform: "Visual Studio Code",
			platformVersion: "1.100.0",
		});

		expect(buildBytosClientHeaders()).toMatchObject({
			"User-Agent": "Bytos/3.40.0",
			"X-CLIENT-TYPE": "VSCode Extension",
			"X-CLIENT-VERSION": "3.40.0",
			"X-PLATFORM": "Visual Studio Code",
			"X-PLATFORM-VERSION": "1.100.0",
		});
	});

	it("ignores blank identity fields and honors an explicit override", () => {
		setBytosClientIdentity({ name: "  ", version: "9.9.9" });

		expect(buildBytosClientHeaders()).toMatchObject({
			"X-CLIENT-TYPE": "bytos-sdk",
			"X-CLIENT-VERSION": "9.9.9",
			"X-PLATFORM": "bytos-sdk",
			"X-PLATFORM-VERSION": "9.9.9",
		});
		expect(
			buildBytosClientHeaders({ name: "bytos-cli", version: "1.2.3" }),
		).toMatchObject({
			"X-CLIENT-TYPE": "bytos-cli",
			"X-CLIENT-VERSION": "1.2.3",
		});
	});
});
