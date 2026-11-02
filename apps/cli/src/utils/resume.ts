import type { BytosCore } from "@bytos/core";
import type { MessageWithMetadata } from "@bytos/shared";

export async function loadInteractiveResumeMessages(
	sessionManager: BytosCore,
	resumeSessionId?: string,
): Promise<MessageWithMetadata[] | undefined> {
	const target = resumeSessionId?.trim();
	if (!target) {
		return undefined;
	}
	return await sessionManager.readMessages(target);
}
