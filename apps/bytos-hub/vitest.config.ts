import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	root: rootDir,
	resolve: {
		alias: [
			{
				find: /^@\/(.+)$/,
				replacement: resolve(rootDir, "src/webview/src/$1"),
			},
			{
				find: /^@bytos\/core$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/index.ts"),
			},
			{
				find: /^@bytos\/core\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/core/src/$1"),
			},
			{
				find: /^@bytos\/shared$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/index.ts"),
			},
			{
				find: /^@bytos\/shared\/(.+)$/,
				replacement: resolve(rootDir, "../../sdk/packages/shared/src/$1"),
			},
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
