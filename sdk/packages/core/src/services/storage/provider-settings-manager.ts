/*
 * Copyright 2026 Cline Bot Inc.
 * Bytos modifications Copyright 2026 Bytos contributors.
 *
 * Modified from the Cline project (https://github.com/cline/cline), Apache-2.0.
 * Changes by Bytos: provider credentials are added to and removed from the
 * host-provided credential store (VS Code SecretStorage) instead of being
 * written to a plaintext providers.json, and legacy plaintext credentials are
 * migrated and verified before the old file is rewritten.
 * See NOTICE and apps/vscode/THIRD-PARTY-NOTICES.txt.
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { resolveProviderSettingsPath } from "@bytos/shared/storage";
import { getProviderAuthHandler } from "../../auth/provider-auth-registry";
import { hashSecret, sdkDebug } from "../../logging/early-logger";
import {
	emptyStoredProviderSettings,
	type ProviderConfig,
	type ProviderSettings,
	ProviderSettingsSchemaTyped as ProviderSettingsSchema,
	type ProviderTokenSource,
	type StoredProviderSettings,
	StoredProviderSettingsSchema,
	type ToProviderConfigOptions,
	toProviderConfig,
	type VoiceInputSettings,
	VoiceInputSettingsSchema,
} from "../../types/provider-settings";
import { getLiveModelsCatalog } from "../llms/provider-defaults";
import {
	ensureCustomProvidersLoadedSync,
	registerConfiguredProvidersFromSettings,
} from "../providers/local-provider-registry";
import { migrateLegacyProviderSettings } from "./provider-settings-legacy-migration";

function nowIso(): string {
	return new Date().toISOString();
}

export interface ProviderSettingsManagerOptions {
	filePath?: string;
	dataDir?: string;
	/**
	 * Optional credential backend. The VS Code host supplies a SecretStorage
	 * adapter; CLI and standalone hosts leave this undefined and retain the
	 * file-backed behavior.
	 */
	credentials?: ProviderCredentialStore;
}

/**
 * Credential fields that must never be persisted in providers.json when a
 * host provides a secure credential store.
 */
export interface ProviderCredentials {
	apiKey?: string;
	auth?: {
		apiKey?: string;
		accessToken?: string;
		refreshToken?: string;
	};
	aws?: {
		accessKey?: string;
		secretKey?: string;
		sessionToken?: string;
	};
	sap?: {
		clientId?: string;
		clientSecret?: string;
	};
	headers?: Record<string, string>;
}

export interface ProviderCredentialStore {
	get(providerId: string): ProviderCredentials | undefined;
	set(providerId: string, credentials: ProviderCredentials): void;
	delete(providerId: string): void;
	flush?(): Promise<void>;
}

let defaultProviderCredentialStore: ProviderCredentialStore | undefined;

/**
 * Install the process-wide credential backend. Called once by the VS Code host
 * before any ProviderSettingsManager is constructed.
 */
export function setProviderCredentialStore(
	store: ProviderCredentialStore | undefined,
): void {
	defaultProviderCredentialStore = store;
}

export function getProviderCredentialStore():
	| ProviderCredentialStore
	| undefined {
	return defaultProviderCredentialStore;
}

function hasAnyCredential(credentials: ProviderCredentials): boolean {
	return Boolean(
		credentials.apiKey ||
			credentials.auth?.apiKey ||
			credentials.auth?.accessToken ||
			credentials.auth?.refreshToken ||
			credentials.aws?.accessKey ||
			credentials.aws?.secretKey ||
			credentials.aws?.sessionToken ||
			credentials.sap?.clientId ||
			credentials.sap?.clientSecret ||
			(credentials.headers && Object.keys(credentials.headers).length > 0),
	);
}

