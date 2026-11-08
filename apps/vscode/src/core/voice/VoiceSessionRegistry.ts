import type { ChildProcess } from "child_process"
import { Logger } from "@/shared/services/Logger"

/**
 * Tracks every helper child process so nothing can be orphaned (TD-14).
 *
 * Mirrors the existing `HookProcessRegistry` pattern: providers register their
 * child, and `dispose()` kills everything still registered. `dispose()` is
 * idempotent — a second call is a no-op, which is what `tearDown()` relies on
 * when the extension shuts down while a capture is still open.
 */
export class VoiceSessionRegistry {
	private static children = new Set<ChildProcess>()

	static register(child: ChildProcess): void {
		VoiceSessionRegistry.children.add(child)
		child.once("exit", () => VoiceSessionRegistry.children.delete(child))
		child.once("error", () => VoiceSessionRegistry.children.delete(child))
	}

	static unregister(child: ChildProcess): void {
		VoiceSessionRegistry.children.delete(child)
	}

	static getActiveCount(): number {
		return VoiceSessionRegistry.children.size
	}

	/** Kills every registered helper. Safe to call repeatedly. */
	static async terminateAll(): Promise<void> {
		const children = Array.from(VoiceSessionRegistry.children)
		if (children.length === 0) return
		Logger.log(`[VoiceSessionRegistry] Terminating ${children.length} capture helper process(es)`)
		await Promise.all(
			children.map(
				(child) =>
					new Promise<void>((resolve) => {
						if (child.exitCode !== null || child.signalCode !== null) {
							VoiceSessionRegistry.children.delete(child)
							resolve()
							return
						}
						const done = () => {
							VoiceSessionRegistry.children.delete(child)
							resolve()
						}
						child.once("exit", done)
						try {
							child.kill()
						} catch {
							VoiceSessionRegistry.children.delete(child)
							resolve()
						}
						// Never hang teardown on a stuck child.
						setTimeout(done, 2000).unref?.()
					}),
			),
		)
		VoiceSessionRegistry.children.clear()
	}

	/** Testing helper. */
	static resetForTesting(): void {
		VoiceSessionRegistry.children.clear()
	}
}
