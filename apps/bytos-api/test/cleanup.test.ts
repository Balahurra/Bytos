import { Database } from "bun:sqlite"
import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import {
	HANDOFF_CLEANUP_BATCH_SIZE,
	HANDOFF_CLEANUP_MAX_BATCHES,
	HANDOFF_CONSUMED_RETENTION_MS,
	HANDOFF_EXPIRED_RETENTION_MS,
	runHandoffCleanup,
	type HandoffCleanupInput,
	type HandoffCleanupStore,
} from "../src/cleanup"
import worker from "../src/index"
import { D1_HANDOFF_CLEANUP_SQL } from "../src/storage"

function fakeStore(counts: number[]): HandoffCleanupStore & { calls: HandoffCleanupInput[] } {
	const calls: HandoffCleanupInput[] = []
	return {
		calls,
		async cleanup(input) {
			calls.push(input)
			return { deleted: counts[calls.length - 1] ?? 0 }
		},
	}
}

const NOW = 1_700_000_000_000

describe("handoff cleanup orchestration", () => {
	it("uses the documented retention cutoffs and small default batch", async () => {
		const store = fakeStore([10])
		const result = await runHandoffCleanup(store, NOW)

		expect(result).toEqual({ status: "ok", deleted: 10, batches: 1 })
		expect(store.calls[0]).toEqual({
			expiredBefore: NOW - HANDOFF_EXPIRED_RETENTION_MS,
			consumedBefore: NOW - HANDOFF_CONSUMED_RETENTION_MS,
			batchSize: HANDOFF_CLEANUP_BATCH_SIZE,
		})
	})

	it("deletes in batches and stops after a short batch", async () => {
		const store = fakeStore([500, 25])
		const result = await runHandoffCleanup(store, NOW, {
			batchSize: 500,
			maxBatches: 10,
			expiredRetentionMs: 0,
			consumedRetentionMs: 0,
		})

		expect(result).toEqual({ status: "ok", deleted: 525, batches: 2 })
		expect(store.calls.map((call) => call.batchSize)).toEqual([500, 500])
	})

	it("stops at the batch cap and reports a partial run", async () => {
		const store = fakeStore([500, 500, 500])
		const result = await runHandoffCleanup(store, NOW, {
			batchSize: 500,
			maxBatches: 2,
		})

		expect(result).toEqual({ status: "partial", deleted: 1000, batches: 2 })
		expect(store.calls).toHaveLength(2)
	})

	it("is idempotent: a second run with no candidates deletes zero", async () => {
		const store = fakeStore([3, 0])
		await runHandoffCleanup(store, NOW, { batchSize: 500 })
		const second = await runHandoffCleanup(store, NOW, { batchSize: 500 })

		expect(second).toEqual({ status: "ok", deleted: 0, batches: 1 })
	})

	it("clamps oversized batch requests to the database guard limit", async () => {
		const store = fakeStore([0])
		await runHandoffCleanup(store, NOW, { batchSize: 999_999 })

		expect(store.calls[0].batchSize).toBe(5000)
	})

	it("exposes a bounded default run budget", () => {
		expect(HANDOFF_CLEANUP_MAX_BATCHES).toBeGreaterThan(0)
		expect(HANDOFF_CLEANUP_BATCH_SIZE).toBeLessThanOrEqual(5000)
	})
})