function splitProviderCredentials(settings: ProviderSettings): {
	settings: ProviderSettings;
	credentials: ProviderCredentials;
} {
	const credentials: ProviderCredentials = {};
	const next: ProviderSettings = { ...settings };

	if (settings.apiKey) {
		credentials.apiKey = settings.apiKey;
		delete next.apiKey;
	}
	if (settings.auth) {
		const auth = { ...settings.auth };
		const secretAuth: NonNullable<ProviderCredentials["auth"]> = {};
		if (auth.apiKey) {
			secretAuth.apiKey = auth.apiKey;
			delete auth.apiKey;
		}
		if (auth.accessToken) {
			secretAuth.accessToken = auth.accessToken;
			delete auth.accessToken;
		}
		if (auth.refreshToken) {
			secretAuth.refreshToken = auth.refreshToken;
			delete auth.refreshToken;
		}
		if (hasAnyCredential({ auth: secretAuth })) {
			credentials.auth = secretAuth;
		}
		next.auth = auth;
	}
	if (settings.aws) {
		const aws = { ...settings.aws };
		const secretAws: NonNullable<ProviderCredentials["aws"]> = {};
		if (aws.accessKey) {
			secretAws.accessKey = aws.accessKey;
			delete aws.accessKey;
		}
		if (aws.secretKey) {
			secretAws.secretKey = aws.secretKey;
			delete aws.secretKey;
		}
		if (aws.sessionToken) {
			secretAws.sessionToken = aws.sessionToken;
			delete aws.sessionToken;
		}
		if (hasAnyCredential({ aws: secretAws })) {
			credentials.aws = secretAws;
		}
		next.aws = aws;
	}
	if (settings.sap) {
		const sap = { ...settings.sap };
		const secretSap: NonNullable<ProviderCredentials["sap"]> = {};
		if (sap.clientId) {
			secretSap.clientId = sap.clientId;
			delete sap.clientId;
		}
		if (sap.clientSecret) {
			secretSap.clientSecret = sap.clientSecret;
			delete sap.clientSecret;
		}
		if (hasAnyCredential({ sap: secretSap })) {
			credentials.sap = secretSap;
		}
		next.sap = sap;
	}
	if (settings.headers && Object.keys(settings.headers).length > 0) {
		credentials.headers = { ...settings.headers };
		delete next.headers;
	}

	return { settings: next, credentials };
}

function mergeProviderCredentials(
	settings: ProviderSettings,
	credentials: ProviderCredentials | undefined,
): ProviderSettings {
	if (!credentials) {
		return settings;
	}
	return {
		...settings,
		...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
		...(credentials.auth
			? { auth: { ...settings.auth, ...credentials.auth } }
			: {}),
		...(credentials.aws
			? { aws: { ...settings.aws, ...credentials.aws } }
			: {}),
		...(credentials.sap
			? { sap: { ...settings.sap, ...credentials.sap } }
			: {}),
		...(credentials.headers ? { headers: credentials.headers } : {}),
	};
}

export interface SaveProviderSettingsOptions {
	setLastUsed?: boolean;
	tokenSource?: ProviderTokenSource;
}

/**
 * A pasted credential can carry invisible control or format characters (BOM,
 * zero-width spaces, bidirectional marks) that make the provider reject it
 * with a 401 indistinguishable from a genuinely wrong key — while masked
 * rendering hides the corruption from the user. Strip those characters and
 * surrounding whitespace from every credential-bearing field before the
 * value is persisted.
 */
const INVISIBLE_CHARS = /[\p{Cc}\p{Cf}]/gu;

function sanitizeSecret(value: string | undefined): string | undefined {
	if (typeof value !== "string") {
		return value;
	}
	const cleaned = value.replace(INVISIBLE_CHARS, "").trim();
	return cleaned.length > 0 ? cleaned : undefined;
}

function sanitizeCredentialFields(
	settings: ProviderSettings,
): ProviderSettings {
	const next: ProviderSettings = {
		...settings,
		apiKey: sanitizeSecret(settings.apiKey),
	};
	if (settings.auth) {
		next.auth = {
			...settings.auth,
			apiKey: sanitizeSecret(settings.auth.apiKey),
			accessToken: sanitizeSecret(settings.auth.accessToken),
			refreshToken: sanitizeSecret(settings.auth.refreshToken),
		};
	}
	if (settings.aws) {
		next.aws = {
			...settings.aws,
			accessKey: sanitizeSecret(settings.aws.accessKey),
			secretKey: sanitizeSecret(settings.aws.secretKey),
			sessionToken: sanitizeSecret(settings.aws.sessionToken),
		};
	}
	if (settings.gcp) {
		next.gcp = {
			...settings.gcp,
			projectId: sanitizeSecret(settings.gcp.projectId),
			region: sanitizeSecret(settings.gcp.region),
		};
	}
	if (settings.sap) {
		next.sap = {
			...settings.sap,
			clientId: sanitizeSecret(settings.sap.clientId),
			clientSecret: sanitizeSecret(settings.sap.clientSecret),
		};
	}
	if (settings.headers) {
		next.headers = Object.fromEntries(
			Object.entries(settings.headers).map(([name, value]) => [
				name,
				value.replace(INVISIBLE_CHARS, "").trim(),
			]),
		);
	}
	return next;
}

