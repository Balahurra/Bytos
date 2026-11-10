import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getBytosCliMigrationNotice,
	markBytosCliMigrationNoticeShown,
	resolveCliNoticeStatePath,
} from "./notice";

const tempDirs: string[] = [];

function createTempDataDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "bytos-cli-notice-"));
	tempDirs.push(dir);
	return dir;
}

describe("migration notice", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns the desktop notice for a fresh data dir", () => {
		const dataDir = createTempDataDir();

		const notice = getBytosCliMigrationNotice(dataDir);
		expect(notice?.id).toBe("bytos-cli-desktop-launch");
		expect(notice?.url).toBe("https://bytos.dev/desktop");
	});

	it("does not show after the notice is marked as shown", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);

		expect(getBytosCliMigrationNotice(dataDir)).toBeUndefined();
	});

	it("shows when forced even after it was marked as shown", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);

		expect(
			getBytosCliMigrationNotice(dataDir, {
				BYTOS_FORCE_CLINE_PASS_NOTICE: "1",
			}),
		).toBeDefined();
	});

	it("does not show when disabled through the environment", () => {
		const dataDir = createTempDataDir();

		expect(
			getBytosCliMigrationNotice(dataDir, {
				BYTOS_DISABLE_CLINE_PASS_NOTICE: "1",
			}),
		).toBeUndefined();
	});

	it("marks the notice as shown", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);

		const rawState = readFileSync(resolveCliNoticeStatePath(dataDir), "utf8");
		expect(rawState).toContain("bytos-cli-desktop-launch");
		expect(getBytosCliMigrationNotice(dataDir)).toBeUndefined();
	});
});
