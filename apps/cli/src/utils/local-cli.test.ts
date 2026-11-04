import { isLocalAuthProvider } from "@bytos/core";
import { describe, expect, it } from "vitest";
import { getLocalCliInfo } from "./local-cli";

describe("local CLI providers", () => {
	it("reads the CLI a local-auth provider borrows credentials from", () => {
		expect(getLocalCliInfo("openai-codex-cli")).toEqual({
			command: "codex",
			docsUrl: "https://developers.openai.com/codex/cli",
		});
	});

	it("names no CLI for key-based providers or providers removed from the BYOK build", () => {
		expect(getLocalCliInfo("anthropic")).toBeUndefined();
		expect(getLocalCliInfo("openai-codex")).toBeUndefined();
		// The Claude Code subscription provider was removed from the free BYOK
		// build (its SDK cannot be redistributed), so it has no local CLI.
		expect(getLocalCliInfo("claude-code")).toBeUndefined();
	});

	// Routing is keyed off the capability alone, so a local-auth provider whose
	// credentials come from somewhere unprobeable still reaches the local setup
	// screen instead of an empty API-key form.
	it("routes on the capability, not on knowing a CLI", () => {
		expect(isLocalAuthProvider("openai-codex-cli")).toBe(true);
		expect(isLocalAuthProvider("anthropic")).toBe(false);
		// Removed BYOK provider: no local-auth capability in this build.
		expect(isLocalAuthProvider("claude-code")).toBe(false);
	});
});