function inferLegacyDataDir(filePath: string): string | undefined {
	if (basename(filePath) !== "providers.json") {
		return undefined;
	}
	const settingsDir = dirname(filePath);
	if (basename(settingsDir) !== "settings") {
		return undefined;
	}
	return dirname(settingsDir);
}

export class ProviderSettingsManager {
	private readonly filePath: string;
	private readonly dataDir?: string;
	private readonly credentials?: ProviderCredentialStore;

	constructor(options: ProviderSettingsManagerOptions = {}) {
		this.filePath = options.filePath ?? resolveProviderSettingsPath();
		this.dataDir = options.dataDir ?? inferLegacyDataDir(this.filePath);
		this.credentials = options.credentials ?? defaultProviderCredentialStore;
		if (this.dataDir || !options.filePath) {
			migrateLegacyProviderSettings({
				providerSettingsManager: this,
				dataDir: this.dataDir,
			});
		}
		ensureCustomProvidersLoadedSync(this);
		registerConfiguredProvidersFromSettings(this.read());
		// Harden permissions on any existing file at startup so that
		// pre-existing installations are also protected (best-effort; no-op on Windows).
		if (existsSync(this.filePath)) {
			try {
				chmodSync(this.filePath, 0o600);
			} catch {
				// Ignore — Windows does not support POSIX chmod.
			}
		}
	}

	getFilePath(): string {
		return this.filePath;
	}

