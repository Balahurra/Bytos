import * as fs from "node:fs"
import * as path from "node:path"
import type * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { BytosSyncStorage } from "@/shared/storage/BytosStorage"

/**
 * VS Code SecretStorage-backed secret store.
 *
 * StateManager and the provider layers are synchronous, while VS Code's
 * SecretStorage API is asynchronous. This adapter keeps a synchronous cache
 * hydrated from SecretStorage at activation and write-through updates the
 * OS-backed store. Reads never touch a plaintext file.
 */
export class VscodeSecretStorage extends BytosSyncStorage<string> {
	protected name = "VscodeSecretStorage"
	private readonly data = new Map<string, string>()
	private pending: Promise<void> = Promise.resolve()
	private readonly disposables: Array<() => void> = []

	private constructor(private readonly secretStorage: vscode.SecretStorage) {
		super()
	}

	static async create(secretStorage: vscode.SecretStorage, keys: readonly string[]): Promise<VscodeSecretStorage> {
		const store = new VscodeSecretStorage(secretStorage)
		const values = await Promise.all(
			keys.map(async (key) => {
				try {
					return [key, await secretStorage.get(key)] as const
				} catch (error) {
					Logger.error(`[VscodeSecretStorage] Failed to read '${key}' from SecretStorage:`, error)
					return [key, undefined] as const
				}
			}),
		)
		for (const [key, value] of values) {
			if (typeof value === "string" && value.length > 0) {
				store.data.set(key, value)
			}
		}

		// Keep the cache in sync with other windows. The listener is intentionally
		// best-effort: a failed read must not break the extension host.
		const subscription = secretStorage.onDidChange((event) => {
			void (async () => {
				try {
					const value = await secretStorage.get(event.key)
					if (typeof value === "string" && value.length > 0) {
						store.data.set(event.key, value)
					} else {
						store.data.delete(event.key)
					}
					store.fireChange(event.key)
				} catch (error) {
					Logger.error(`[VscodeSecretStorage] Failed to sync '${event.key}':`, error)
				}
			})()
		})
		store.disposables.push(() => subscription.dispose())
		return store
	}

	protected _get(key: string): string | undefined {
		return this.data.get(key)
	}

	protected _set(key: string, value: string | undefined): void {
		if (value === undefined || value.length === 0) {
			this.data.delete(key)
			this.enqueue(() => this.secretStorage.delete(key))
			return
		}
		this.data.set(key, value)
		this.enqueue(() => this.secretStorage.store(key, value))
	}

	protected _delete(key: string): void {
		this.data.delete(key)
		this.enqueue(() => this.secretStorage.delete(key))
	}

	protected _keys(): readonly string[] {
		return [...this.data.keys()]
	}

	/** Persist a value and wait for SecretStorage to acknowledge it. */
	async setAndFlush(key: string, value: string): Promise<void> {
		this.data.set(key, value)
		await this.secretStorage.store(key, value)
	}

	/** Wait for queued write-through operations to settle. */
	async flush(): Promise<void> {
		await this.pending
	}

	dispose(): void {
		for (const dispose of this.disposables.splice(0)) {
			try {
				dispose()
			} catch {
				// ignore
			}
		}
	}

	private enqueue(operation: () => Thenable<void> | Promise<void>): void {
		this.pending = this.pending
			.then(async () => {
				await operation()
			})
			.catch((error) => {
				Logger.error("[VscodeSecretStorage] SecretStorage write failed:", error)
			})
	}
}

/**
 * Move a legacy plaintext `secrets.json` into SecretStorage.
 *
 * The file is deleted only after every value has been written and read back.
 * If any step fails, the original file is left untouched so the user can
 * recover their credentials and retry.
 */
export async function migrateLegacySecretsFile(
	dataDir: string,
	secretStorage: VscodeSecretStorage,
): Promise<{ migrated: number; preserved: boolean }> {
	const legacyPath = path.join(dataDir, "secrets.json")
	if (!fs.existsSync(legacyPath)) {
		return { migrated: 0, preserved: false }
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(fs.readFileSync(legacyPath, "utf8"))
	} catch (error) {
		Logger.error("[VscodeSecretStorage] Legacy secrets.json is not valid JSON; leaving it in place:", error)
		return { migrated: 0, preserved: true }
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		Logger.error("[VscodeSecretStorage] Legacy secrets.json is not an object; leaving it in place.")
		return { migrated: 0, preserved: true }
	}

	const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
	let migrated = 0
	for (const [key, value] of entries) {
		if (!value) {
			continue
		}
		try {
			await secretStorage.setAndFlush(key, value)
			if (secretStorage.get(key) !== value) {
				throw new Error(`Verification failed for '${key}'`)
			}
			migrated += 1
		} catch (error) {
			Logger.error(`[VscodeSecretStorage] Failed to migrate '${key}'; preserving secrets.json:`, error)
			return { migrated, preserved: true }
		}
	}

	try {
		fs.unlinkSync(legacyPath)
		Logger.log(`[VscodeSecretStorage] Migrated ${migrated} secret(s) to SecretStorage and removed secrets.json.`)
		return { migrated, preserved: false }
	} catch (error) {
		Logger.error("[VscodeSecretStorage] Secrets were migrated but secrets.json could not be removed:", error)
		return { migrated, preserved: true }
	}
}
