import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveBytosDataDir } from "@bytos/shared/storage";

const DESKTOP_NOTICE_ID = "bytos-cli-desktop-launch";
const FORCE_NOTICE_ENV = "BYTOS_FORCE_CLINE_PASS_NOTICE";
// Historically named for the ClinePass promo; disables every startup notice.
const DISABLE_NOTICE_ENV = "BYTOS_DISABLE_CLINE_PASS_NOTICE";
const DESKTOP_APP_URL = "https://bytos.dev/desktop";

export interface CliMigrationNotice {
	id: string;
	title: string;
	body: string;
	url: string;
	openLabel: string;
}

function getDesktopNotice(): CliMigrationNotice {
	return {
		id: DESKTOP_NOTICE_ID,
		title: "Introducing Bytos Desktop",
		body: [
			"A native app for working with open weights models, with your own provider keys or free models.",
			"- Import tasks from Claude Code and Codex",
			"- Run Bytos on a regular schedule",
			"- Use web search tool and voice input",
			"- Browse Marketplace for plugins, MCPs, and skills",
			"Available for macOS and Windows.",
		].join("\n"),
		url: DESKTOP_APP_URL,
		openLabel: "Get Bytos Desktop",
	};
}

interface CliNoticeState {
	shown: Record<string, boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function readNoticeState(filePath: string): CliNoticeState {
	const parsed = readJsonRecord(filePath);
	const shown: Record<string, boolean> = {};
	if (!parsed) {
		return { shown };
	}
	const rawShown = parsed.shown;
	if (!isRecord(rawShown)) {
		return { shown };
	}
	for (const [key, value] of Object.entries(rawShown)) {
		if (typeof value === "boolean") {
			shown[key] = value;
		}
	}
	return { shown };
}

function isForceNoticeEnabled(env: NodeJS.ProcessEnv): boolean {
	return env[FORCE_NOTICE_ENV]?.trim() === "1";
}

export function resolveCliNoticeStatePath(
	dataDir = resolveBytosDataDir(),
): string {
	return join(dataDir, "settings", "cli-notices.json");
}

export function getBytosCliMigrationNotice(
	dataDir = resolveBytosDataDir(),
	env: NodeJS.ProcessEnv = process.env,
): CliMigrationNotice | undefined {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const forceNotice = isForceNoticeEnabled(env);
	const disableNotice = env[DISABLE_NOTICE_ENV]?.trim() === "1";
	if (disableNotice && !forceNotice) {
		return undefined;
	}
	if (forceNotice || !noticeState.shown[DESKTOP_NOTICE_ID]) {
		return getDesktopNotice();
	}
	return undefined;
}

export function markBytosCliMigrationNoticeShown(
	dataDir = resolveBytosDataDir(),
	noticeId = DESKTOP_NOTICE_ID,
): void {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const nextState: CliNoticeState = {
		shown: {
			...noticeState.shown,
			[noticeId]: true,
		},
	};
	mkdirSync(dirname(noticePath), { recursive: true, mode: 0o700 });
	writeFileSync(noticePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}