describe("D1 cleanup SQL", () => {
	function seed(rows: Array<{ id: string; expiresAt: number; consumedAt: number | null }>) {
		const db = new Database(":memory:")
		db.run(
			"CREATE TABLE handoff_codes (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, consumed_at INTEGER)",
		)
		const insert = db.prepare(
			"INSERT INTO handoff_codes (id, expires_at, consumed_at) VALUES (?, ?, ?)",
		)
		rows.forEach((row) => {
			insert.run(row.id, row.expiresAt, row.consumedAt)
		})
		return db
	}

	it("deletes expired and old consumed rows while keeping active/recent rows", () => {
		const db = seed([
			{ id: "expired", expiresAt: NOW - 1_000, consumedAt: null },
			{ id: "active", expiresAt: NOW + 100_000, consumedAt: null },
			{ id: "consumed-old", expiresAt: NOW + 100_000, consumedAt: NOW - 20 * 60 * 1000 },
			{ id: "consumed-recent", expiresAt: NOW + 100_000, consumedAt: NOW - 60 * 1000 },
			{ id: "expired-and-consumed", expiresAt: NOW - 1_000, consumedAt: NOW - 20 * 60 * 1000 },
		])

		const result = db.run(
			D1_HANDOFF_CLEANUP_SQL,
			NOW,
			NOW - HANDOFF_CONSUMED_RETENTION_MS,
			500,
		)
		const remaining = db
			.query("SELECT id FROM handoff_codes ORDER BY id")
			.all()
			.map((row) => (row as { id: string }).id)

		expect(result.changes).toBe(3)
		expect(remaining).toEqual(["active", "consumed-recent"])
	})

	it("is idempotent and honors the batch limit", () => {
		const db = seed(
			Array.from({ length: 5 }, (_, index) => ({
				id: `expired-${index}`,
				expiresAt: NOW - 1_000,
				consumedAt: null,
			})),
		)

		expect(db.run(D1_HANDOFF_CLEANUP_SQL, NOW, NOW, 2).changes).toBe(2)
		expect(db.run(D1_HANDOFF_CLEANUP_SQL, NOW, NOW, 2).changes).toBe(2)
		expect(db.run(D1_HANDOFF_CLEANUP_SQL, NOW, NOW, 2).changes).toBe(1)
		expect(db.run(D1_HANDOFF_CLEANUP_SQL, NOW, NOW, 2).changes).toBe(0)
	})
})

describe("handoff cleanup migration", () => {
	const sql = readFileSync(new URL("../supabase/0003_handoff_cleanup.sql", import.meta.url), "utf8")

	it("deletes only expired or consumed-before-cutoff batches", () => {
		expect(sql).toMatch(/security definer/i)
		expect(sql).toMatch(/set search_path = ''/i)
		expect(sql).toMatch(/expires_at <= p_expired_before/i)
		expect(sql).toMatch(/consumed_at is not null and consumed_at <= p_consumed_before/i)
		expect(sql).toMatch(/limit p_batch_size/i)
		expect(sql).toMatch(/for update skip locked/i)
		expect(sql).toMatch(/p_batch_size < 1 or p_batch_size > 5000/i)
	})

	it("is service-role only and leaves RLS in place", () => {
		expect(sql).toMatch(/revoke all on function public\.cleanup_handoff_codes[\s\S]*from public/i)
		expect(sql).toMatch(/revoke all on function public\.cleanup_handoff_codes[\s\S]*from anon/i)
		expect(sql).toMatch(/revoke all on function public\.cleanup_handoff_codes[\s\S]*from authenticated/i)
		expect(sql).toMatch(/grant execute on function public\.cleanup_handoff_codes[\s\S]*to service_role/i)
		expect(sql).not.toMatch(/grant execute on function public\.cleanup_handoff_codes[\s\S]*to (anon|authenticated)/i)
		expect(sql).not.toMatch(/disable row level security/i)
		expect(sql).not.toMatch(/create policy/i)
	})
})

describe("scheduled cleanup handler", () => {
	const env = {
		SUPABASE_URL: "https://project.supabase.co",
		SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
		STORAGE_DRIVER: "supabase",
	} as const

	it("logs only status and deleted count", async () => {
		const originalFetch = globalThis.fetch
		const originalLog = console.log
		const logs: unknown[][] = []
		globalThis.fetch = (async () => ({
			ok: true,
			status: 200,
			json: async () => 2,
		})) as unknown as typeof fetch
		console.log = (...args: unknown[]) => {
			logs.push(args)
		}
		try {
			await worker.scheduled({} as never, env as never)
		} finally {
			globalThis.fetch = originalFetch
			console.log = originalLog
		}

		expect(logs).toEqual([["[bytos-api] handoff cleanup", { status: "ok", deleted: 2 }]])
		expect(JSON.stringify(logs)).not.toContain("service-role-test")
		expect(JSON.stringify(logs)).not.toContain("e2e@example.com")
	})

	it("logs a generic error status without storage details", async () => {
		const originalFetch = globalThis.fetch
		const originalError = console.error
		const logs: unknown[][] = []
		globalThis.fetch = (async () => ({
			ok: false,
			status: 500,
			json: async () => ({}),
		})) as unknown as typeof fetch
		console.error = (...args: unknown[]) => {
			logs.push(args)
		}
		try {
			await worker.scheduled({} as never, env as never)
		} finally {
			globalThis.fetch = originalFetch
			console.error = originalError
		}

		expect(logs).toEqual([["[bytos-api] handoff cleanup", { status: "error" }]])
		expect(JSON.stringify(logs)).not.toContain("service-role-test")
	})
})
