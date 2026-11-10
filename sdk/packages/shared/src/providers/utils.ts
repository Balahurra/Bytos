export function isBytosProvider(providerId: string): boolean {
	// Both hosted gateway ids are served by the shared "bytos" AI SDK
	// transport. Account-specific code must not use this predicate alone.
	return providerId === "bytos" || providerId === "cline-pass";
}
