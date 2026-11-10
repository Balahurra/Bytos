import { defineConfig } from "vitest/config";

// Keep this evaluation package isolated from the repository-root workspace
// config. Without it Vitest walks up to the root projects definition and
// resolves SDK project paths relative to this directory.
export default defineConfig({
	// Vite 8 resolves the transform tsconfig from the project root. Being
	// explicit keeps this package independent of repository-root config.
	tsconfig: "./tsconfig.json",
	test: {
		include: ["src/**/*.test.ts"],
		environment: "node",
	},
});
