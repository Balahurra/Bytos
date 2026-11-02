import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getBytosCliMigrationNotice,
	markBytosCliMigrationNoticeShown,
	resolveCliNoticeStatePath,
	shouldSuppressBytosCliMigrationNoticeForActiveProvider,
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

	it("returns the notice for a fresh data dir", () => {
		const dataDir = createTempDataDir();

		expect(getBytosCliMigrationNotice(dataDir)?.title).toBe("Try BytosPass");
	});

	it("shows when only the old Kanban notice was marked as shown", () => {
		const dataDir = createTempDataDir();
		const noticePath = resolveCliNoticeStatePath(dataDir);
		mkdirSync(dirname(noticePath), { recursive: true, mode: 0o700 });
		writeFileSync(
			noticePath,
			`${JSON.stringify(
				{ shown: { "bytos-cli-tui-default": true } },
				null,
				2,
			)}\n`,
			"utf8",
		);

		expect(getBytosCliMigrationNotice(dataDir)?.id).toBe(
			"bytos-cli-bytos-pass-intro",
		);
	});

	it("does not show after every notice is marked as shown", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);
		markBytosCliMigrationNoticeShown(dataDir, "bytos-cli-desktop-launch");

		expect(getBytosCliMigrationNotice(dataDir)).toBeUndefined();
	});

	it("shows the desktop launch notice once the BytosPass intro was shown", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);

		const notice = getBytosCliMigrationNotice(dataDir);
		expect(notice?.id).toBe("bytos-cli-desktop-launch");
		expect(notice?.url).toBe("https://bytos.dev/desktop");
	});

	it("shows only one notice per launch", () => {
		const dataDir = createTempDataDir();

		expect(getBytosCliMigrationNotice(dataDir)?.id).toBe(
			"bytos-cli-bytos-pass-intro",
		);
	});

	it("marks the desktop launch notice as shown by id", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);
		markBytosCliMigrationNoticeShown(dataDir, "bytos-cli-desktop-launch");

		const rawState = readFileSync(resolveCliNoticeStatePath(dataDir), "utf8");
		expect(rawState).toContain('"bytos-cli-bytos-pass-intro": true');
		expect(rawState).toContain('"bytos-cli-desktop-launch": true');
		expect(getBytosCliMigrationNotice(dataDir)).toBeUndefined();
	});

	it("shows after the notice is marked as shown when forced", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);

		expect(
			getBytosCliMigrationNotice(dataDir, {
				BYTOS_FORCE_BYTOS_PASS_NOTICE: "1",
			}),
		).toBeDefined();
	});

	it("does not show when disabled through the environment", () => {
		const dataDir = createTempDataDir();

		expect(
			getBytosCliMigrationNotice(dataDir, {
				BYTOS_DISABLE_BYTOS_PASS_NOTICE: "1",
			}),
		).toBeUndefined();
	});

	it("does not show the BytosPass intro when BytosPass is already the active provider", () => {
		const dataDir = createTempDataDir();

		expect(
			getBytosCliMigrationNotice(
				dataDir,
				{},
				{ activeProviderId: "bytos-pass" },
			)?.id,
		).toBe("bytos-cli-desktop-launch");
	});

	it("suppresses the active BytosPass provider even when the provider id has surrounding whitespace", () => {
		expect(
			shouldSuppressBytosCliMigrationNoticeForActiveProvider(" bytos-pass "),
		).toBe(true);
	});

	it("does not suppress the active BytosPass provider when forced", () => {
		expect(
			shouldSuppressBytosCliMigrationNoticeForActiveProvider("bytos-pass", {
				BYTOS_FORCE_BYTOS_PASS_NOTICE: "1",
			}),
		).toBe(false);
	});

	it("shows for the active BytosPass provider when forced", () => {
		const dataDir = createTempDataDir();

		expect(
			getBytosCliMigrationNotice(
				dataDir,
				{ BYTOS_FORCE_BYTOS_PASS_NOTICE: "1" },
				{ activeProviderId: "bytos-pass" },
			),
		).toBeDefined();
	});

	it("shows when forced even if disabled through the environment", () => {
		const dataDir = createTempDataDir();

		expect(
			getBytosCliMigrationNotice(dataDir, {
				BYTOS_DISABLE_BYTOS_PASS_NOTICE: "1",
				BYTOS_FORCE_BYTOS_PASS_NOTICE: "1",
			}),
		).toBeDefined();
	});

	it("marks the notice as shown", () => {
		const dataDir = createTempDataDir();

		markBytosCliMigrationNoticeShown(dataDir);

		const rawState = readFileSync(resolveCliNoticeStatePath(dataDir), "utf8");
		expect(rawState).toContain("bytos-cli-bytos-pass-intro");
		expect(getBytosCliMigrationNotice(dataDir)?.id).not.toBe(
			"bytos-cli-bytos-pass-intro",
		);
	});
});
