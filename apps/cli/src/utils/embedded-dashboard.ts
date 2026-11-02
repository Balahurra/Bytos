declare const __BYTOS_DASHBOARD_RUNTIME_DIR__: string | undefined;

export function resolveEmbeddedDashboard(): string | undefined {
	return typeof __BYTOS_DASHBOARD_RUNTIME_DIR__ === "undefined"
		? undefined
		: __BYTOS_DASHBOARD_RUNTIME_DIR__;
}
