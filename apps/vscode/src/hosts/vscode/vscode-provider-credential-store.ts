import * as fs from "node:fs"
import * as path from "node:path"
import type { ProviderCredentialStore, ProviderCredentials } from "@bytos/core"
import type * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"

const SECRET_KEY_PREFIX = "bytos.providerCredentials."

interface StoredProviderSettingsLike {
	version?: number
	providers?: Record<string, { settings?: Record<string, unknown> } & Record<string, unknown>>
	[key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Extract credential fields from a persisted provider settings object. Mirrors
 * the field set in @bytos/core's ProviderSettings schema.
 */
function extractCredentials(settings: Record<string, unknown>): ProviderCredentials {
	const credentials: ProviderCredentials = {}
	const apiKey = nonEmpty(settings.apiKey)
	if (apiKey) credentials.apiKey = apiKey

	if (isRecord(settings.auth)) {
		const auth: NonNullable<ProviderCredentials["auth"]> = {}
		const authApiKey = nonEmpty(settings.auth.apiKey)
		const accessToken = nonEmpty(settings.auth.accessToken)
		const refreshToken = nonEmpty(settings.auth.refreshToken)
		if (authApiKey) auth.apiKey = authApiKey
		if (accessToken) auth.accessToken = accessToken
		if (refreshToken) auth.refreshToken = refreshToken
		if (Object.keys(auth).length > 0) credentials.auth = auth
	}

	if (isRecord(settings.aws)) {
		const aws: NonNullable<ProviderCredentials["aws"]> = {}
		const accessKey = nonEmpty(settings.aws.accessKey)
		const secretKey = nonEmpty(settings.aws.secretKey)
		const sessionToken = nonEmpty(settings.aws.sessionToken)
		if (accessKey) aws.accessKey = accessKey
		if (secretKey) aws.secretKey = secretKey
		if (sessionToken) aws.sessionToken = sessionToken
		if (Object.keys(aws).length > 0) credentials.aws = aws
	}

	if (isRecord(settings.sap)) {
		const sap: NonNullable<ProviderCredentials["sap"]> = {}
		const clientId = nonEmpty(settings.sap.clientId)
		const clientSecret = nonEmpty(settings.sap.clientSecret)
		if (clientId) sap.clientId = clientId
		if (clientSecret) sap.clientSecret = clientSecret
		if (Object.keys(sap).length > 0) credentials.sap = sap
	}

	if (isRecord(settings.headers) && Object.keys(settings.headers).length > 0) {
		const headers = Object.fromEntries(
			Object.entries(settings.headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
		)
		if (Object.keys(headers).length > 0) credentials.headers = headers
	}

	return credentials
}

function hasCredentials(credentials: ProviderCredentials): boolean {
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
	)
}

function stripCredentials(settings: Record<string, unknown>): Record<string, unknown> {
	const next: Record<string, unknown> = { ...settings }
	delete next.apiKey
	if (isRecord(next.auth)) {
		const auth = { ...next.auth }
		delete auth.apiKey
		delete auth.accessToken
		delete auth.refreshToken
		next.auth = auth
	}
	if (isRecord(next.aws)) {
		const aws = { ...next.aws }
		delete aws.accessKey
		delete aws.secretKey
		delete aws.sessionToken
		next.aws = aws
	}
	if (isRecord(next.sap)) {
		const sap = { ...next.sap }
		delete sap.clientId
		delete sap.clientSecret
		next.sap = sap
	}
	delete next.headers
	return next
}

/**
 * Provider credentials backed by VS Code SecretStorage.
 *
 * providers.json keeps only non-secret provider configuration. Credentials are
 * stored as one JSON blob per provider in SecretStorage so the shared
 * ProviderSettingsManager can keep its synchronous API.
 */
export class VscodeProviderCredentialStore implements ProviderCredentialStore {
	private readonly cache = new Map<string, ProviderCredentials>()
	private pending: Promise<void> = Promise.resolve()

	private constructor(private readonly secretStorage: vscode.SecretStorage) {}

	static async create(secretStorage: vscode.SecretStorage, providersFilePath: string): Promise<VscodeProviderCredentialStore> {
		const store = new VscodeProviderCredentialStore(secretStorage)
		let state: StoredProviderSettingsLike | undefined
		let raw: string | undefined
		try {
			if (fs.existsSync(providersFilePath)) {
				raw = fs.readFileSync(providersFilePath, "utf8")
				const parsed: unknown = JSON.parse(raw)
				if (isRecord(parsed)) state = parsed as StoredProviderSettingsLike
			}
		} catch (error) {
			Logger.error("[VscodeProviderCredentialStore] providers.json could not be read; leaving it untouched:", error)
		}

		const providerIds = state?.providers && isRecord(state.providers) ? Object.keys(state.providers) : []
		for (const providerId of providerIds) {
			const secret = await secretStorage.get(`${SECRET_KEY_PREFIX}${providerId}`)
			if (typeof secret === "string" && secret.length > 0) {
				try {
					const parsed = JSON.parse(secret) as unknown
					if (isRecord(parsed)) store.cache.set(providerId, parsed as ProviderCredentials)
				} catch (error) {
					Logger.error(`[VscodeProviderCredentialStore] Invalid SecretStorage blob for '${providerId}':`, error)
				}
			}
		}

		// One-time migration: move any credentials still embedded in
		// providers.json into SecretStorage, verify them, and only then rewrite
		// the file without them. If anything fails the original file remains.
		let needsRewrite = false
		const migratedSettings: Record<string, unknown> = state?.providers ? { ...state.providers } : {}
		for (const providerId of providerIds) {
			const entry = state?.providers?.[providerId]
			const settings = entry?.settings
			if (!isRecord(settings)) continue
			const credentials = extractCredentials(settings)
			if (!hasCredentials(credentials)) continue
			try {
				await secretStorage.store(`${SECRET_KEY_PREFIX}${providerId}`, JSON.stringify(credentials))
				const verified = await secretStorage.get(`${SECRET_KEY_PREFIX}${providerId}`)
				if (verified !== JSON.stringify(credentials)) {
					throw new Error("SecretStorage verification failed")
				}
				store.cache.set(providerId, credentials)
				migratedSettings[providerId] = { ...entry, settings: stripCredentials(settings) }
				needsRewrite = true
			} catch (error) {
				Logger.error(
					`[VscodeProviderCredentialStore] Failed to migrate credentials for '${providerId}'; providers.json left unchanged:`,
					error,
				)
				return store
			}
		}

		if (needsRewrite && state) {
			const next = { ...state, providers: migratedSettings }
			const dir = path.dirname(providersFilePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
			}
			const tempPath = `${providersFilePath}.${process.pid}.creds.tmp`
			try {
				fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
				fs.renameSync(tempPath, providersFilePath)
				Logger.log(
					`[VscodeProviderCredentialStore] Migrated credentials for ${providerIds.length} provider(s) to SecretStorage.`,
				)
			} catch (error) {
				fs.rmSync(tempPath, { force: true })
				Logger.error("[VscodeProviderCredentialStore] Failed to rewrite providers.json without credentials:", error)
			}
		}

		return store
	}

	get(providerId: string): ProviderCredentials | undefined {
		return this.cache.get(providerId)
	}

	set(providerId: string, credentials: ProviderCredentials): void {
		if (!hasCredentials(credentials)) {
			this.delete(providerId)
			return
		}
		this.cache.set(providerId, credentials)
		this.enqueue(() => this.secretStorage.store(`${SECRET_KEY_PREFIX}${providerId}`, JSON.stringify(credentials)))
	}

	delete(providerId: string): void {
		this.cache.delete(providerId)
		this.enqueue(() => this.secretStorage.delete(`${SECRET_KEY_PREFIX}${providerId}`))
	}

	async flush(): Promise<void> {
		await this.pending
	}

	private enqueue(operation: () => Thenable<void> | Promise<void>): void {
		this.pending = this.pending
			.then(async () => {
				await operation()
			})
			.catch((error) => {
				Logger.error("[VscodeProviderCredentialStore] SecretStorage write failed:", error)
			})
	}
}
