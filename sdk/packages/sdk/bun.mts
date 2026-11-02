export {};

const sourcemap = Bun.env.BYTOS_SOURCEMAPS === "1" ? "linked" : "none";
// minify: true keeps identifier mangling active even when sourcemaps are enabled.
const minify = Bun.env.BYTOS_SOURCEMAPS !== "1";

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	packages: "bundle",
	minify,
	sourcemap,
	external: ["@bytos/core"],
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
