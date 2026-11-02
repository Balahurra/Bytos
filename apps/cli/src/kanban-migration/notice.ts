import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveBytosDataDir } from "@bytos/shared/storage";
import { getCliSubscriptionUrl } from "../utils/bytos-pass-errors";

export const BYTOS_PASS_NOTICE_ID = "bytos-cli-bytos-pass-intro";
const DESKTOP_NOTICE_ID = "bytos-cli-desktop-launch";
const FORCE_NOTICE_ENV = "BYTOS_FORCE_BYTOS_PASS_NOTICE";
// Historically named for the BytosPass promo; disables every startup notice.
const DISABLE_NOTICE_ENV = "BYTOS_DISABLE_BYTOS_PASS_NOTICE";
const DESKTOP_APP_URL = "https://bytos.dev/desktop";

export interface CliMigrationNotice {
	id: string;
	title: string;
	body: string;
	url: string;
	openLabel: string;
}

export interface CliMigrationNoticeOptions {
	activeProviderId?: string;
}

function getBytosPassNotice(): CliMigrationNotice {
	return {
		id: BYTOS_PASS_NOTICE_ID,
		title: "Try BytosPass",
		body: "BytosPass is a $9.99/month subscription plan to get access to the latest open-weight coding models with enough quota for day-to-day work, at a much lower cost than paying API costs directly.",
		url: getCliSubscriptionUrl(),
		openLabel: "Open BytosPass",
	};
}

function getDesktopNotice(): CliMigrationNotice {
	return {
		id: DESKTOP_NOTICE_ID,
		title: "Introducing Bytos Desktop",
		body: [
			"A native app for working with open weights models. Use it with BytosPass and our free models, or BYOK.",
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

export function shouldSuppressBytosCliMigrationNoticeForActiveProvider(
	activeProviderId: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return (
		activeProviderId?.trim() === "bytos-pass" && !isForceNoticeEnabled(env)
	);
}

export function resolveCliNoticeStatePath(
	dataDir = resolveBytosDataDir(),
): string {
	return join(dataDir, "settings", "cli-notices.json");
}

export function getBytosCliMigrationNotice(
	dataDir = resolveBytosDataDir(),
	env: NodeJS.ProcessEnv = process.env,
	options: CliMigrationNoticeOptions = {},
): CliMigrationNotice | undefined {
	const noticePath = resolveCliNoticeStatePath(dataDir);
	const noticeState = readNoticeState(noticePath);
	const forceNotice = isForceNoticeEnabled(env);
	const disableNotice = env[DISABLE_NOTICE_ENV]?.trim() === "1";
	if (disableNotice && !forceNotice) {
		return undefined;
	}
	// At most one notice per launch, oldest first, so a user who has already
	// dismissed the BytosPass intro sees the desktop launch on their next start.
	if (
		!shouldSuppressBytosCliMigrationNoticeForActiveProvider(
			options.activeProviderId,
			env,
		) &&
		(forceNotice || !noticeState.shown[BYTOS_PASS_NOTICE_ID])
	) {
		return getBytosPassNotice();
	}
	if (!noticeState.shown[DESKTOP_NOTICE_ID]) {
		return getDesktopNotice();
	}
	return undefined;
}

export function markBytosCliMigrationNoticeShown(
	dataDir = resolveBytosDataDir(),
	noticeId = BYTOS_PASS_NOTICE_ID,
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
