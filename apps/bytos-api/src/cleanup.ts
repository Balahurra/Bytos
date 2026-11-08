import {
	createHandoffStore,
	type HandoffCleanupInput,
	type HandoffCleanupResult,
	type StorageEnv,
} from "./storage"

/** Delete rows this long after they expired. */
export const HANDOFF_EXPIRED_RETENTION_MS = 24 * 60 * 60 * 1000
/** Keep consumed rows as replay tombstones for this long. */
export const HANDOFF_CONSUMED_RETENTION_MS = 10 * 60 * 1000
/** Small batches keep one cron run from holding a long table lock. */
export const HANDOFF_CLEANUP_BATCH_SIZE = 500
/** Bound one cron invocation; the next run continues where this one stopped. */
export const HANDOFF_CLEANUP_MAX_BATCHES = 20

const MAX_BATCH_SIZE = 5000
const MAX_BATCHES_LIMIT = 1000

export interface HandoffCleanupOptions {
	batchSize?: number
	maxBatches?: number
	expiredRetentionMs?: number
	consumedRetentionMs?: number
}

export interface HandoffCleanupSummary {
	status: "ok" | "partial"
	deleted: number
	batches: number
}

export interface HandoffCleanupStore {
	cleanup(input: HandoffCleanupInput): Promise<HandoffCleanupResult>
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min
	return Math.min(max, Math.max(min, Math.floor(value)))
}

/**
 * Deletes cleanup candidates in bounded batches. The store decides which rows
 * match (expired before the cutoff, or consumed before the tombstone cutoff);
 * this function only enforces the batch budget and aggregates counts.
 */
export async function runHandoffCleanup(
	store: HandoffCleanupStore,
	now: number = Date.now(),
	options: HandoffCleanupOptions = {},
): Promise<HandoffCleanupSummary> {
	const batchSize = clamp(options.batchSize ?? HANDOFF_CLEANUP_BATCH_SIZE, 1, MAX_BATCH_SIZE)
	const maxBatches = clamp(options.maxBatches ?? HANDOFF_CLEANUP_MAX_BATCHES, 1, MAX_BATCHES_LIMIT)
	const expiredRetentionMs = Math.max(0, options.expiredRetentionMs ?? HANDOFF_EXPIRED_RETENTION_MS)
	const consumedRetentionMs = Math.max(0, options.consumedRetentionMs ?? HANDOFF_CONSUMED_RETENTION_MS)
	const expiredBefore = now - expiredRetentionMs
	const consumedBefore = now - consumedRetentionMs

	let deleted = 0
	let batches = 0

	while (batches < maxBatches) {
		const result = await store.cleanup({ expiredBefore, consumedBefore, batchSize })
		if (!Number.isFinite(result.deleted) || result.deleted < 0) {
			throw new Error("Handoff cleanup returned an invalid count")
		}

		const count = Math.floor(result.deleted)
		deleted += count
		batches += 1

		// A short batch means the table has no more candidates for this run.
		if (count < batchSize) return { status: "ok", deleted, batches }
	}

	return { status: "partial", deleted, batches }
}

/** Runs cleanup against the Worker's configured handoff store. */
export async function cleanupHandoffCodes(
	env: StorageEnv,
	now: number = Date.now(),
	options: HandoffCleanupOptions = {},
): Promise<HandoffCleanupSummary> {
	return runHandoffCleanup(createHandoffStore(env), now, options)
}
