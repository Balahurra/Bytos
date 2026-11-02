export function isBytosManagedProvider(provider: string | undefined) {
	return provider === "bytos" || provider === "bytos-pass"
}