	read(): StoredProviderSettings {
		if (!existsSync(this.filePath)) {
			return emptyStoredProviderSettings();
		}

		try {
			const raw = readFileSync(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as unknown;
			const result = StoredProviderSettingsSchema.safeParse(parsed);
			if (result.success) {
				const merged = this.withStoredCredentials(result.data);
				registerConfiguredProvidersFromSettings(merged);
				const bytosAuth = merged.providers["bytos"]?.settings?.auth;
				sdkDebug(
					`providers.read providers=[${Object.keys(merged.providers).join(",")}] lastUsed=${merged.lastUsedProvider ?? "none"} bytosAuthPresent=${!!bytosAuth?.accessToken} bytosAccessTokenHash=${hashSecret(bytosAuth?.accessToken)} bytosRefreshTokenHash=${hashSecret(bytosAuth?.refreshToken)}`,
				);
				return merged;
			}
		} catch {
			// Invalid content falls back to a clean state.
		}

		return emptyStoredProviderSettings();
	}

	write(state: StoredProviderSettings): void {
		const normalized = StoredProviderSettingsSchema.parse(state);
		const persisted = this.withoutStoredCredentials(normalized);
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		// Stage to a pid-unique temp file and rename into place. Concurrent
		// Bytos processes (CLI, extension, hub) share this file; a bare
		// writeFileSync lets readers catch a partial file, which read() treats
		// as empty settings — indistinguishable from being logged out.
		const tempPath = `${this.filePath}.${process.pid}.tmp`;
		try {
			writeFileSync(tempPath, `${JSON.stringify(persisted, null, 2)}\n`, {
				encoding: "utf8",
				mode: 0o600,
			});
			renameSync(tempPath, this.filePath);
		} catch (error) {
			rmSync(tempPath, { force: true });
			throw error;
		}
		// Restrict file to owner-only read/write (best-effort; no-op on Windows).
		try {
			chmodSync(this.filePath, 0o600);
		} catch {
			// Ignore — Windows does not support POSIX chmod.
		}
		registerConfiguredProvidersFromSettings(persisted);
	}

	/**
	 * Merge credentials from the host secret store into settings read from disk.
	 * Without a credential store this is a no-op (CLI/standalone behavior).
	 */
	private withStoredCredentials(
		state: StoredProviderSettings,
	): StoredProviderSettings {
		if (!this.credentials) {
			return state;
		}
		return {
			...state,
			providers: Object.fromEntries(
				Object.entries(state.providers).map(([providerId, entry]) => [
					providerId,
					{
						...entry,
						settings: mergeProviderCredentials(
							entry.settings,
							this.credentials?.get(providerId),
						),
					},
				]),
			),
		};
	}

	/**
	 * Remove credential fields before writing providers.json. The values are
	 * handed to the host secret store instead. Without a credential store this
	 * is a no-op (CLI/standalone behavior).
	 */
	private withoutStoredCredentials(
		state: StoredProviderSettings,
	): StoredProviderSettings {
		if (!this.credentials) {
			return state;
		}
		return {
			...state,
			providers: Object.fromEntries(
				Object.entries(state.providers).map(([providerId, entry]) => {
					const { settings, credentials } = splitProviderCredentials(
						entry.settings,
					);
					if (hasAnyCredential(credentials)) {
						this.credentials?.set(providerId, credentials);
					} else {
						this.credentials?.delete(providerId);
					}
					return [providerId, { ...entry, settings }];
				}),
			),
		};
	}

	saveProviderSettings(
		settings: unknown,
		options: SaveProviderSettingsOptions = {},
	): StoredProviderSettings {
		const validatedSettings = sanitizeCredentialFields(
			ProviderSettingsSchema.parse(settings),
		);
		const previous = this.read();
		const providerId = validatedSettings.provider;
		const shouldSetLastUsed = options.setLastUsed !== false;
		const previousEntry = previous.providers[providerId];
		const tokenSource =
			options.tokenSource ?? previousEntry?.tokenSource ?? "manual";
		const next: StoredProviderSettings = {
			...previous,
			providers: {
				...previous.providers,
				[providerId]: {
					settings: validatedSettings,
					updatedAt: nowIso(),
					tokenSource,
				},
			},
			lastUsedProvider: shouldSetLastUsed
				? providerId
				: previous.lastUsedProvider,
		};
		this.write(next);
		const prevBytosAuth = previous.providers["bytos"]?.settings?.auth;
		const nextBytosAuth =
			validatedSettings.provider === "bytos"
				? validatedSettings.auth
				: next.providers["bytos"]?.settings?.auth;
		const authDropped =
			!!prevBytosAuth?.accessToken && !nextBytosAuth?.accessToken;
		sdkDebug(
			`providers.save providerId=${providerId} tokenSource=${tokenSource} bytosAuthWasPresent=${!!prevBytosAuth?.accessToken} bytosAuthIsPresent=${!!nextBytosAuth?.accessToken} authDropped=${authDropped}`,
		);
		return next;
	}

	private resolveProviderSettings(
		state: StoredProviderSettings,
		providerId: string,
	): ProviderSettings | undefined {
		const directSettings = state.providers[providerId]?.settings;
		const authHandler = getProviderAuthHandler(providerId);
		const storageProviderId = authHandler?.storageProviderId;
		if (!storageProviderId || storageProviderId === providerId) {
			return directSettings;
		}

		const authSettings = state.providers[storageProviderId]?.settings;
		if (!authSettings) {
			return directSettings;
		}

		return ProviderSettingsSchema.parse({
			...(authSettings.auth ? { auth: authSettings.auth } : {}),
			...(authSettings.apiKey ? { apiKey: authSettings.apiKey } : {}),
			...(authSettings.baseUrl ? { baseUrl: authSettings.baseUrl } : {}),
			...(directSettings ?? {}),
			provider: providerId,
		});
	}

	getProviderSettings(providerId: string): ProviderSettings | undefined {
		const state = this.read();
		return this.resolveProviderSettings(state, providerId);
	}

	getVoiceInputSettings(): VoiceInputSettings | undefined {
		return this.read().modes.voiceInput;
	}

	setVoiceInputSettings(
		settings: VoiceInputSettings | undefined,
	): StoredProviderSettings {
		const state = this.read();
		if (settings) {
			state.modes.voiceInput = VoiceInputSettingsSchema.parse(settings);
		} else {
			delete state.modes.voiceInput;
		}
		this.write(state);
		return state;
	}

	private resolveLastUsedProviderId(
		state: StoredProviderSettings,
	): string | undefined {
		return state.lastUsedProvider;
	}

	getLastUsedProviderSettings(
		_legacyOptions?: Record<string, unknown>,
	): ProviderSettings | undefined {
		const state = this.read();
		const providerId = this.resolveLastUsedProviderId(state);
		if (!providerId) {
			return undefined;
		}
		return this.resolveProviderSettings(state, providerId);
	}

	getProviderConfig(
		providerId: string,
		options?: ToProviderConfigOptions,
	): ProviderConfig | undefined {
		const settings = this.getProviderSettings(providerId);
		if (!settings) {
			return undefined;
		}
		return toProviderConfig(settings, options);
	}

	getLastUsedProviderConfig(
		options: ToProviderConfigOptions = {},
	): ProviderConfig | undefined {
		const settings = this.getLastUsedProviderSettings();
		if (!settings) {
			return undefined;
		}
		return toProviderConfig(settings, options);
	}

	async refreshCatalog(): Promise<void> {
		try {
			await getLiveModelsCatalog({});
		} catch {
			// Ignore errors
		}
	}
}
